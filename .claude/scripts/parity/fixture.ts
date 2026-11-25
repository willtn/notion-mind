/**
 * The fixture set of the parity harness. Each note exists for a row of part
 * (d) of `NOTION-PORT-DESIGN.md`, and each scenario states the findings that
 * the conditions of that part give.
 */

import { renderFrontmatter } from "./markdown-form.ts";
import type { ExpectedFinding, FixtureNote, FixtureSpec, RepoFile, Scenario, Step } from "./spec.ts";

const LINE = "This line is filler text that keeps each paragraph on one line.";
const PARAGRAPH = `\n${LINE}\n`;

const head = (title: string): string => `# ${title}\n\nSee [[Patterns]] for the context.\n`;

function filler(title: string, bytes: number): string {
	const paragraphs = Math.ceil((bytes - head(title).length) / PARAGRAPH.length);
	return head(title) + PARAGRAPH.repeat(paragraphs);
}

/** `text` with filler paragraphs at its end, so that the result has exactly `bytes` bytes. */
function paddedTo(text: string, bytes: number): string {
	const room = bytes - Buffer.byteLength(text);
	const paragraphs = Math.floor((room - 3) / PARAGRAPH.length);
	const last = room - paragraphs * PARAGRAPH.length;
	return `${text}${PARAGRAPH.repeat(paragraphs)}\n${"x".repeat(last - 2)}\n`;
}

/** `note` with a longer body, so that its properties and its body together have exactly `bytes` bytes. */
function sized(note: FixtureNote, bytes: number): FixtureNote {
	const properties = renderFrontmatter(note);
	return { ...note, body: paddedTo(properties + note.body, bytes).slice(properties.length) };
}

const global = (description: string, tags: readonly string[]) => ({
	date: "2026-01-05",
	description,
	tags,
});

const workNote = (description: string) => ({
	...global(description, ["work-note"]),
	status: "active",
	quarter: "Q1-2026",
});

const linked = (title: string, text: string): string => `# ${title}\n\n${text} See [[Patterns]].\n`;

