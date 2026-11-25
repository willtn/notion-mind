/**
 * The Notion content model as data: the databases, their properties, their
 * saved views, the scaffold pages, and the template rows. The setup reads
 * these tables and makes the workspace agree with them. A change to the
 * model is a change to a table here, not to the setup.
 *
 * Two measured limits of the Notion view language shape the tables:
 * - A view filter on a formula works only when the formula returns text.
 *   A filter on a true/false formula saves as an empty filter and returns
 *   no rows. So each formula that a view reads returns "yes" or "no".
 * - A two-way relation always makes two properties, also on one database.
 */

export type DatabaseKey = "work" | "people" | "teams" | "competencies" | "perf_docs" | "knowledge" | "templates";

export type PropertySpec =
	| { readonly type: "text" | "date" | "number" | "checkbox" | "created_time" | "last_edited_time" }
	| { readonly type: "select" | "multi_select"; readonly options: readonly string[] }
	| { readonly type: "formula"; readonly expression: string }
	| { readonly type: "relation"; readonly target: DatabaseKey; readonly reverse?: string }
	| { readonly type: "rollup"; readonly relation: string; readonly property: string; readonly aggregation: string };

export type Filter =
	| { readonly property: string; readonly is: string | boolean }
	| { readonly property: string; readonly in: readonly string[] }
	| { readonly property: string; readonly empty: true }
	| { readonly property: string; readonly above: number }
	| { readonly property: string; readonly since: "one_week_ago" };

/** A test row for a view on a formula. Dates are relative to the run, because the formulas read `now()`. */
export interface ProbeRow {
	readonly label: string;
	readonly properties?: Readonly<Record<string, string | number>>;
	readonly changedDaysAgo?: number;
	readonly hookStampMinutesAgo?: number;
}

export interface ViewSpec {
	readonly name: string;
	readonly filters?: readonly Filter[];
	readonly sort?: { readonly property: string; readonly direction: "ASC" | "DESC" };
	readonly groupBy?: string;
	/** Present when a filter reads a formula: rows that the view must return and rows that it must not. */
	readonly probe?: { readonly include: readonly ProbeRow[]; readonly exclude: readonly ProbeRow[] };
}

export interface DatabaseSpec {
	readonly key: DatabaseKey;
	readonly title: string;
	readonly description: string;
	/** Scaffold files whose first paragraph joins the description. */
	readonly descriptionSources: readonly ScaffoldSource[];
	readonly properties: Readonly<Record<string, PropertySpec>>;
	readonly views: readonly ViewSpec[];
}

export interface LinkedViewSpec extends ViewSpec {
	readonly database: DatabaseKey;
}

export type PageKey =
	| "home"
	| "north_star"
	| "people_and_context"
	| "recently_touched"
	| "key_decisions"
	| "patterns"
	| "gotchas";

export interface PageSpec {
	readonly key: PageKey;
	readonly title: string;
	/** The root page, or a database for a row. */
	readonly parent: "root" | DatabaseKey;
	readonly properties?: Readonly<Record<string, string>>;
	/** The parts of the body, in order. A part is a whole scaffold file or one `##` section of it. */
	readonly body: readonly { readonly source: ScaffoldSource; readonly section?: string }[];
	/** Pages and databases that a "Quick Links" list at the end of the body names. Each must come earlier in `PAGES`. */
	readonly links?: readonly (PageKey | DatabaseKey)[];
	readonly linkedViews: readonly LinkedViewSpec[];
}

export interface TemplateSpec {
	readonly title: string;
	readonly source: ScaffoldSource;
	readonly purpose: string;
	readonly appliesTo: string;
}

/**
 * Every scaffold file that the setup reads, as a path from the repository
 * root. No other table holds a source path. A move of the scaffold sources
 * changes only this table.
 */
export const SCAFFOLD_SOURCES = {
	north_star: "brain/North Star.md",
	memories: "brain/Memories.md",
	key_decisions: "brain/Key Decisions.md",
	patterns: "brain/Patterns.md",
	gotchas: "brain/Gotchas.md",
	people_and_context: "org/People & Context.md",
	work_index: "work/Index.md",
	competencies_readme: "perf/competencies/README.md",
	thinking_readme: "thinking/README.md",
	meetings_readme: "work/meetings/README.md",
	template_work_note: "templates/Work Note.md",
	template_decision_record: "templates/Decision Record.md",
	template_thinking_note: "templates/Thinking Note.md",
	template_competency_note: "templates/Competency Note.md",
	template_review: "templates/Review Template.md",
} as const;

