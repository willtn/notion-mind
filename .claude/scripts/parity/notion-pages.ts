/**
 * A fixture note as a Notion page: where it is, the properties that it
 * holds, and its content. Each function here is pure. `notion-form.ts` reads
 * the live pages and writes only the difference.
 */

import { derivedValues } from "../lib/notion-derived.ts";
import { DATABASES, VERBATIM_PROPERTY, type DatabaseKey, type DatabaseSpec, type PageKey, type PropertySpec } from "../lib/notion-model.ts";
import { notionId } from "../lib/notion-parse.ts";
import { renderNote } from "./markdown-form.ts";
import { changedAt, NOTE_TYPES, PROPERTY_OF_FIELD, type Field, type FixtureNote, type NoteType } from "./spec.ts";

export type Target =
	| { readonly kind: "row"; readonly database: DatabaseKey }
	/** A page that the setup makes under the root. */
	| { readonly kind: "scaffold"; readonly page: PageKey }
	/** A plain page under the root. */
	| { readonly kind: "loose" };

const SCAFFOLD_PAGES: Readonly<Partial<Record<NoteType, PageKey>>> = { "North Star": "north_star", Home: "home" };

function databaseSpec(key: DatabaseKey): DatabaseSpec {
	const spec = DATABASES.find((database) => database.key === key);
	if (spec === undefined) throw new Error(`The model has no database with the key "${key}".`);
	return spec;
}

/** The spec names a database by its title. The model and the map file name it by its key. */
export function targetOf(note: FixtureNote): Target {
	const title = NOTE_TYPES[note.type].database;
	if (title === null) {
		if (note.verbatim) throw new Error(`${note.title} is a verbatim note outside the databases. The mark is the property "${VERBATIM_PROPERTY}", and such a page has no properties.`);
		const page = SCAFFOLD_PAGES[note.type];
		return page === undefined ? { kind: "loose" } : { kind: "scaffold", page };
	}
	const spec = DATABASES.find((database) => database.title === title);
	if (spec === undefined) throw new Error(`The note type "${note.type}" names the database "${title}", which the model does not have.`);
	return { kind: "row", database: spec.key };
}

/** Each database that can hold a fixture note, by the note types of the spec. */
export const FIXTURE_DATABASES: readonly DatabaseKey[] = [...new Set(Object.values(NOTE_TYPES).flatMap((type) => (type.database === null ? [] : [type.database])))].map((title) => {
	const spec = DATABASES.find((database) => database.title === title);
	if (spec === undefined) throw new Error(`A note type names the database "${title}", which the model does not have.`);
	return spec.key;
});

/** The listing group of the Work notes that are not active. The vault kept them in `work/archive/`, and the listing shows them as one line. */
export const ARCHIVED_WORK_GROUP = "Work / Archived";

const isArchivedWork = (note: FixtureNote): boolean => note.type === "Work note" && note.fields.status !== "active";

/**
 * The titles of the fixture notes of a listing group (SS-16). A group has
 * one of three names.
 *
 * - A database and a `Type`, for example "Knowledge / Reference". An
 *   archived Work note is in `ARCHIVED_WORK_GROUP` and not in the group of
 *   its `Type`, so each row is in exactly one group of this form.
 * - A `Type` alone: each note of that type.
 * - A database alone: each note of that database.
 */
export function notesInGroup(notes: readonly FixtureNote[], group: string): string[] {
	const inGroup = (note: FixtureNote): boolean => {
		const database = NOTE_TYPES[note.type].database;
		if (note.type === group || database === group) return true;
		return database !== null && group === (isArchivedWork(note) ? ARCHIVED_WORK_GROUP : `${database} / ${note.type}`);
	};
	return notes.filter(inGroup).map((note) => note.title);
}

/** A fixture note that exists in Notion. */
export interface PageRef {
	readonly id: string;
	readonly url: string;
	readonly target: Target;
}

/** The page of each fixture note, by title. */
export type Pages = ReadonlyMap<string, PageRef>;

/**
 * One property value, in the form that a spec value and a live value share.
 * `null` is an empty property. A date is `YYYY-MM-DD`, or `YYYY-MM-DDTHH:MM`
 * in UTC, because Notion keeps a time to the minute. A relation holds page
 * IDs. A list is in sorted order and is not empty.
 */
export type Value = string | number | boolean | readonly string[] | null;
export type Values = Readonly<Record<string, Value>>;