const notes: readonly FixtureNote[] = [
	{
		title: "Home",
		type: "Home",
		fields: {},
		body: "# Home\n\nStart at [[North Star]].\n\n- [ ] Review the quarter goals\n- [ ] Plan the team offsite\n- [x] Set up the workspace\n",
		changedDaysAgo: 1,
	},
	{
		title: "North Star",
		type: "North Star",
		fields: global("The goals and the focus areas", ["north-star"]),
		body: [
			"# North Star",
			"",
			"An introduction that the hook does not inject.",
			"",
			"## Current Focus",
			"",
			"- Ship the billing export before the quarter ends.",
			"- ~~Close the search migration.~~",
			"  - A detail of the closed goal.",
			"- Keep the login latency under the budget.",
			"",
			"## Shifts Log",
			"",
			"- An old shift that the hook drops.",
			"",
			"## Longer Term",
			"",
			"- Grow the platform team.",
			"",
		].join("\n"),
		changedDaysAgo: 5,
	},

	{
		title: "Patterns",
		type: "Brain topic",
		fields: global("The patterns that repeat", ["brain"]),
		body: "# Patterns\n\n- Name the data shape first.\n",
		changedDaysAgo: 9,
	},
	{
		title: "Gotchas",
		type: "Brain topic",
		fields: global("The traps that cost time", ["brain"]),
		body: "# Gotchas\n\nNo entry yet.\n",
		changedDaysAgo: 9,
	},
	{
		title: "Key Decisions",
		type: "Brain topic",
		fields: { date: "2026-01-05", tags: ["brain"] },
		body: "# Key Decisions\n\n- Keep one store for the notes.\n",
		changedDaysAgo: 9,
	},
	// The index of the brain topics. The Brain Topics section leaves it out.
	{
		title: "Memories",
		type: "Brain topic",
		fields: global("The index of the memory topics", ["brain", "index"]),
		body: "# Memories\n\n- [[Patterns]]\n- [[Gotchas]]\n",
		changedDaysAgo: 9,
	},

	{
		// Above the length limit of the no-link check. Its one link names a note that no other note links in this way.
		title: "Fixture Work Note",
		type: "Work note",
		fields: workNote("A work note with no finding"),
		body: "# Fixture Work Note\n\nThis note has each required field and no finding. It has more characters than the limit of the no-link check, and its one link names a person and not a brain topic: [[Ada Park]].\n",
		changedDaysAgo: 2,
	},
	{
		title: "Billing Export Pipeline",
		type: "Work note",
		fields: workNote("The export of invoices to the ledger"),
		body:
			linked("Billing Export Pipeline", "The export runs each night.") +
			"\n- [ ] Write the export schema\n- [x] Pick the file format\n- [ ] Measure the run time\n",
		changedDaysAgo: 2,
	},
	{
		title: "Billing Retry Design",
		type: "Work note",
		fields: workNote("The retry rules for a failed charge"),
		body: linked("Billing Retry Design", "A failed charge gets three attempts."),
		changedDaysAgo: 3,
	},
	{
		title: "Search Ranking Tuning",
		type: "Work note",
		fields: workNote("The weights of the ranking signals"),
		body: linked("Search Ranking Tuning", "The weights come from the click data.") + "\n- [ ] Collect the click data\n",
		changedDaysAgo: 4,
	},
	{
		title: "Login Latency Budget",
		type: "Work note",
		fields: workNote("The time limits of the login path"),
		body: linked("Login Latency Budget", "The login path has a limit of 300 ms."),
		changedDaysAgo: 6,
	},
	...(
		[
			["Cache Warmup Steps", "The cache fills before the first request.", ["Record the cold start time", "Pick the warmup keys"]],
			["Mobile Onboarding Flow", "The first run shows three screens.", ["Draw the three screens", "Count the drop-off"]],
			["Audit Trail Schema", "Each change gets one row.", ["Name the columns"]],
			["Invoice Template Refresh", "The template gets the new logo.", ["Get the logo file"]],
			["Quota Alert Thresholds", "An alert goes out at 80 percent.", []],
		] as const
	).map(
		([title, text, tasks]): FixtureNote => ({
			title,
			type: "Work note",
			fields: workNote(`The work note "${title}"`),
			body: linked(title, text) + (tasks.length === 0 ? "" : `\n${tasks.map((task) => `- [ ] ${task}`).join("\n")}\n`),
			changedDaysAgo: 4,
		}),
	),
	// The 11th loose active note, one more than the Active Work section keeps. It has no quarter.
	{
		title: "Roadmap Sketch",
		type: "Work note",
		fields: { ...global("A first sketch of the roadmap", ["work-note"]), status: "active" },
		body: linked("Roadmap Sketch", "The roadmap has three themes."),
		changedDaysAgo: 4,
	},
	{
		title: "Pricing Rollout",
		type: "Work note",
		fields: { ...workNote("The steps of the new price list"), project: "Pricing" },
		body: linked("Pricing Rollout", "The price list goes out by region.") + "\n- [ ] Tell the sales team\n",
		changedDaysAgo: 3,
	},
	{
		title: "Old Pricing Plan",
		type: "Work note",
		fields: { ...workNote("The price plan that the rollout replaced"), status: "completed", project: "Pricing" },
		body: linked("Old Pricing Plan", "This plan is done."),
		changedDaysAgo: 40,
		markdownFolder: "work/active/Pricing",
	},
	{
		title: "Legacy Importer",
		type: "Work note",
		fields: { ...workNote("The importer that the pipeline replaced"), status: "completed" },
		body: linked("Legacy Importer", "The importer is off.") + "\nWaiting on the data team for the last export.\n",
		changedDaysAgo: 90,
	},
	{
		title: "Search Migration",
		type: "Work note",
		fields: { ...workNote("The move to the new search cluster"), status: "archived" },
		body: linked("Search Migration", "The move is complete.") + "\nWatch for stale results in the old index.\n",
		changedDaysAgo: 80,
	},
	// No `date`. The key `update` ends with the name of that field and is not that field.
	{
		title: "Undated Plan",
		type: "Work note",
		fields: { description: "A plan with no date", tags: ["work-note"], status: "completed", quarter: "Q1-2026" },
		otherKeys: { update: "2026-01-05" },
		body: linked("Undated Plan", "This plan is done."),
		changedDaysAgo: 70,
	},

	...(
		[
			["Ada Park 2026-01-10", "Ada Park", 60],
			// Exactly at the age limit of the open loops.
			["Ada Park 2026-02-07", "Ada Park", 14],
			["Ben Ortiz 2026-01-15", "Ben Ortiz", 50],
			["Ben Ortiz 2026-03-01", "Ben Ortiz", 3],
		] as const
	).map(
		([title, person, changedDaysAgo]): FixtureNote => ({
			title,
			type: "1:1",
			fields: {
				...global(`A 1:1 meeting with ${person}`, ["work-note"]),
				quarter: "Q1-2026",
				person,
			},
			body: `# ${title}\n\nA meeting with [[${person}]].\n\n## Action Items\n\n- [ ] Send the notes\n- [ ] Book the next meeting\n- [x] Share the agenda\n`,
			changedDaysAgo,
		}),
	),

	{
		title: "Checkout Outage",
		type: "Incident",
		fields: {
			...global("The checkout failed for 40 minutes", ["incident", "work-note"]),
			status: "active",
			quarter: "Q1-2026",
			ticket: "OPS-41",
			severity: "high",
			role: "incident-lead",
		},
		body:
			linked("Checkout Outage", "The payment gateway refused each request.") +
			"\nWaiting on the vendor for the root cause.\n\n## What to Watch\n\n- [ ] The error rate of the gateway\n",
		changedDaysAgo: 25,
	},
	{
		title: "Checkout Outage RCA",
		type: "Incident",
		fields: global("The root cause analysis of the checkout outage", ["work-note"]),
		// The lines of the code block are not prose, so they are not a wrapped paragraph.
		body: linked("Checkout Outage RCA", "The analysis sits beside [[Checkout Outage]].") + "\n```text\ngateway: refused\nretries: 3\n```\n",
		changedDaysAgo: 20,
	},
	// A raw capture: its paragraph has line breaks, and `verbatim` keeps the hard-wrap check away.
	{
		title: "Outage Call Transcript",
		type: "Incident",
		fields: global("The raw transcript of the outage call", ["work-note"]),
		verbatim: true,
		body: "# Outage Call Transcript\n\nThe gateway refused each request\nfrom the start of the call\nto its end. See [[Checkout Outage]].\n",
		changedDaysAgo: 20,
	},
	// Old, with an open item, in a watched folder. The open loops leave out a note with "Archive" in its name.
	{
		title: "Outage Log Archive",
		type: "Incident",
		fields: global("The old entries of the outage log", ["work-note"]),
		body: linked("Outage Log Archive", "The log of the outages before this year.") + "\n## Action Items\n\n- [ ] Sort the old entries\n",
		changedDaysAgo: 40,
	},
	{
		title: "Payments Latency",
		type: "Incident",
		fields: {
			...global("The payment calls were slow for one day", ["incident", "work-note"]),
			status: "active",
			quarter: "Q1-2026",
			ticket: "OPS-37",
			severity: "medium",
			role: "responder",
		},
		body: linked("Payments Latency", "The calls took 2 s.") + "\nWatch for a second spike after the release.\n",
		changedDaysAgo: 45,
	},

	...(
		[
			["Vendor Sync Export", "## Action Items", 10],
			["Planning Export", "## Follow Ups", 21],
			// One day below the age limit of the open loops.
			["Retro Export", "## Action Items", 13],
			// Exactly at the age limit of the inbox, and one day below it.
			["Offsite Export", "## Action Items", 7],
			["Fresh Standup Export", "## Action Items", 6],
			["Kickoff Export", "## Action Items", 4],
			["Demo Export", "## Action Items", 5],
		] as const
	).map(
		([title, heading, changedDaysAgo]): FixtureNote => ({
			title,
			type: "Inbox item",
			fields: { ...global("A raw meeting export", ["meeting"]), status: "inbox" },
			body:
				`${linked(title, "The raw export of one meeting.")}\n${heading}\n\n- [ ] Send the summary\n` +
				// A heading that is not a follow-up heading ends the follow-up section, so this item is not an open loop.
				(title === "Planning Export" ? "\n## Background\n\n- [ ] Read the old plan\n" : ""),
			changedDaysAgo,
		}),
	),
	// With these five, the inbox holds 12 notes, the largest group that the listing does not collapse.
	...[1, 2, 3, 4, 5].map(
		(n): FixtureNote => ({
			title: `Workshop Export ${n}`,
			type: "Inbox item",
			fields: { ...global("A long raw export of one workshop", ["meeting"]), status: "inbox" },
			body: `${filler(`Workshop Export ${n}`, 26_000)}\n## Action Items\n\n- [ ] Send the summary\n`,
			changedDaysAgo: 3,
		}),
	),

	{
		title: "Ada Park",
		type: "Person",
		fields: { ...global("A staff engineer of the billing team", ["person"]), title: "Staff Engineer" },
		body: linked("Ada Park", "Ada leads the billing export."),
		changedDaysAgo: 30,
	},
	{
		title: "Ben Ortiz",
		type: "Person",
		fields: global("An engineer of the search team", ["person"]),
		body: linked("Ben Ortiz", "Ben owns the ranking service."),
		changedDaysAgo: 30,
	},

	{
		title: "Draft Thoughts",
		type: "Thinking",
		fields: global("A draft that the listing skips", ["thinking"]),
		body: linked("Draft Thoughts", "A first idea."),
		changedDaysAgo: 1,
	},

	{
		title: "Loose Draft",
		type: "Loose page",
		fields: {},
		body: linked("Loose Draft", "A page outside the databases."),
		changedDaysAgo: 1,
	},
	{
		title: "Missing Fields",
		type: "Reference",
		fields: { date: "2026-01-05" },
		body: linked("Missing Fields", "This note has no description and no tags."),
		changedDaysAgo: 1,
	},
	// One character above the length limit of the no-link check, and exactly at it.
	sized(
		{
			title: "No Links",
			type: "Reference",
			fields: global("A long note with no link", ["reference"]),
			body: "# No Links\n",
			changedDaysAgo: 1,
		},
		301,
	),
	// The same note as "No Links", with its title heading moved into the title as Notion does for a created page.
	sized(
		{
			title: "Moved Title No Links",
			type: "Loose page",
			fields: {},
			body: "# Moved Title No Links\n",
			changedDaysAgo: 1,
			titleMoved: true,
		},
		301,
	),
	sized(
		{
			title: "Short No Links",
			type: "Reference",
			fields: global("A note with no link at the length limit", ["reference"]),
			body: "# Short No Links\n",
			changedDaysAgo: 1,
		},
		300,
	),
	{
		title: "Wrapped Prose",
		type: "Reference",
		fields: global("A note with a paragraph on three lines", ["reference"]),
		body: "# Wrapped Prose\n\nThis paragraph has a line break in the\nmiddle of a sentence, and a second\nline break after it. See [[Patterns]].\n",
		changedDaysAgo: 1,
	},
	{
		title: "Ticket Links",
		type: "Reference",
		fields: global("A note that links two ticket IDs", ["reference"]),
		body: "# Ticket Links\n\nThe work is in [[INFRA-123]] and [[OPS-9]]. See [[Patterns]].\n",
		changedDaysAgo: 1,
	},
	// 26,600 bytes: 27 KB when the size is rounded, and 26 KB when it is floored.
	sized(
		{
			title: "Runbook",
			type: "Reference",
			fields: global("A runbook past the size limit", ["reference"]),
			body: head("Runbook"),
			changedDaysAgo: 12,
		},
		26_600,
	),
	{
		title: "Near Limit Runbook",
		type: "Reference",
		fields: global("A runbook a little below the size limit", ["reference"]),
		body: filler("Near Limit Runbook", 24_400),
		changedDaysAgo: 12,
		nearSizeLimit: true,
	},
	// Exactly at the size limit, and one byte below it.
	sized(
		{
			title: "Size Limit Note",
			type: "Reference",
			fields: global("A note at the size limit", ["reference"]),
			body: head("Size Limit Note"),
			changedDaysAgo: 12,
		},
		25_000,
	),
	sized(
		{
			title: "Below Size Limit Note",
			type: "Reference",
			fields: global("A note one byte below the size limit", ["reference"]),
			body: head("Below Size Limit Note"),
			changedDaysAgo: 12,
		},
		24_999,
	),
	// With these four, 13 notes have the type "Reference", the smallest group that the listing collapses.
	...[2, 3, 4, 5].map(
		(n): FixtureNote => ({
			title: `Runbook Part ${n}`,
			type: "Reference",
			fields: global(`Part ${n} of the runbook, past the size limit`, ["reference"]),
			body: filler(`Runbook Part ${n}`, 26_000),
			changedDaysAgo: 12,
		}),
	),
	{
		title: "Runbook Archive",
		type: "Archive note",
		fields: global("The old runbook entries", ["reference"]),
		body: filler("Runbook Archive", 30_000),
		changedDaysAgo: 100,
	},
];