export type ScaffoldSource = keyof typeof SCAFFOLD_SOURCES;

const yesNo = (test: string): string => `if(${test}, "yes", "no")`;
const olderThan = (days: number): string => yesNo(`dateBetween(now(), prop("Changed"), "days") > ${days}`);

const WORK_TYPES = ["Work note", "Decision", "Incident", "1:1", "Inbox item", "Thinking"] as const;
const PERF_TYPES = ["PR evidence", "Review brief", "Review artifact", "Brag quarter"] as const;
const KNOWLEDGE_TYPES = ["Brain topic", "Reference", "Domain note", "Event-log satellite", "Archive note"] as const;
const STATUSES = ["active", "completed", "archived", "proposed", "accepted", "deprecated", "draft", "inbox"] as const;
const TAGS = ["work-note", "decision", "incident", "perf", "review", "thinking", "north-star", "competency", "person", "team", "brain", "org", "index", "moc"] as const;

/** The properties of every database: the global note fields, then the fields that the hygiene views read. */
const COMMON_PROPERTIES: Readonly<Record<string, PropertySpec>> = {
	Date: { type: "date" },
	Description: { type: "text" },
	Tags: { type: "multi_select", options: TAGS },
	"Last edited": { type: "last_edited_time" },
	Created: { type: "created_time" },
	Changed: { type: "date" },
	Bytes: { type: "number" },
	"Hook stamp": { type: "date" },
	Stale: { type: "formula", expression: olderThan(14) },
	Oversized: { type: "formula", expression: yesNo('prop("Bytes") >= 25000 and not contains(prop("Name"), "Archive")') },
	// Notion keeps a date and time to the minute (measured). So a stamp can read up to
	// one minute before the write that set it, and the limit of 2 minutes covers that.
	"Edited outside hooks": {
		type: "formula",
		expression: `if(empty(prop("Hook stamp")), "yes", ${yesNo('dateBetween(prop("Last edited"), prop("Hook stamp"), "minutes") > 2')})`,
	},
};

const COMMON_VIEWS: readonly ViewSpec[] = [
	{ name: "Recently changed", sort: { property: "Changed", direction: "DESC" } },
	{
		name: "Hygiene: oversized",
		filters: [{ property: "Oversized", is: "yes" }],
		probe: {
			include: [{ label: "large", properties: { Bytes: 30000 } }],
			exclude: [
				{ label: "small", properties: { Bytes: 100 } },
				{ label: "large Archive", properties: { Bytes: 30000 } },
			],
		},
	},
	{
		name: "Hygiene: edited outside hooks",
		filters: [{ property: "Edited outside hooks", is: "yes" }],
		probe: {
			include: [{ label: "old stamp", hookStampMinutesAgo: 60 }, { label: "no stamp" }],
			exclude: [{ label: "new stamp", hookStampMinutesAgo: 0 }],
		},
	},
];

const database = (
	key: DatabaseKey,
	title: string,
	description: string,
	properties: Readonly<Record<string, PropertySpec>>,
	views: readonly ViewSpec[],
	descriptionSources: readonly ScaffoldSource[] = [],
): DatabaseSpec => ({
	key,
	title,
	description,
	descriptionSources,
	properties: { ...COMMON_PROPERTIES, ...properties },
	views: [...COMMON_VIEWS, ...views],
});

