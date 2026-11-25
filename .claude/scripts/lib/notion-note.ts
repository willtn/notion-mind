/**
 * A note that a Notion write made or changed, in the terms of the write
 * check: where the page is, the properties that a person writes, and the
 * body.
 *
 *     const note: WrittenNote = { id, url, title, place: { kind: "row", database: "work" }, properties, body, changed: true };
 *     noteMarkdown(note)                    // "---\ndate: 2026-01-05\n---\n\n# Title\n…"
 *     missingFields(note, required)         // ["quarter"]
 *
 * `noteMarkdown` is the note as the Markdown file that the import reads.
 * The checks count characters, bytes, and lines of that text, so a limit
 * of the Markdown form is the same limit here.
 */

import type { FrontmatterRequired } from "./frontmatter.ts";
import { DATABASES, VERBATIM_PROPERTY, type DatabaseKey } from "./notion-model.ts";

export type Place =
	| { readonly kind: "row"; readonly database: DatabaseKey }
	/** A page of the setup under the root page, such as Home. It has no properties. */
	| { readonly kind: "scaffold" }
	/** A page under the root page that is not a row and not a page of the setup. */
	| { readonly kind: "page" }
	/** A page that the root page does not hold. */
	| { readonly kind: "outside" };

/** Properties in the argument form of Notion: `Tags`, `date:Date:start`. A reply of `notion-fetch` has the same form. */
export type Properties = Readonly<Record<string, unknown>>;

export interface WrittenNote {
	readonly id: string;
	readonly url: string;
	readonly title: string;
	readonly place: Place;
	readonly properties: Properties;
	/** The body as Notion-flavored Markdown. */
	readonly body: string;
	/** True when the write changed the body or a property that a person writes. */
	readonly changed: boolean;
}

/** The properties that the write hook sets. A write of only these is not a change of the note. */
export const DERIVED_PROPERTIES: readonly string[] = ["Bytes", "Open tasks", "Open loops", "Has content", "Changed", "Hook stamp"];

/**
 * The Notion property of each frontmatter field, as part c.2 of the design
 * record lists them. A relation is not here: the row holds a page ID and
 * not the title that the Markdown file has, so it adds no text.
 */
const PROPERTY_OF_FIELD: Readonly<Record<string, string>> = {
	date: "Date",
	description: "Description",
	tags: "Tags",
	status: "Status",
	quarter: "Quarter",
	project: "Project",
	ticket: "Ticket",
	severity: "Severity",
	role: "Role",
	context: "Context",
	cycle: "Cycle",
	period: "Period",
};

/** A database that reads a property from a different field. The `Role` of a person is the field `title`. */
const FIELD_OVERRIDES: Readonly<Partial<Record<DatabaseKey, Readonly<Record<string, string>>>>> = {
	people: { title: "Role" },
};

/** The property that holds `field` in `database`. A field that the model does not list has its own name with a capital. */
export function propertyOfField(database: DatabaseKey, field: string): string {
	return FIELD_OVERRIDES[database]?.[field] ?? PROPERTY_OF_FIELD[field] ?? field.charAt(0).toUpperCase() + field.slice(1);
}

/** Each frontmatter field of `database` with its property. */
function fieldsOf(database: DatabaseKey): (readonly [field: string, property: string])[] {
	const overrides = FIELD_OVERRIDES[database] ?? {};
	const overridden = new Set(Object.values(overrides));
	const properties = DATABASES.find((spec) => spec.key === database)?.properties ?? {};
	return [...Object.entries(PROPERTY_OF_FIELD).filter(([, property]) => !overridden.has(property)), ...Object.entries(overrides)].filter(
		([, property]) => property in properties,
	);
}