/** The size from which the hygiene scan flags `AGENTS.md`. The fixture file is exactly at it. */
const AGENTS_FLAG_BYTES = 23_000;

/**
 * A place whose notes can hold an open loop: the folder that the hooks at
 * `fae7be4` read (`open_loop_dirs`), and the `Type` of the Work rows that
 * hold the same notes (`open_loop_types`). The manifest states both, and
 * each form reads its own key.
 */
type Watched = { readonly folders: readonly string[]; readonly type: string };

const WATCHED: readonly Watched[] = [
	{ folders: ["work/1-1"], type: "1:1" },
	{ folders: ["work/meetings"], type: "Inbox item" },
	{ folders: ["work/incidents"], type: "Incident" },
];

/** The active and the archived work notes are the rows of one `Type`. */
const WATCHED_WORK_NOTES: Watched = { folders: ["work/active", "work/archive"], type: "Work note" };

const manifest = (watched: readonly Watched[]): RepoFile => ({
	path: "vault-manifest.json",
	content: `${JSON.stringify(
		{
			template: "obsidian-mind",
			version: "10.0.0",
			open_loop_dirs: watched.flatMap(({ folders }) => folders),
			open_loop_types: watched.map(({ type }) => type),
			// "follow ups" is not a default, so a finding under that heading shows that the hook read this file.
			open_loop_sections: ["action items", "what to watch", "follow ups"],
			listing_collapse_threshold: 12,
			infrastructure: ["AGENTS.md", "CLAUDE.md", "vault-manifest.json"],
			frontmatter_required: {
				global: ["date", "description", "tags"],
				"work-note": ["date", "status", "quarter"],
				incident: ["date", "status", "quarter", "ticket", "severity", "role"],
				person: ["date", "title"],
				team: ["date"],
				"1-1": ["date", "quarter"],
			},
		},
		null,
		2,
	)}\n`,
});

/**
 * The manifest that also watches the work notes. Two archived notes are
 * old and hold a follow-up line, and no active note holds one. So 6 notes
 * have open loops, one more than the list keeps. With the manifest of the
 * fixture, 4 notes have open loops, and the list shows the notes at the
 * age limit.
 */
const MANIFEST_WITH_WORK_NOTES_WATCHED = manifest([...WATCHED, WATCHED_WORK_NOTES]);

const repoFiles: readonly RepoFile[] = [
	manifest(WATCHED),
	{ path: "AGENTS.md", content: paddedTo(head("AGENTS"), AGENTS_FLAG_BYTES) },
	{ path: "CLAUDE.md", content: "Read AGENTS.md.\n" },
	// Past the size limit. The size scan leaves out the folder of the templates.
	{ path: "templates/Work Note.md", content: filler("Work Note", 26_000) },
];

const payload = (hook: Step["hook"], fields: Readonly<Record<string, unknown>> = {}): Step => ({
	hook,
	input: { kind: "payload", fields },
});
const prompt = (text: string, fields: Readonly<Record<string, unknown>> = {}): Step =>
	payload("classify-message", { prompt: text, ...fields });
const write = (...notes: readonly string[]): Step => ({ hook: "validate-write", input: { kind: "write", notes } });

const BILLING_CLUSTER = "billing: Billing Export Pipeline, Billing Retry Design";

const CLUSTER_POLICY = "policy topic-cluster, ungrouped-cluster, flag, with the target {a topic group}";

const WRITE_CONTEXT = "additional context, event PostToolUse";
const PROMPT_CONTEXT = "additional context, event UserPromptSubmit";