export const DATABASES: readonly DatabaseSpec[] = [
	database(
		"work",
		"Work",
		"Work notes, decisions, incidents, 1:1 notes, inbox items, and thinking notes. Status replaces the active and archive folders. Project replaces a workstream folder.",
		{
			Type: { type: "select", options: WORK_TYPES },
			Status: { type: "select", options: STATUSES },
			Quarter: { type: "select", options: [] },
			Project: { type: "select", options: [] },
			Team: { type: "relation", target: "teams" },
			Person: { type: "relation", target: "people", reverse: "Work" },
			Ticket: { type: "text" },
			Severity: { type: "select", options: ["high", "medium", "low"] },
			Role: { type: "text" },
			Context: { type: "text" },
			Related: { type: "relation", target: "work", reverse: "Related from" },
			Decisions: { type: "relation", target: "work", reverse: "Decision of" },
			Competencies: { type: "relation", target: "competencies", reverse: "Evidence" },
			"Feeds into": { type: "relation", target: "work" },
			Parent: { type: "relation", target: "work", reverse: "Children" },
			"Days untouched": { type: "formula", expression: 'dateBetween(now(), prop("Changed"), "days")' },
			"Older than 7 days": { type: "formula", expression: olderThan(7) },
			"Open tasks": { type: "number" },
			"Open loops": { type: "number" },
		},
		[
			{ name: "Active Work", filters: [{ property: "Status", is: "active" }], groupBy: "Project" },
			{ name: "All by Quarter", groupBy: "Quarter" },
			{
				name: "Stale Actives",
				filters: [
					{ property: "Status", is: "active" },
					{ property: "Stale", is: "yes" },
				],
				probe: {
					include: [{ label: "active old", properties: { Status: "active" }, changedDaysAgo: 30 }],
					exclude: [
						{ label: "active new", properties: { Status: "active" }, changedDaysAgo: 0 },
						{ label: "completed old", properties: { Status: "completed" }, changedDaysAgo: 30 },
					],
				},
			},
			{ name: "Completed", filters: [{ property: "Status", is: "completed" }], groupBy: "Quarter" },
			{ name: "Incidents", filters: [{ property: "Type", is: "Incident" }], sort: { property: "Date", direction: "DESC" } },
			{ name: "1:1 History", filters: [{ property: "Type", is: "1:1" }], sort: { property: "Date", direction: "DESC" } },
			{
				name: "Hygiene: open loops",
				filters: [
					{ property: "Open loops", above: 0 },
					{ property: "Type", in: ["1:1", "Inbox item", "Incident"] },
					{ property: "Stale", is: "yes" },
				],
				probe: {
					include: [{ label: "old loops", properties: { Type: "1:1", "Open loops": 2 }, changedDaysAgo: 30 }],
					exclude: [
						{ label: "new loops", properties: { Type: "1:1", "Open loops": 2 }, changedDaysAgo: 0 },
						{ label: "old no loops", properties: { Type: "1:1", "Open loops": 0 }, changedDaysAgo: 30 },
						{ label: "old other type", properties: { Type: "Work note", "Open loops": 2 }, changedDaysAgo: 30 },
					],
				},
			},
			{
				name: "Hygiene: inbox pressure",
				filters: [
					{ property: "Type", is: "Inbox item" },
					{ property: "Older than 7 days", is: "yes" },
				],
				probe: {
					include: [{ label: "inbox old", properties: { Type: "Inbox item" }, changedDaysAgo: 10 }],
					exclude: [
						{ label: "inbox new", properties: { Type: "Inbox item" }, changedDaysAgo: 5 },
						{ label: "note old", properties: { Type: "Work note" }, changedDaysAgo: 10 },
					],
				},
			},
			{
				name: "Hygiene: loose active",
				filters: [
					{ property: "Status", is: "active" },
					{ property: "Project", empty: true },
				],
			},
			{
				name: "Open tasks",
				filters: [
					{ property: "Status", is: "active" },
					{ property: "Project", empty: true },
					{ property: "Open tasks", above: 0 },
				],
			},
		],
		["thinking_readme", "meetings_readme"],
	),
	database(
		"people",
		"People",
		"One row for each person.",
		{
			Role: { type: "text" },
			Team: { type: "relation", target: "teams", reverse: "Members" },
			Parent: { type: "relation", target: "people", reverse: "Children" },
		},
		[
			{ name: "By Team", groupBy: "Team" },
			{ name: "All People", sort: { property: "Name", direction: "ASC" } },
		],
	),
	database("teams", "Teams", "One row for each team.", {}, []),
	database(
		"competencies",
		"Competencies",
		"One row for each competency. Evidence comes from the Competencies relation of Work rows.",
		{
			"Current level": { type: "select", options: [] },
			"Target level": { type: "select", options: [] },
			"Evidence count": { type: "rollup", relation: "Evidence", property: "Name", aggregation: "count" },
		},
		[{ name: "Competency Map", sort: { property: "Evidence count", direction: "DESC" } }],
		["competencies_readme"],
	),
	database(
		"perf_docs",
		"Perf docs",
		"PR evidence, review briefs, review artifacts, and brag quarters.",
		{
			Type: { type: "select", options: PERF_TYPES },
			Person: { type: "relation", target: "people", reverse: "Perf docs" },
			Cycle: { type: "select", options: [] },
			Period: { type: "text" },
			Quarter: { type: "select", options: [] },
			Status: { type: "select", options: STATUSES },
			"Work evidence": { type: "relation", target: "work" },
			Competencies: { type: "relation", target: "competencies" },
		},
		[
			{ name: "Review Evidence: By Cycle", filters: [{ property: "Type", is: "PR evidence" }], groupBy: "Cycle" },
			{ name: "Review Evidence: By Person", groupBy: "Person" },
			{ name: "Brag quarters", filters: [{ property: "Type", is: "Brag quarter" }] },
		],
	),
	database(
		"knowledge",
		"Knowledge",
		"Brain topics, reference notes, domain notes, event-log satellites, and archive notes.",
		{
			Type: { type: "select", options: KNOWLEDGE_TYPES },
			Parent: { type: "relation", target: "knowledge", reverse: "Children" },
			Scaffold: { type: "checkbox" },
			"Has content": { type: "checkbox" },
		},
		[{ name: "Brain index", filters: [{ property: "Type", is: "Brain topic" }] }],
	),
	database(
		"templates",
		"Templates",
		"One row for each note template. The row body is the template text.",
		{
			Purpose: { type: "text" },
			"Applies to": {
				type: "select",
				options: [...WORK_TYPES, "Person", "Team", "Competency", ...PERF_TYPES, ...KNOWLEDGE_TYPES],
			},
		},
		[],
	),
];