const TYPE = "Type";
const DERIVED = ["Changed", "Bytes", "Open tasks", "Open loops", "Has content"] as const;
/** The relations that a body link fills. Each takes the links to rows of its target database. */
const LINK_RELATIONS = ["Person", "Related"] as const;

/** The properties of a database that the fixture sets. A property that a note does not set is empty. */
export function managedProperties(database: DatabaseKey): string[] {
	const properties = databaseSpec(database).properties;
	return [...new Set([TYPE, ...Object.values(PROPERTY_OF_FIELD), VERBATIM_PROPERTY, ...LINK_RELATIONS, ...DERIVED])].filter((name) => name in properties);
}

const WIKILINK = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;
const linkedTitles = (body: string): string[] => [...body.matchAll(WIKILINK)].map((match) => (match[1] ?? "").trim());

const listValue = (items: readonly string[]): Value => (items.length === 0 ? null : [...new Set(items)].sort());
const minute = (date: Date): string => date.toISOString().slice(0, 16);

export interface NoteContext {
	readonly now: Date;
	/** The heading test of `open_loop_sections` in the manifest of the spec. */
	readonly openLoopSections: RegExp;
	readonly pages: Pages;
}

/** The value of each managed property of the row of `note`, the derived properties included. */
export function desiredValues(note: FixtureNote, database: DatabaseKey, context: NoteContext): Values {
	const properties = databaseSpec(database).properties;
	const values: Record<string, Value> = {};
	for (const name of managedProperties(database)) values[name] = properties[name]?.type === "checkbox" ? false : null;

	const idOf = (title: string, property: string): string => {
		const page = context.pages.get(title);
		if (page === undefined) throw new Error(`${note.title}: "${property}" names "${title}", which is not a fixture note.`);
		return page.id;
	};
	for (const field of Object.keys(note.fields) as Field[]) {
		const name = PROPERTY_OF_FIELD[field];
		const property = properties[name];
		if (property === undefined) throw new Error(`${note.title}: the field "${field}" needs the property "${name}", which the database "${database}" does not have.`);
		const raw = note.fields[field] ?? [];
		const items = typeof raw === "string" ? [raw] : raw;
		if (property.type === "relation") values[name] = listValue(items.map((title) => idOf(title, name)));
		else if (property.type === "multi_select") values[name] = listValue(items);
		else if (typeof raw === "string") values[name] = raw;
		else throw new Error(`${note.title}: the field "${field}" is a list, and the property "${name}" holds one value.`);
	}
	if (TYPE in properties) values[TYPE] = note.type;
	if (note.verbatim) values[VERBATIM_PROPERTY] = true;

	const linked = linkedTitles(note.body)
		.filter((title) => title !== note.title)
		.flatMap((title) => context.pages.get(title) ?? []);
	for (const name of LINK_RELATIONS) {
		const property = properties[name];
		if (property?.type !== "relation") continue;
		const ids = linked.filter((page) => page.target.kind === "row" && page.target.database === property.target).map((page) => page.id);
		const fromField = values[name];
		values[name] = listValue([...(Array.isArray(fromField) ? fromField : []), ...ids]);
	}

	const derived = derivedValues(renderNote(note), context.openLoopSections);
	const derivedByName: Readonly<Record<(typeof DERIVED)[number], Value>> = {
		Changed: minute(changedAt(note, context.now)),
		Bytes: derived.bytes,
		"Open tasks": derived.openTasks,
		"Open loops": derived.openLoops,
		"Has content": derived.hasContent,
	};
	for (const name of DERIVED) if (name in properties) values[name] = derivedByName[name];
	return values;
}

/** The properties that a person writes, without the ones that the write hook derives. */
export function userValues(values: Values): Values {
	return Object.fromEntries(Object.entries(values).filter(([name]) => !(DERIVED as readonly string[]).includes(name)));
}

/** A list of a query row. Notion sends it as the JSON text of an array. */
function listOf(raw: unknown): string[] {
	let list: unknown = raw;
	if (typeof raw === "string" && raw.startsWith("[")) {
		try {
			list = JSON.parse(raw);
		} catch {
			return [];
		}
	}
	return Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : [];
}

function liveValue(row: Readonly<Record<string, unknown>>, name: string, property: PropertySpec): Value {
	const raw = row[name];
	switch (property.type) {
		case "date": {
			const start = row[`date:${name}:start`];
			if (typeof start !== "string" || start === "") return null;
			return row[`date:${name}:is_datetime`] === 1 ? minute(new Date(start)) : start.slice(0, 10);
		}
		case "checkbox":
			return raw === "__YES__";
		case "number":
			return typeof raw === "number" ? raw : null;
		case "multi_select":
			return listValue(listOf(raw));
		case "relation":
			return listValue(listOf(raw).map(notionId));
		default:
			return typeof raw === "string" && raw !== "" ? raw : null;
	}
}