/** The places that state the hygiene claims: the report lines, the one-line summary, and the report data. */
type ClaimPlace = "claim" | "summary claim" | "data claim";

const hygieneClaims = (step: number, place: ClaimPlace = "claim"): ExpectedFinding[] => [
	{ row: "HY-07", step, detail: `${place} CLAUDE.md` },
	{ row: "HY-09", step, detail: place, sizeKb: 23 },
	{ row: "HY-01", step, detail: place, count: 1 },
	{ row: "HY-02", step, detail: place },
	{ row: "HY-03", step, detail: place, count: 11 },
	{ row: "HY-04", step, detail: place, count: 4 },
	{ row: "HY-05", step, detail: place, count: 4 },
];

/** The findings with no finding of `row`: the state after the cause of that row goes away. */
const without = (row: "HY-07" | "HY-09", findings: readonly ExpectedFinding[]): ExpectedFinding[] =>
	findings
		.filter((finding) => finding.row !== row)
		.map((finding) => (finding.row === "HY-10" ? { ...finding, detail: finding.detail!.replace(`${row}, `, "") } : finding));

/**
 * 11 notes are past the size limit. The report shows the 10 largest, and
 * the note that is exactly at the limit is the one that it does not show.
 * "Runbook" has 26,600 bytes, so its size in KB shows that the hook rounds.
 */
const OVERSIZED_SHOWN: readonly (readonly [note: string, sizeKb: number])[] = [
	["Runbook", 27],
	...[2, 3, 4, 5].map((n) => [`Runbook Part ${n}`, 26] as const),
	...[1, 2, 3, 4, 5].map((n) => [`Workshop Export ${n}`, 26] as const),
];

/**
 * Four notes have open items and an age of 14 days or more. The youngest is
 * at 14 days exactly. "Retro Export" has open items at 13 days and is not
 * here. "Outage Log Archive" is older and is not here, because of its name.
 * "Planning Export" has one open item: its second item is below a heading
 * that is not a follow-up heading.
 */
const OPEN_LOOPS: readonly (readonly [note: string, openItems: number])[] = [
	["Payments Latency", 1],
	["Checkout Outage", 2],
	["Planning Export", 1],
	["Ada Park 2026-02-07", 2],
];

/**
 * The open loops when the manifest also watches the work notes: 6 notes
 * have open loops, and the list keeps the 5 oldest. The note at the age
 * limit is the one that it does not show.
 */
const OPEN_LOOPS_AT_THE_CAP: readonly (readonly [note: string, openItems: number])[] = [
	["Legacy Importer", 1],
	["Search Migration", 1],
	["Payments Latency", 1],
	["Checkout Outage", 2],
	["Planning Export", 1],
];

const hygiene = (step: number, openLoops = OPEN_LOOPS): ExpectedFinding[] => [
	{ row: "HY-10", step, detail: "order: HY-07, HY-09, HY-02, HY-03, HY-04, HY-05" },
	...hygieneClaims(step).map((claim) => (claim.row === "HY-04" ? { ...claim, count: openLoops.length } : claim)),
	{ row: "HY-01", step, note: "Old Pricing Plan" },
	{ row: "HY-02", step, detail: BILLING_CLUSTER, count: 2 },
	...OVERSIZED_SHOWN.map(([note, sizeKb]): ExpectedFinding => ({ row: "HY-03", step, note, sizeKb })),
	{ row: "HY-10", step, detail: "HY-03 more", count: 1 },
	...openLoops.map(([note, count]): ExpectedFinding => ({ row: "HY-04", step, note, count })),
];

const checklistItems = (step: number, detail: "item" | "summary item"): ExpectedFinding[] =>
	[1, 2, 3, 4, 5].map((position): ExpectedFinding => ({ row: "ST-03", step, detail: `${detail} ${position}` }));

const checklist = (step: number): ExpectedFinding[] => [{ row: "ST-03", step, count: 5 }, ...checklistItems(step, "item")];

/** The one-line summary of a Stop report. `trailer` is the row of the line that says where the full report goes. */
const summary = (step: number, trailer: "ST-09" | "ST-10"): ExpectedFinding[] => [
	{ row: "ST-03", step, detail: "summary", count: 5 },
	...checklistItems(step, "summary item"),
	...hygieneClaims(step, "summary claim"),
	{ row: trailer, step, detail: "trailer" },
];

/** The report of the `om_mod: "report"` run. `key` is the step that gave the same report key first. */
const reportData = (step: number, key: number): ExpectedFinding[] => [
	{ row: "ST-08", step, detail: "report data" },
	{ row: "ST-06", step, detail: `key first given at step ${key}` },
	...hygieneClaims(step, "data claim"),
	{ row: "ST-08", step, detail: "preface" },
	...checklist(step),
	{ row: "ST-04", step },
	...hygiene(step),
];

const HYGIENE_ROWS = ["HY-01", "HY-02", "HY-03", "HY-04", "HY-05", "HY-07", "HY-09", "HY-10"] as const;

/** The Active Work section keeps 10 names. The fixture has 11 loose active notes, so no form can state which 10. */
const ACTIVE_WORK_KEPT = 10;

const LOOSE_ACTIVE = [
	"Fixture Work Note",
	"Billing Export Pipeline",
	"Billing Retry Design",
	"Search Ranking Tuning",
	"Login Latency Budget",
	"Cache Warmup Steps",
	"Mobile Onboarding Flow",
	"Audit Trail Schema",
	"Invoice Template Refresh",
	"Quota Alert Thresholds",
	"Roadmap Sketch",
];

/**
 * 11 tasks are open: 9 in the loose active notes, then 2 in Home. The
 * section keeps 10, so the second task of Home is not here.
 */
const OPEN_TASKS: readonly (readonly [note: string, task: string])[] = [
	["Billing Export Pipeline", "Write the export schema"],
	["Billing Export Pipeline", "Measure the run time"],
	["Search Ranking Tuning", "Collect the click data"],
	["Cache Warmup Steps", "Record the cold start time"],
	["Cache Warmup Steps", "Pick the warmup keys"],
	["Mobile Onboarding Flow", "Draw the three screens"],
	["Mobile Onboarding Flow", "Count the drop-off"],
	["Audit Trail Schema", "Name the columns"],
	["Invoice Template Refresh", "Get the logo file"],
	["Home", "Review the quarter goals"],
];

/** The inbox holds 12 notes, so the listing shows each one. */
const INBOX = [
	"Vendor Sync Export",
	"Planning Export",
	"Retro Export",
	"Offsite Export",
	"Fresh Standup Export",
	"Kickoff Export",
	"Demo Export",
	...[1, 2, 3, 4, 5].map((n) => `Workshop Export ${n}`),
];