const lastWeek = (spec: DatabaseSpec): LinkedViewSpec => ({
	database: spec.key,
	name: `${spec.title}: last 7 days`,
	filters: [{ property: "Changed", since: "one_week_ago" }],
	sort: { property: "Changed", direction: "DESC" },
});

const brainTopic = (key: PageKey, title: string, source: ScaffoldSource, linkedViews: readonly LinkedViewSpec[] = []): PageSpec => ({
	key,
	title,
	parent: "knowledge",
	properties: { Type: "Brain topic", Scaffold: "__YES__" },
	body: [{ source }],
	linkedViews,
});

export const PAGES: readonly PageSpec[] = [
	{
		key: "north_star",
		title: "North Star",
		parent: "root",
		body: [{ source: "north_star" }, { source: "memories", section: "Recent Context" }],
		linkedViews: [],
	},
	{
		key: "recently_touched",
		title: "Recently Touched",
		parent: "root",
		body: [],
		linkedViews: DATABASES.map(lastWeek),
	},
	{
		key: "people_and_context",
		title: "People & Context",
		parent: "root",
		body: [{ source: "people_and_context" }],
		linkedViews: [
			{ database: "people", name: "All People", sort: { property: "Name", direction: "ASC" } },
			{ database: "teams", name: "All Teams", sort: { property: "Name", direction: "ASC" } },
		],
	},
	brainTopic("key_decisions", "Key Decisions", "key_decisions", [
		{ database: "work", name: "Decisions", filters: [{ property: "Type", is: "Decision" }], sort: { property: "Date", direction: "DESC" } },
	]),
	brainTopic("patterns", "Patterns", "patterns"),
	brainTopic("gotchas", "Gotchas", "gotchas"),
	{
		key: "home",
		title: "Home",
		parent: "root",
		body: [{ source: "work_index", section: "Open Questions" }],
		links: ["north_star", "people_and_context", "recently_touched", "key_decisions", "patterns", "gotchas", ...DATABASES.map((d) => d.key)],
		linkedViews: [
			{ database: "work", name: "Active Work", filters: [{ property: "Status", is: "active" }], groupBy: "Project" },
			{ database: "work", name: "Incidents", filters: [{ property: "Type", is: "Incident" }], sort: { property: "Date", direction: "DESC" } },
			{ database: "work", name: "Recent 1:1s", filters: [{ property: "Type", is: "1:1" }], sort: { property: "Date", direction: "DESC" } },
			{ database: "people", name: "People by Team", groupBy: "Team" },
		],
	},
];