/** The managed properties of one row of a view query or of a page fetch. */
export function liveValues(row: Readonly<Record<string, unknown>>, database: DatabaseKey): Values {
	const properties = databaseSpec(database).properties;
	return Object.fromEntries(managedProperties(database).flatMap((name) => {
		const property = properties[name];
		return property === undefined ? [] : [[name, liveValue(row, name, property)] as const];
	}));
}

const sameValue = (a: Value | undefined, b: Value | undefined): boolean =>
	Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((item, index) => item === b[index]) : a === b;

/** The entries of `desired` that `live` does not hold. */
export function changedValues(desired: Values, live: Values): Values {
	return Object.fromEntries(Object.entries(desired).filter(([name, value]) => !sameValue(value, live[name])));
}

/** `values` as the `properties` argument of `notion-create-pages` and `notion-update-page`. */
export function propertyArguments(values: Values, database: DatabaseKey): Record<string, unknown> {
	const properties = databaseSpec(database).properties;
	const args: Record<string, unknown> = {};
	for (const [name, value] of Object.entries(values)) {
		const type = properties[name]?.type;
		if (type === "date") {
			const isDatetime = typeof value === "string" && value.length > 10;
			args[`date:${name}:start`] = isDatetime ? `${value}:00.000Z` : value;
			args[`date:${name}:is_datetime`] = isDatetime ? 1 : 0;
		} else if (type === "checkbox") args[name] = value === true ? "__YES__" : "__NO__";
		else args[name] = value;
	}
	return args;
}

/** The time of a write, as the `Hook stamp` arguments. The write hook sets the same property. */
export const hookStampArguments = (at: Date): Record<string, unknown> => ({ "date:Hook stamp:start": at.toISOString(), "date:Hook stamp:is_datetime": 1 });

/**
 * True when the "Hygiene: edited outside hooks" view can return the row: it
 * has no stamp, or its last edit is later than the stamp. A run that stops
 * between two writes of one row leaves this state.
 */
export function stampIsStale(row: Readonly<Record<string, unknown>>): boolean {
	const stamp = row["date:Hook stamp:start"];
	const edited = row["Last edited"];
	if (typeof stamp !== "string" || typeof edited !== "string") return true;
	return Date.parse(edited) - Date.parse(stamp) > 120_000;
}

/** The select and multi-select values that the rows of one database need, for `ensureSelectOptions`. */
export function wantedOptions(notes: readonly FixtureNote[], database: DatabaseKey): Record<string, string[]> {
	const properties = databaseSpec(database).properties;
	const wanted: Record<string, string[]> = {};
	for (const note of notes) {
		for (const field of Object.keys(note.fields) as Field[]) {
			const name = PROPERTY_OF_FIELD[field];
			const type = properties[name]?.type;
			if (type !== "select" && type !== "multi_select") continue;
			const raw = note.fields[field] ?? [];
			wanted[name] = [...new Set([...(wanted[name] ?? []), ...(typeof raw === "string" ? [raw] : raw)])];
		}
	}
	return wanted;
}

/**
 * The body of a note as Notion-flavored Markdown. A link to a fixture note
 * is a mention of its page with the title as its text, which is the form
 * that a fetch returns. A link to no fixture note stays as text, as a
 * ticket ID in a link does in the vault.
 */
export function notionBody(note: FixtureNote, pages: Pages): string {
	return note.body.replace(WIKILINK, (text, title: string) => {
		const page = pages.get(title.trim());
		return page === undefined ? text : `<mention url="${page.url}">${title.trim()}</mention>`;
	});
}

const SYNCED_REFERENCE = /<synced-block-reference url="[^"]*"[^>]*>[\s\S]*?<\/synced-block-reference>/g;
const CHILD_BLOCK = /<(database|page) url="[^"]*"[^>]*>[\s\S]*?<\/\1>/g;
const SECTION_END = /^##? /;

/** The `## Heading` line that stands directly above the text at `index`, or `undefined`. */
function headingAbove(content: string, index: number): string | undefined {
	const above = content.slice(0, index).trimEnd().split("\n").at(-1) ?? "";
	return above.startsWith("## ") ? above : undefined;
}