const LISTED = [
	"Home",
	"Loose Draft",
	"Moved Title No Links",
	"North Star",
	"Patterns",
	"Gotchas",
	"Key Decisions",
	"Memories",
	...LOOSE_ACTIVE,
	"Pricing Rollout",
	"Old Pricing Plan",
	"Ada Park 2026-01-10",
	"Ada Park 2026-02-07",
	"Ben Ortiz 2026-01-15",
	"Ben Ortiz 2026-03-01",
	"Checkout Outage",
	"Checkout Outage RCA",
	"Outage Call Transcript",
	"Outage Log Archive",
	"Payments Latency",
	...INBOX,
	"Ada Park",
	"Ben Ortiz",
	"Runbook Archive",
];

/** The archived work, which the listing always collapses, and the 13 notes of the type "Reference". */
const COLLAPSED = [
	"Legacy Importer",
	"Search Migration",
	"Undated Plan",
	"Missing Fields",
	"No Links",
	"Short No Links",
	"Wrapped Prose",
	"Ticket Links",
	"Runbook",
	"Near Limit Runbook",
	"Size Limit Note",
	"Below Size Limit Note",
	...[2, 3, 4, 5].map((n) => `Runbook Part ${n}`),
];

/** The line that SessionStart adds to the environment file of the session. It ends with a line break. */
const vaultPathExport = (step: number): ExpectedFinding => ({ row: "SS-02", step, detail: "export VAULT_PATH='{project directory}'\\n" });

type Section = "date" | "north star" | "brain topics" | "recent changes" | "open tasks" | "active work" | "listing" | "context pointer";

const headers = (step: number, sections: readonly Section[]): ExpectedFinding[] =>
	sections.map((section): ExpectedFinding => ({ row: "SS-19", step, detail: `header of ${section}` }));

/** The sections that each SessionStart gives: the changes, the tasks, and the active work. */
const volatileSections = (step: number): ExpectedFinding[] => [
	{ row: "SS-13", step, detail: "no history" },
	...OPEN_TASKS.map(([note, detail]): ExpectedFinding => ({ row: "SS-14", step, note, detail })),
	{ row: "SS-15", step, detail: "names", count: ACTIVE_WORK_KEPT },
];

/** The full context. `channel` is the row of the payload read: SS-19, or SS-01 when stdin is not a payload. */
const fullContext = (step: number, channel: "SS-19" | "SS-01"): ExpectedFinding[] => [
	{ row: channel, step, detail: "additional context, event SessionStart" },
	{ row: "SS-19", step, detail: "session title" },
	{ row: "SS-19", step, detail: "size meter" },
	{ row: "SS-19", step, detail: "sections: date, north star, brain topics, recent changes, open tasks, active work, listing, hygiene" },
	...headers(step, ["date", "north star", "brain topics", "recent changes", "open tasks", "active work", "listing"]),
	{ row: "SS-10", step, detail: "date line" },
	{ row: "SS-11", step, detail: "## Current Focus" },
	{ row: "SS-11", step, detail: "completed items hidden", count: 1 },
	{ row: "SS-11", step, detail: "- Ship the billing export before the quarter ends." },
	{ row: "SS-11", step, detail: "- Keep the login latency under the budget." },
	{ row: "SS-11", step, detail: "## Longer Term" },
	{ row: "SS-11", step, detail: "- Grow the platform team." },
	{ row: "SS-12", step, note: "Patterns", detail: "The patterns that repeat" },
	{ row: "SS-12", step, note: "Gotchas", detail: "The traps that cost time (empty)" },
	{ row: "SS-12", step, note: "Key Decisions", detail: "(no description)" },
	// The topics are in the order of their names. "Memories" is a brain topic that the section leaves out.
	{ row: "SS-12", step, detail: "order: Gotchas, Key Decisions, Patterns" },
	...volatileSections(step),
	...LISTED.map((note): ExpectedFinding => ({ row: "SS-16", step, note, detail: "listed" })),
	...COLLAPSED.map((note): ExpectedFinding => ({ row: "SS-16", step, note, detail: "collapsed" })),
	{ row: "SS-17", step },
	...hygiene(step),
	vaultPathExport(step),
];

/** The context after a resume or a compaction: a pointer in the place of the North Star, the brain topics, and the listing. */
const pointerContext = (step: number): ExpectedFinding[] => [
	{ row: "SS-19", step, detail: "additional context, event SessionStart" },
	{ row: "SS-19", step, detail: "session title" },
	{ row: "SS-19", step, detail: "size meter" },
	{ row: "SS-19", step, detail: "sections: date, recent changes, open tasks, active work, context pointer, hygiene" },
	...headers(step, ["date", "recent changes", "open tasks", "active work", "context pointer"]),
	{ row: "SS-10", step, detail: "date line" },
	...volatileSections(step),
	{ row: "SS-05", step, detail: "context pointer" },
	{ row: "SS-17", step },
	...hygiene(step),
	vaultPathExport(step),
];

/** `AGENTS.md` one byte below the size from which the hygiene scan flags it. */
const AGENTS_BELOW_FLAG: RepoFile = { path: "AGENTS.md", content: paddedTo(head("AGENTS"), AGENTS_FLAG_BYTES - 1) };

/** `AGENTS.md` with a different size in KB, and with the flag as before. */
const AGENTS_ONE_KB_LARGER: RepoFile = { path: "AGENTS.md", content: paddedTo(head("AGENTS"), AGENTS_FLAG_BYTES + 1000) };

/** A prompt of no session, so each prompt gets its hints again. */
const KEYWORD_PROMPTS: readonly (readonly [text: string, rows: readonly ("UP-03" | "UP-04" | "UP-05" | "UP-06")[]])[] = [
	["We chose the nightly export.", ["UP-03"]],
	["The call is to keep the cache.", ["UP-03"]],
	["方針を決定した。", ["UP-03"]],
	["We decided to keep the queue, so the old plan is overturned.", ["UP-03", "UP-04"]],
	["The login page is a p0 for the team.", ["UP-05"]],
	["I had a sync with the vendor.", ["UP-06"]],
];

const MISSING_ROLE_WARNING: readonly ExpectedFinding[] = [
	{ row: "VW-17", detail: WRITE_CONTEXT },
	{ row: "VW-13", note: "Ben Ortiz", count: 1 },
	{ row: "VW-09", note: "Ben Ortiz", detail: "Role" },
];