/** A `##` section that `original` owns as a synced block and `copy` shows. `Home.md` embeds `![[North Star#Current Focus]]`. */
export interface SyncedSection {
	readonly section: string;
	readonly original: PageKey;
	readonly copy: PageKey;
}

export const SYNCED_SECTIONS: readonly SyncedSection[] = [{ section: "Current Focus", original: "north_star", copy: "home" }];

export const TEMPLATES: readonly TemplateSpec[] = [
	{ title: "Work Note", source: "template_work_note", purpose: "A work note for a project or a task.", appliesTo: "Work note" },
	{ title: "Decision Record", source: "template_decision_record", purpose: "A decision, its options, and its consequences.", appliesTo: "Decision" },
	{ title: "Thinking Note", source: "template_thinking_note", purpose: "A draft that feeds a work note or a decision.", appliesTo: "Thinking" },
	{ title: "Competency Note", source: "template_competency_note", purpose: "The definition and the levels of one competency.", appliesTo: "Competency" },
	{ title: "Review Template", source: "template_review", purpose: "A self-review for one review period.", appliesTo: "Review brief" },
];

export const READER_MAP_TITLE = "Reader map";

/** The name of a view on a formula until its test rows pass. A crashed run leaves this name, and the next run tests the view again. */
export const UNVERIFIED_SUFFIX = " (unverified)";
export const PROBE_PREFIX = "setup probe: ";

const COLORS = ["blue", "green", "purple", "orange", "pink", "yellow", "red", "brown", "gray"] as const;
const quote = (text: string): string => `'${text.replace(/'/g, "''")}'`;

export interface SelectOption {
	readonly name: string;
	readonly color: string;
}

/** The option list of a select, with the live options first so that they keep their color and order. */
export function mergeOptions(live: readonly SelectOption[], wanted: readonly string[]): SelectOption[] {
	const merged = [...live];
	for (const name of wanted) {
		if (!merged.some((o) => o.name === name)) merged.push({ name, color: COLORS[merged.length % COLORS.length] ?? "default" });
	}
	return merged;
}

const optionList = (options: readonly SelectOption[]): string => options.map((o) => `${quote(o.name)}:${o.color}`).join(", ");

/** The column type of the Notion schema language. A relation needs the data source ID of its target. */
export function columnType(spec: PropertySpec, dataSourceOf: (key: DatabaseKey) => string, own: DatabaseKey, live: readonly SelectOption[] = []): string {
	switch (spec.type) {
		case "text":
			return "RICH_TEXT";
		case "date":
			return "DATE";
		case "number":
			return "NUMBER";
		case "checkbox":
			return "CHECKBOX";
		case "created_time":
			return "CREATED_TIME";
		case "last_edited_time":
			return "LAST_EDITED_TIME";
		case "select":
			return `SELECT(${optionList(mergeOptions(live, spec.options))})`;
		case "multi_select":
			return `MULTI_SELECT(${optionList(mergeOptions(live, spec.options))})`;
		case "formula":
			return `FORMULA(${quote(spec.expression)})`;
		case "rollup":
			return `ROLLUP(${quote(spec.relation)}, ${quote(spec.property)}, ${quote(spec.aggregation)})`;
		case "relation": {
			const target = quote(dataSourceOf(spec.target).replace("collection://", ""));
			if (spec.reverse === undefined) return `RELATION(${target})`;
			// A self-relation needs an ID for the synced property as well as its name.
			const syncedId = spec.target === own ? ` ${quote(spec.reverse.toLowerCase().replace(/[^a-z0-9]+/g, "_"))}` : "";
			return `RELATION(${target}, DUAL ${quote(spec.reverse)}${syncedId})`;
		}
	}
}

const dslValue = (value: string | boolean | number): string =>
	typeof value === "string" ? JSON.stringify(value) : typeof value === "boolean" ? (value ? "TRUE" : "FALSE") : String(value);