/** A list value. A query row holds it as the JSON text of an array. */
function listOf(raw: unknown): unknown[] | null {
	if (Array.isArray(raw)) return raw;
	if (typeof raw !== "string" || !raw.startsWith("[")) return null;
	try {
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

/** The value of `property`, or `null` when the property is empty. A list has one item or more. */
export function valueOf(properties: Properties, property: string): string | readonly string[] | null {
	const raw = properties[property] ?? properties[`date:${property}:start`];
	const list = listOf(raw);
	if (list !== null) {
		const items = list.map((item) => (typeof item === "string" ? item : JSON.stringify(item))).filter((item) => item.trim() !== "");
		return items.length === 0 ? null : items;
	}
	if (typeof raw === "number") return String(raw);
	return typeof raw === "string" && raw.trim() !== "" ? raw : null;
}

const tagsOf = (note: WrittenNote): readonly string[] => {
	const tags = valueOf(note.properties, "Tags");
	return tags === null ? [] : typeof tags === "string" ? [tags] : tags;
};

/** True for a raw capture. The Markdown form has the key `verbatim: true` for it, and such a note has no wrap finding. */
export const isVerbatimNote = (note: WrittenNote): boolean => note.properties[VERBATIM_PROPERTY] === "__YES__";

const yamlValue = (value: string | readonly string[]): string => (typeof value === "string" ? ` ${value}` : value.map((item) => `\n  - ${item}`).join(""));

const LABELED_MENTION = /<mention url="[^"]*"[^>]*>([^<]+)<\/mention>/g;

/** The properties that come from frontmatter as a YAML block with a blank line after it, or "" for a note with none. */
export function frontmatterBlock(note: WrittenNote): string {
	if (note.place.kind !== "row") return "";
	const lines = fieldsOf(note.place.database).flatMap(([field, property]) => {
		const value = valueOf(note.properties, property);
		return value === null ? [] : [`${field}:${yamlValue(value)}`];
	});
	if (isVerbatimNote(note)) lines.push("verbatim: true");
	return lines.length === 0 ? "" : `---\n${lines.join("\n")}\n---\n\n`;
}

/**
 * The note as a Markdown file: the frontmatter block, then the body. A
 * mention that names its page is the link `[[Title]]`, as in the vault. A
 * mention with no name stays as it is.
 */
export function noteMarkdown(note: WrittenNote): string {
	return frontmatterBlock(note) + note.body.replace(LABELED_MENTION, (_, label: string) => `[[${label}]]`);
}

/** True when a relation of the row holds a page. A relation is the Notion form of a link in frontmatter or in the body. */
export function hasRelation(note: WrittenNote): boolean {
	if (note.place.kind !== "row") return false;
	const database = note.place.database;
	const properties = DATABASES.find((spec) => spec.key === database)?.properties ?? {};
	return Object.entries(properties).some(([name, spec]) => spec.type === "relation" && valueOf(note.properties, name) !== null);
}

/** How the write check reads the rows of one `Type`: no check, or the typed field set of `frontmatter_required`. */
type Rule =
	| { readonly skip: true }
	| { readonly skip?: false; readonly required: string | null; /** The typed set applies only to a row with this tag. */ readonly onlyWithTag?: string };

const GLOBAL_ONLY: Rule = { required: null };

/**
 * The rule of each database, and of each `Type` that differs from it. The
 * hooks at `fae7be4` read the same rules from the folder of a file:
 * `templates/` and `thinking/` get no check, and `work/incidents/` needs
 * the incident fields only for a note with the tag `incident`.
 */
const RULES: Readonly<Record<DatabaseKey, { readonly rule: Rule; readonly byType?: Readonly<Record<string, Rule>> }>> = {
	work: {
		rule: GLOBAL_ONLY,
		byType: {
			"Work note": { required: "work-note" },
			Decision: { required: "work-note" },
			Incident: { required: "incident", onlyWithTag: "incident" },
			"1:1": { required: "1-1" },
			Thinking: { skip: true },
		},
	},
	people: { rule: { required: "person" } },
	teams: { rule: { required: "team" } },
	competencies: { rule: GLOBAL_ONLY },
	perf_docs: { rule: GLOBAL_ONLY },
	knowledge: { rule: GLOBAL_ONLY },
	templates: { rule: { skip: true } },
};

function ruleOf(note: WrittenNote): Rule {
	if (note.place.kind !== "row") return note.place.kind === "outside" ? { skip: true } : GLOBAL_ONLY;
	const { rule, byType = {} } = RULES[note.place.database];
	const type = valueOf(note.properties, "Type");
	return (typeof type === "string" ? byType[type] : undefined) ?? rule;
}

/** True for a page that gets no check: a template, a thinking note, and a page outside the root. */
export const isSkipped = (note: WrittenNote): boolean => ruleOf(note).skip === true;

const DEFAULT_GLOBAL: readonly string[] = ["date", "description", "tags"];

/** A required field of `frontmatter_required` whose property is empty, with that property. A page that is not a row has no fields. */
export function missingFields(note: WrittenNote, required: FrontmatterRequired): { readonly field: string; readonly property: string }[] {
	if (note.place.kind !== "row") return [];
	const database = note.place.database;
	const rule = ruleOf(note);
	if (rule.skip) return [];
	const global = required["global"]?.length ? required["global"] : DEFAULT_GLOBAL;
	const typed = rule.required === null || (rule.onlyWithTag !== undefined && !tagsOf(note).includes(rule.onlyWithTag)) ? [] : (required[rule.required] ?? []);
	return [...new Set([...global, ...typed])]
		.map((field) => ({ field, property: propertyOfField(database, field) }))
		.filter(({ property }) => valueOf(note.properties, property) === null);
}