const scenarios: readonly Scenario[] = [
	{
		id: "session-start",
		rows: ["SS-02", "SS-06", "SS-10", "SS-11", "SS-12", "SS-13", "SS-14", "SS-15", "SS-16", "SS-17", "SS-19", ...HYGIENE_ROWS],
		steps: [payload("session-start", { source: "startup" })],
		expect: fullContext(0, "SS-19"),
		// The manifest read prints no line. "Follow Ups" is a heading that only the manifest of the fixture names.
		provenBy: { "SS-06": { row: "HY-04", note: "Planning Export", count: 1 } },
	},
	{
		id: "session-start-bad-stdin",
		rows: ["SS-01"],
		steps: [{ hook: "session-start", input: { kind: "raw", stdin: "{not json" } }],
		expect: fullContext(0, "SS-01"),
	},
	{
		id: "session-start-pointer",
		rows: ["SS-05"],
		steps: [payload("session-start", { source: "resume" }), payload("session-start", { source: "compact" })],
		expect: [...pointerContext(0), ...pointerContext(1)],
	},
	{
		id: "session-start-standdown",
		rows: ["SS-02", "SS-03"],
		steps: [payload("session-start", { source: "startup", om_mod: "standdown" })],
		expect: [{ row: "SS-03", detail: "silent" }, vaultPathExport(0)],
	},

	{
		id: "write-clean",
		// The note is above the no-link length, and its one link names a person. So a link to any note is enough.
		rows: ["VW-10", "VW-17"],
		steps: [write("Fixture Work Note")],
		expect: [{ row: "VW-17", detail: "silent" }],
	},
	{
		id: "write-memory-index",
		rows: ["VW-03"],
		steps: [{ hook: "validate-write", input: { kind: "memory-write", file: "MEMORY.md" } }],
		expect: [{ row: "VW-17", detail: "silent" }],
	},
	{
		id: "write-memory-file",
		rows: ["VW-03"],
		steps: [{ hook: "validate-write", input: { kind: "memory-write", file: "lesson.md" } }],
		expect: [
			{ row: "VW-17", detail: WRITE_CONTEXT },
			{ row: "VW-03", detail: "lesson.md" },
			{
				row: "VW-03",
				detail: "policy memory-location, misplaced-memory, warn, with the target {brain topics}, at ~/.claude/projects/parity/memory/lesson.md",
			},
		],
	},
	{
		id: "write-no-frontmatter",
		rows: ["VW-07", "VW-13"],
		steps: [write("Loose Draft")],
		expect: [
			{ row: "VW-17", detail: WRITE_CONTEXT },
			{ row: "VW-13", note: "Loose Draft", count: 1 },
			{ row: "VW-07", note: "Loose Draft" },
		],
	},
	{
		id: "write-missing-global-fields",
		rows: ["VW-08", "VW-13"],
		steps: [write("Missing Fields")],
		expect: [
			{ row: "VW-17", detail: WRITE_CONTEXT },
			{ row: "VW-13", note: "Missing Fields", count: 2 },
			{ row: "VW-08", note: "Missing Fields", detail: "Description" },
			{ row: "VW-08", note: "Missing Fields", detail: "Tags" },
		],
	},
	{
		id: "write-without-date",
		rows: ["VW-08"],
		steps: [write("Undated Plan")],
		expect: [
			{ row: "VW-17", detail: WRITE_CONTEXT },
			{ row: "VW-13", note: "Undated Plan", count: 1 },
			{ row: "VW-08", note: "Undated Plan", detail: "Date" },
		],
	},
	{
		id: "write-active-without-quarter",
		rows: ["VW-09"],
		steps: [write("Roadmap Sketch")],
		expect: [
			{ row: "VW-17", detail: WRITE_CONTEXT },
			{ row: "VW-13", note: "Roadmap Sketch", count: 1 },
			{ row: "VW-09", note: "Roadmap Sketch", detail: "Quarter" },
		],
	},
	{
		id: "write-missing-typed-field",
		rows: ["VW-09"],
		steps: [write("Ben Ortiz")],
		expect: MISSING_ROLE_WARNING,
	},
	{
		id: "write-without-event-name",
		rows: ["VW-17"],
		steps: [{ ...write("Ben Ortiz"), withoutEventName: true }],
		expect: MISSING_ROLE_WARNING,
	},
	{
		id: "write-incident-without-tag",
		// The note also holds a code block of two lines, which is not a wrapped paragraph.
		rows: ["VW-09", "VW-11"],
		steps: [write("Checkout Outage RCA")],
		expect: [{ row: "VW-17", detail: "silent" }],
	},
	{
		id: "write-verbatim",
		rows: ["VW-11"],
		steps: [write("Outage Call Transcript")],
		expect: [{ row: "VW-17", detail: "silent" }],
	},
	{
		id: "write-no-links",
		rows: ["VW-10"],
		steps: [write("No Links")],
		expect: [
			{ row: "VW-17", detail: WRITE_CONTEXT },
			{ row: "VW-13", note: "No Links", count: 1 },
			{ row: "VW-10", note: "No Links" },
		],
	},
	{
		id: "write-no-links-moved-title",
		rows: ["VW-10"],
		steps: [write("Moved Title No Links")],
		expect: [
			{ row: "VW-17", detail: WRITE_CONTEXT },
			{ row: "VW-13", note: "Moved Title No Links", count: 2 },
			{ row: "VW-07", note: "Moved Title No Links" },
			{ row: "VW-10", note: "Moved Title No Links" },
		],
	},
	{
		id: "write-no-links-at-length-limit",
		rows: ["VW-10"],
		steps: [write("Short No Links")],
		expect: [{ row: "VW-17", detail: "silent" }],
	},
	{
		id: "write-hard-wrap",
		rows: ["VW-11"],
		steps: [write("Wrapped Prose")],
		expect: [
			{ row: "VW-17", detail: WRITE_CONTEXT },
			{ row: "VW-13", note: "Wrapped Prose", count: 1 },
			{ row: "VW-11", note: "Wrapped Prose", count: 2 },
		],
	},
	{
		id: "write-ticket-links",
		rows: ["VW-12"],
		steps: [write("Ticket Links")],
		expect: [
			{ row: "VW-17", detail: WRITE_CONTEXT },
			{ row: "VW-13", note: "Ticket Links", count: 1 },
			{ row: "VW-12", note: "Ticket Links", count: 2 },
			{ row: "VW-12", note: "Ticket Links", detail: "policy phantom-edge, ticket-id-wikilink, warn" },
		],
	},
	{
		id: "write-oversized",
		rows: ["VW-14"],
		steps: [write("Runbook")],
		expect: [
			{ row: "VW-17", detail: WRITE_CONTEXT },
			{ row: "VW-14", note: "Runbook", sizeKb: 27 },
			{ row: "VW-14", note: "Runbook", detail: "policy organization-threshold, oversized-note, flag" },
		],
	},
	{
		id: "write-at-size-limit",
		rows: ["VW-14"],
		steps: [write("Size Limit Note")],
		expect: [
			{ row: "VW-17", detail: WRITE_CONTEXT },
			{ row: "VW-14", note: "Size Limit Note", sizeKb: 25 },
			{ row: "VW-14", note: "Size Limit Note", detail: "policy organization-threshold, oversized-note, flag" },
		],
	},
	{
		id: "write-below-size-limit",
		rows: ["VW-14"],
		steps: [write("Below Size Limit Note")],
		expect: [{ row: "VW-17", detail: "silent" }],
	},
	{
		id: "write-near-size-limit",
		rows: ["VW-14"],
		steps: [write("Near Limit Runbook")],
		expect: [{ row: "VW-17", detail: "silent" }],
	},
	{
		id: "write-oversized-archive",
		rows: ["VW-14"],
		steps: [write("Runbook Archive")],
		expect: [{ row: "VW-17", detail: "silent" }],
	},
	{
		id: "write-joins-cluster",
		rows: ["VW-15"],
		steps: [write("Billing Retry Design")],
		expect: [
			{ row: "VW-17", detail: WRITE_CONTEXT },
			{ row: "VW-15", detail: BILLING_CLUSTER, count: 1 },
			{ row: "VW-15", note: "Billing Retry Design", detail: CLUSTER_POLICY },
		],
	},
	{
		id: "write-two-notes",
		rows: ["VW-15", "VW-16"],
		steps: [write("Billing Export Pipeline", "Billing Retry Design")],
		// Both notes join the same cluster. The envelope states the cluster one time and has one policy result for each note.
		expect: [
			{ row: "VW-17", detail: WRITE_CONTEXT },
			{ row: "VW-16", detail: "blocks", count: 1 },
			{ row: "VW-15", detail: BILLING_CLUSTER, count: 1 },
			{ row: "VW-15", note: "Billing Export Pipeline", detail: CLUSTER_POLICY },
			{ row: "VW-15", note: "Billing Retry Design", detail: CLUSTER_POLICY },
		],
	},

	{
		id: "prompt-signals",
		rows: ["UP-03", "UP-05", "UP-06", "UP-07", "UP-08", "UP-09", "UP-10", "UP-12", "UP-14"],
		steps: [
			prompt("We decided to keep the nightly export."),
			prompt("There was an outage on the checkout page."),
			prompt("Notes of my 1:1 are below."),
			prompt("The sales team gave us kudos."),
			prompt("Here is the system design of the queue."),
			prompt("Ada told me about the plan."),
			prompt("The sprint ends on Friday."),
		],
		expect: (["UP-03", "UP-05", "UP-06", "UP-07", "UP-08", "UP-09", "UP-10"] as const).flatMap(
			(row, step): ExpectedFinding[] => [
				{ row: "UP-14", step, detail: PROMPT_CONTEXT },
				{ row: "UP-12", step, detail: row, count: 1 },
				{ row, step },
			],
		),
	},
	{
		id: "prompt-decision-reversal",
		rows: ["UP-03", "UP-04"],
		steps: [prompt("We decided to drop the cache, so the old choice is superseded.")],
		expect: [
			{ row: "UP-14", detail: PROMPT_CONTEXT },
			{ row: "UP-12", detail: "UP-03, UP-04", count: 2 },
			{ row: "UP-03" },
			{ row: "UP-04" },
		],
	},
	{
		id: "prompt-hint-once-per-session",
		rows: ["UP-11"],
		steps: [prompt("We decided to keep the nightly export."), prompt("We decided to keep the weekly export.")],
		expect: [
			{ row: "UP-14", step: 0, detail: PROMPT_CONTEXT },
			{ row: "UP-12", step: 0, detail: "UP-03", count: 1 },
			{ row: "UP-03", step: 0 },
			{ row: "UP-14", step: 1, detail: "silent" },
		],
		// The dedupe prints no line. Its result is the silence of the second prompt.
		provenBy: { "UP-11": { row: "UP-14", step: 1, detail: "silent" } },
	},
	{
		id: "prompt-hint-without-session",
		rows: ["UP-11"],
		steps: [
			prompt("We decided to keep the nightly export.", { session_id: "" }),
			prompt("We decided to keep the weekly export.", { session_id: "" }),
		],
		expect: [0, 1].flatMap((step): ExpectedFinding[] => [
			{ row: "UP-14", step, detail: PROMPT_CONTEXT },
			{ row: "UP-12", step, detail: "UP-03", count: 1 },
			{ row: "UP-03", step },
		]),
	},
	{
		id: "prompt-keywords",
		rows: ["UP-03", "UP-04", "UP-05", "UP-06"],
		steps: KEYWORD_PROMPTS.map(([text]) => prompt(text, { session_id: "" })),
		expect: KEYWORD_PROMPTS.flatMap(([, rows], step): ExpectedFinding[] => [
			{ row: "UP-14", step, detail: PROMPT_CONTEXT },
			{ row: "UP-12", step, detail: rows.join(", "), count: rows.length },
			...rows.map((row): ExpectedFinding => ({ row, step })),
		]),
	},
	{
		id: "prompt-without-event-name",
		rows: ["UP-14"],
		steps: [{ ...prompt("We decided to keep the nightly export."), withoutEventName: true }],
		expect: [{ row: "UP-14", detail: PROMPT_CONTEXT }, { row: "UP-12", detail: "UP-03", count: 1 }, { row: "UP-03" }],
	},
	{
		id: "prompt-no-signal",
		rows: ["UP-14"],
		steps: [prompt("What is the time in Lisbon?")],
		expect: [{ row: "UP-14", detail: "silent" }],
	},
	{
		id: "prompt-bad-stdin",
		rows: ["UP-01"],
		steps: [
			{ hook: "classify-message", input: { kind: "raw", stdin: "" } },
			{ hook: "classify-message", input: { kind: "raw", stdin: "{not json" } },
		],
		expect: [
			{ row: "UP-01", step: 0, detail: "silent" },
			{ row: "UP-01", step: 1, detail: "silent" },
		],
	},

	{
		id: "stop-then-prompt",
		rows: ["ST-03", "ST-04", "ST-05", "ST-09", "UP-02", ...HYGIENE_ROWS],
		// The first prompt takes the report, so the second prompt has no report.
		steps: [payload("stop-checklist"), prompt("What is the time in Lisbon?"), prompt("What is the time in Lisbon?")],
		expect: [
			{ row: "ST-09", step: 0, detail: "system message" },
			...summary(0, "ST-09"),
			{ row: "UP-14", step: 1, detail: PROMPT_CONTEXT },
			{ row: "UP-02", step: 1 },
			{ row: "ST-09", step: 1, detail: "preface" },
			...checklist(1),
			{ row: "ST-04", step: 1 },
			...hygiene(1),
			{ row: "UP-14", step: 2, detail: "silent" },
		],
		// The manifest read prints no line. "Follow Ups" is a heading that only the manifest of the fixture names.
		provenBy: { "ST-05": { row: "HY-04", step: 1, note: "Planning Export", count: 1 } },
	},
	{
		id: "stop-then-prompt-with-hint",
		rows: ["UP-02", "UP-12", "UP-14"],
		steps: [payload("stop-checklist"), prompt("We decided to keep the nightly export.")],
		expect: [
			{ row: "ST-09", step: 0, detail: "system message" },
			...summary(0, "ST-09"),
			{ row: "UP-14", step: 1, detail: PROMPT_CONTEXT },
			{ row: "UP-12", step: 1, detail: "UP-03", count: 1 },
			{ row: "UP-03", step: 1 },
			{ row: "UP-14", step: 1, detail: "a blank line between the parts" },
			{ row: "UP-02", step: 1 },
			{ row: "ST-09", step: 1, detail: "preface" },
			...checklist(1),
			{ row: "ST-04", step: 1 },
			...hygiene(1),
		],
	},
	{
		id: "stop-then-prompt-of-other-session",
		rows: ["ST-09", "UP-02"],
		// The report waits for the session of the Stop. A prompt of a different session does not get it.
		steps: [
			payload("stop-checklist"),
			prompt("What is the time in Lisbon?", { session_id: "a-different-session" }),
			prompt("What is the time in Lisbon?"),
		],
		expect: [
			{ row: "ST-09", step: 0, detail: "system message" },
			...summary(0, "ST-09"),
			{ row: "UP-14", step: 1, detail: "silent" },
			{ row: "UP-14", step: 2, detail: PROMPT_CONTEXT },
			{ row: "UP-02", step: 2 },
			{ row: "ST-09", step: 2, detail: "preface" },
			...checklist(2),
			{ row: "ST-04", step: 2 },
			...hygiene(2),
		],
	},
	{
		id: "stop-twice",
		rows: ["ST-06", "ST-07", "ST-09"],
		steps: [payload("stop-checklist"), payload("stop-checklist")],
		expect: [
			{ row: "ST-09", step: 0, detail: "system message" },
			...summary(0, "ST-09"),
			{ row: "ST-07", step: 1, detail: "empty envelope" },
		],
	},
	{
		id: "stop-after-report-change",
		rows: ["ST-06", "ST-07", "ST-09"],
		steps: [
			payload("stop-checklist"),
			{ ...payload("stop-checklist"), removeRepoFile: "CLAUDE.md" },
			payload("stop-checklist"),
		],
		expect: [
			{ row: "ST-09", step: 0, detail: "system message" },
			...summary(0, "ST-09"),
			{ row: "ST-09", step: 1, detail: "system message" },
			...without("HY-07", summary(1, "ST-09")),
			{ row: "ST-07", step: 2, detail: "empty envelope" },
		],
	},
	{
		id: "stop-after-size-change",
		rows: ["ST-06", "ST-07", "HY-09"],
		// The size of `AGENTS.md` in KB is a measure and not a part of the report key, so the second Stop is silent.
		steps: [payload("stop-checklist"), { ...payload("stop-checklist"), replaceRepoFile: AGENTS_ONE_KB_LARGER }],
		expect: [
			{ row: "ST-09", step: 0, detail: "system message" },
			...summary(0, "ST-09"),
			{ row: "ST-07", step: 1, detail: "empty envelope" },
		],
	},
	{
		id: "stop-standdown",
		rows: ["ST-01"],
		steps: [payload("stop-checklist", { om_mod: "standdown" })],
		expect: [{ row: "ST-01", detail: "empty envelope" }],
	},
	{
		id: "stop-reentry",
		rows: ["ST-02"],
		steps: [payload("stop-checklist", { stop_hook_active: true }), payload("stop-checklist", { stopHookActive: true })],
		expect: [
			{ row: "ST-02", step: 0, detail: "empty envelope" },
			{ row: "ST-02", step: 1, detail: "empty envelope" },
		],
	},
	{
		id: "stop-report-data",
		rows: ["ST-03", "ST-04", "ST-06", "ST-08", ...HYGIENE_ROWS],
		steps: [payload("stop-checklist", { om_mod: "report" })],
		expect: reportData(0, 0),
	},
	{
		id: "stop-report-data-after-change",
		rows: ["ST-06", "ST-08"],
		steps: [
			payload("stop-checklist", { om_mod: "report" }),
			payload("stop-checklist", { om_mod: "report" }),
			{ ...payload("stop-checklist", { om_mod: "report" }), removeRepoFile: "CLAUDE.md" },
		],
		expect: [...reportData(0, 0), ...reportData(1, 0), ...without("HY-07", reportData(2, 2))],
	},
	{
		id: "stop-handoff-blocked",
		rows: ["ST-03", "ST-04", "ST-10", ...HYGIENE_ROWS],
		steps: [payload("stop-checklist")],
		blockHandoff: true,
		expect: [
			{ row: "ST-10", detail: "system message and feedback, event Stop" },
			{ row: "ST-10", detail: "preface" },
			...summary(0, "ST-10"),
			...checklist(0),
			{ row: "ST-04" },
			...hygiene(0),
		],
	},
	{
		id: "stop-full-message",
		rows: ["ST-03", "ST-04", "ST-11", ...HYGIENE_ROWS],
		steps: [payload("stop-checklist", { hook_event_name: "SessionEnd" }), payload("stop-checklist", { session_id: "" })],
		expect: [0, 1].flatMap((step): ExpectedFinding[] => [
			{ row: "ST-11", step, detail: "system message" },
			...checklist(step),
			{ row: "ST-04", step },
			...hygiene(step),
		]),
	},
	{
		id: "stop-agents-below-flag",
		rows: ["HY-09"],
		steps: [{ ...payload("stop-checklist", { session_id: "" }), replaceRepoFile: AGENTS_BELOW_FLAG }],
		expect: [{ row: "ST-11", detail: "system message" }, ...checklist(0), { row: "ST-04" }, ...without("HY-09", hygiene(0))],
	},

	{
		id: "stop-open-loops-at-the-cap",
		rows: ["HY-04", "ST-05"],
		steps: [{ ...payload("stop-checklist", { session_id: "" }), replaceRepoFile: MANIFEST_WITH_WORK_NOTES_WATCHED }],
		expect: [{ row: "ST-11", detail: "system message" }, ...checklist(0), { row: "ST-04" }, ...hygiene(0, OPEN_LOOPS_AT_THE_CAP)],
	},

	{
		id: "pre-compact-backup",
		rows: ["PC-03", "PC-04"],
		steps: [payload("pre-compact", { trigger: "auto", custom_instructions: "" })],
		expect: [
			{ row: "PC-01", detail: "silent" },
			{ row: "PC-03", detail: "auto", count: 1 },
			{ row: "PC-04", count: 1 },
		],
	},
	{
		id: "pre-compact-retention",
		rows: ["PC-03", "PC-04"],
		steps: [payload("pre-compact", { trigger: "manual", custom_instructions: "" })],
		oldSessionLogs: 31,
		foreignSessionLog: true,
		expect: [
			{ row: "PC-01", detail: "silent" },
			{ row: "PC-03", detail: "manual", count: 1 },
			// The new copy and the 29 newest old copies stay. The foreign file is not a copy, so it stays and is not one of the 30.
			{ row: "PC-04", count: 31 },
			{ row: "PC-04", detail: "old backups removed: 0, 1", count: 2 },
			{ row: "PC-04", detail: "the foreign file stays" },
		],
	},
	{
		id: "pre-compact-bad-stdin",
		rows: ["PC-01"],
		steps: [{ hook: "pre-compact", input: { kind: "raw", stdin: "{not json" } }],
		expect: [
			{ row: "PC-01", detail: "silent" },
			{ row: "PC-04", count: 0 },
		],
	},
];

export const FIXTURE: FixtureSpec = { notes, repoFiles, scenarios };