function filterDirective(filter: Filter): string {
	const property = JSON.stringify(filter.property);
	if ("is" in filter) return `FILTER ${property} = ${dslValue(filter.is)}`;
	if ("in" in filter) return `FILTER ${property} IN (${filter.in.map(dslValue).join(", ")})`;
	if ("empty" in filter) return `FILTER ${property} IS EMPTY`;
	if ("above" in filter) return `FILTER ${property} > ${filter.above}`;
	return `FILTER ${property} >= ${dslValue(filter.since)}`;
}

/** The view in the Notion view language. */
export function viewDirectives(view: ViewSpec): string {
	const parts = (view.filters ?? []).map(filterDirective);
	if (view.sort !== undefined) parts.push(`SORT BY ${JSON.stringify(view.sort.property)} ${view.sort.direction}`);
	if (view.groupBy !== undefined) parts.push(`GROUP BY ${JSON.stringify(view.groupBy)}`);
	return parts.join("; ");
}

export interface SavedView {
	readonly filters: readonly { readonly property: string; readonly operator: string; readonly value: unknown }[];
	readonly sorts: readonly { readonly property: string; readonly direction: string }[];
	readonly groupBy: string | undefined;
}

/** The directives of a view that the saved view does not hold. Empty when Notion kept each one. */
export function droppedDirectives(view: ViewSpec, saved: SavedView): string[] {
	const has = (property: string, test: (f: SavedView["filters"][number]) => boolean): boolean =>
		saved.filters.some((f) => f.property === property && test(f));
	const kept = (filter: Filter): boolean => {
		if ("is" in filter) return has(filter.property, (f) => f.value === filter.is);
		if ("in" in filter) return filter.in.every((value) => has(filter.property, (f) => f.value === value));
		if ("empty" in filter) return has(filter.property, (f) => f.operator === "is_empty");
		if ("above" in filter) return has(filter.property, (f) => f.operator.includes("greater_than") && f.value === filter.above);
		return has(filter.property, (f) => f.value === filter.since);
	};
	const dropped = (view.filters ?? []).filter((filter) => !kept(filter)).map(filterDirective);
	const sort = view.sort;
	if (sort !== undefined) {
		const direction = sort.direction === "ASC" ? "ascending" : "descending";
		if (!saved.sorts.some((s) => s.property === sort.property && s.direction === direction)) {
			dropped.push(`SORT BY ${JSON.stringify(sort.property)} ${sort.direction}`);
		}
	}
	if (view.groupBy !== undefined && saved.groupBy !== view.groupBy) dropped.push(`GROUP BY ${JSON.stringify(view.groupBy)}`);
	return dropped;
}

/**
 * The Markdown of a scaffold file as a Notion page body: no frontmatter and
 * no first-level title (the page title holds it), a wikilink as its display
 * text, and an Obsidian `%%` comment as a quote. With `section`, only the
 * lines under that `##` heading, with the heading.
 */
export function scaffoldBody(markdown: string, section?: string): string {
	let text = markdown.replace(/\r\n/g, "\n").replace(/^---\n[\s\S]*?\n---\n/, "");
	text = text.replace(/^\s*# .*\n/, "");
	text = text.replace(/%%\n?([\s\S]*?)\n?%%/g, (_, comment: string) => comment.split("\n").map((line) => `> ${line}`).join("\n"));
	text = text.replace(/!?\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2").replace(/!?\[\[([^\]]+)\]\]/g, "$1");
	if (section !== undefined) {
		const lines = text.split("\n");
		const start = lines.findIndex((line) => line.trim() === `## ${section}`);
		if (start === -1) return "";
		const rest = lines.slice(start + 1);
		const end = rest.findIndex((line) => /^##? /.test(line));
		text = [lines[start], ...(end === -1 ? rest : rest.slice(0, end))].join("\n");
	}
	return `${text.trim()}\n`;
}

/** The `description` value of the frontmatter, or an empty string. */
export function scaffoldDescription(markdown: string): string {
	const frontmatter = markdown.replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? "";
	return frontmatter.match(/^description:\s*"?(.*?)"?\s*$/m)?.[1] ?? "";
}

/** The first paragraph of the body as one plain line, for a database description. */
export function firstParagraph(markdown: string): string {
	const paragraph = scaffoldBody(markdown).split(/\n\s*\n/)[0] ?? "";
	return paragraph.replace(/\s*\n\s*/g, " ").replace(/[*`]/g, "").trim();
}