/**
 * The content that makes a page hold `body` and keep each block that the
 * setup owns on it. `live` is the content of the page now.
 *
 * - A synced block reference stays first, as fetched, with its heading.
 *   Notion reads the text inside a reference as an edit of the original,
 *   so an empty reference would delete the text of the original.
 * - A section that the page holds as an original synced block keeps that
 *   block. The text of the section in `body` goes inside it.
 * - Each linked view and child page stays last. A replace without its tag
 *   would delete it.
 */
export function composeContent(body: string, live: string): string {
	const references = [...live.matchAll(SYNCED_REFERENCE)].map((match) => {
		const heading = headingAbove(live, match.index);
		return heading === undefined ? match[0] : `${heading}\n\n${match[0]}`;
	});
	const children = [...live.replace(SYNCED_REFERENCE, "").matchAll(CHILD_BLOCK)].map((match) => match[0]);

	const lines = body.trim().split("\n");
	for (const match of live.matchAll(/<synced-block url="([^"]*)">/g)) {
		const heading = headingAbove(live, match.index);
		if (heading === undefined) continue;
		const start = lines.indexOf(heading);
		if (start === -1) throw new Error(`The page holds the section "${heading}" as a synced block, and the note has no such section.`);
		const next = lines.findIndex((line, index) => index > start && SECTION_END.test(line));
		const end = next === -1 ? lines.length : next;
		const section = lines.slice(start + 1, end).join("\n").trim();
		lines.splice(start + 1, end - start - 1, "", `<synced-block url="${match[1]}">`, section, "</synced-block>", "");
	}
	return `${[...references, lines.join("\n").trim(), ...children].join("\n\n")}\n`;
}

const BLOCK_LINE = /^\s*(#{1,6} |[-*+] |\d+\. |>|\||```|<\/?(synced-block|synced-block-reference|database|page|callout|columns|column|table|details|ul|ol|li)\b)/;
const INLINE_TAGS: readonly (readonly [RegExp, string])[] = [
	[/<\/?s>/g, "~~"],
	[/<\/?b>/g, "**"],
	[/<\/?i>/g, "*"],
	[/<\/?code>/g, "`"],
];

function canonicalLine(line: string): string {
	let text = line.replace(/<br\s*\/?>/g, "<br />");
	text = text.replace(/<mention url="([^"]+)"[^>]*?(?:\/>|>[^<]*<\/mention>)/g, (_, url: string) => `<mention ${notionId(url)}>`);
	for (const [tag, mark] of INLINE_TAGS) text = text.replace(tag, mark);
	return text.replace(/\\([!-/:-@[-`{-~])/g, "$1");
}

const FENCE = /^(\s*)(`{3,})(.*)$/;
/** The name that Notion returns for a language of a code block, where it differs from the name of the write (measured). */
const FETCHED_LANGUAGE: Readonly<Record<string, string>> = { text: "txt" };

/**
 * Content in one form for a comparison of what a write sends with what a
 * fetch returns. Notion returns a hard wrap as `<br />`, a mention with the
 * title of its page, strike-through as a tag, a backslash before a bracket,
 * and its own name for the language of a code block. It also moves blank
 * lines. A line inside a code block stays as it is. The form covers the
 * constructs of the fixture set. A new construct that it does not cover
 * shows as an update on each run.
 */
export function canonicalContent(content: string): string {
	const out: string[] = [];
	let proseAbove = false;
	let openFence: string | null = null;
	for (const raw of content.replace(/\r\n/g, "\n").split("\n")) {
		const line = raw.trimEnd();
		const fence = FENCE.exec(line);
		if (openFence !== null) {
			out.push(line);
			if (fence !== null && (fence[2] ?? "").length >= openFence.length && fence[3] === "") openFence = null;
			continue;
		}
		if (fence !== null) {
			const language = fence[3] ?? "";
			openFence = fence[2] ?? "";
			out.push(`${fence[1]}${openFence}${FETCHED_LANGUAGE[language] ?? language}`);
			proseAbove = false;
			continue;
		}
		const prose = line !== "" && !BLOCK_LINE.test(line);
		if (prose && proseAbove) out[out.length - 1] += `<br />${canonicalLine(line)}`;
		else if (line !== "") out.push(canonicalLine(line));
		proseAbove = prose;
	}
	return out.join("\n");
}

export const sameContent = (a: string, b: string): boolean => canonicalContent(a) === canonicalContent(b);
