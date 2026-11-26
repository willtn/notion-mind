/**
 * The plan of an import: for each note of the vault, the page that it
 * becomes. The plan is pure. It needs the page of each note only for the
 * URL of a mention and the ID of a relation, so a dry run gives it
 * placeholders.
 *
 *     const places = placeVault(vault);                    // where each note goes, and each file that stays out
 *     const plan = planImport(vault, places, refs);        // refs: source path -> { id, url }
 *     plan.pages[0]
 *     // { note, destination: { kind: "row", database: "work", … }, values: { Type: "Work note", Status: "active", … },
 *     //   body: "The export runs each night.\n", losses: [], digest: "sha256:…" }
 */

import { createHash } from "node:crypto";
import { parseOpenLoopConfig } from "./active-hygiene.ts";
import { convertBody, convertSection, type BodyLink, type Loss, type Resolution } from "./import-body.ts";
import { destinationOf, replacedFolderReason, satelliteOf, setupPageOfFile, type Destination, type RowDestination } from "./import-place.ts";
import type { FieldValue, SourceNote, Vault } from "./import-source.ts";
import { derivedValues } from "./notion-derived.ts";
import { DATABASES, PAGES, SYNCED_SECTIONS, TEMPLATES, VERBATIM_PROPERTY, type DatabaseKey, type PageKey, type PropertySpec } from "./notion-model.ts";
import { propertyOfField } from "./notion-note.ts";

/** The property that holds the key of an imported page: the path of its file from the vault root. */
export const SOURCE_PATH_PROPERTY = "Source path";
/** The property that holds the digest of the last plan that the import wrote in full. */
export const DIGEST_PROPERTY = "Import digest";
/** The two text properties that the import adds to a database before it writes a row there. */
export const IMPORT_PROPERTIES: readonly string[] = [SOURCE_PATH_PROPERTY, DIGEST_PROPERTY];

/** A property value: a list is sorted and not empty, a relation holds page IDs, and `null` is an empty property. */
export type Value = string | number | boolean | readonly string[] | null;
export type Values = Readonly<Record<string, Value>>;

export interface PageRef {
	readonly id: string;
	readonly url: string;
}

export interface Placement {
	readonly note: SourceNote;
	readonly destination: Destination;
}

export interface PlannedPage {
	readonly note: SourceNote;
	readonly destination: Exclude<Destination, { kind: "skip" }>;
	readonly title: string;
	/** Each property that the import sets on a row. A page outside the databases has none. */
	readonly values: Values;
	/** The select and multi-select values of `values`, by property, for `ensureSelectOptions`. */
	readonly options: Readonly<Record<string, readonly string[]>>;
	readonly body: string;
	readonly losses: readonly PlannedLoss[];
	/** A digest of the title, the place, the values, and the body. An equal digest on the row means that nothing changed. */
	readonly digest: string;
}

/** A loss with the file that holds it. A page of the setup can take text from more than one file. */
export type PlannedLoss = Loss & { readonly path: string };

export interface ImportPlan {
	readonly pages: readonly PlannedPage[];
	/** Each file that the import leaves out, with the reason. */
	readonly leftOut: readonly { readonly path: string; readonly reason: string }[];
}

const NOT_A_NOTE = "It is not a Markdown note. The import does not upload files.";

/** The destination of each note. A row of a note type with a core note gets its type here, because the rule needs the other titles. */
export function placeVault(vault: Vault): Placement[] {
	const placed = vault.notes.map((note) => ({ note, destination: destinationOf(note) }));
	const knowledgeTitles = new Set(placed.filter(({ destination }) => destination.kind === "row" && destination.database === "knowledge").map(({ note }) => note.title));
	return placed.map(({ note, destination }) => {
		if (destination.kind !== "row" || destination.database !== "knowledge" || destination.adopts !== undefined) return { note, destination };
		const satellite = satelliteOf(note.title);
		return satellite !== null && (satellite.byNameAlone || knowledgeTitles.has(satellite.core)) ? { note, destination: { ...destination, type: satellite.type } } : { note, destination };
	});
}

/** The page of the setup that a destination writes, or `undefined` for a row of the import. */
export function setupPageOf(destination: Destination): PageKey | undefined {
	if (destination.kind === "page" || destination.kind === "section") return destination.page;
	return destination.kind === "row" ? destination.adopts : undefined;
}

/** The page of each imported note, each page of the setup with its title, and each template row by its title. */
export interface Refs {
	readonly notes: ReadonlyMap<string, PageRef>;
	readonly setupPages: Readonly<Partial<Record<PageKey, PageRef & { readonly title: string }>>>;
	readonly templates: Readonly<Record<string, PageRef>>;
}

/** Placeholder pages, for a plan that makes no Notion call. A note that a page of the setup holds has the placeholder of that page. */
export function placeholderRefs(places: readonly Placement[]): Refs {
	const ref = (key: string): PageRef => ({ id: `dry-run:${key}`, url: `dry-run://${encodeURI(key)}` });
	const refOf = ({ note, destination }: Placement): PageRef => {
		const page = setupPageOf(destination);
		return ref(page === undefined ? note.path : `page:${page}`);
	};
	return {
		notes: new Map(places.filter(({ destination }) => destination.kind !== "skip").map((place) => [place.note.path, refOf(place)] as const)),
		setupPages: Object.fromEntries(PAGES.map((page) => [page.key, { ...ref(`page:${page.key}`), title: page.title }])),
		templates: Object.fromEntries(TEMPLATES.map((template) => [template.title, ref(`template:${template.title}`)])),
	};
}

const listOf = (value: FieldValue | undefined): readonly string[] => (value === undefined ? [] : typeof value === "string" ? [value] : value);
const sortedList = (items: readonly string[]): Value => (items.length === 0 ? null : [...new Set(items)].sort());
const minute = (date: Date): string => date.toISOString().slice(0, 16);

/**
 * What a name in a link names. Obsidian finds a note by its file name, or
 * by a path that ends the path of the note. Of two notes with one name,
 * the note with the shorter path wins. A note that a page of the setup
 * holds, or replaces, names that page.
 */
function linkResolver(places: readonly Placement[], refs: Refs): (name: string) => Resolution {
	const byName = new Map<string, Placement>();
	const add = (name: string, place: Placement): void => {
		const key = name.toLowerCase();
		const held = byName.get(key);
		if (held === undefined || place.note.path.length < held.note.path.length) byName.set(key, place);
	};
	for (const place of places) {
		add(place.note.title, place);
		add(place.note.path.replace(/\.md$/i, ""), place);
		for (const alias of listOf(place.note.fields["aliases"])) add(alias, place);
	}
	return (name) => {
		const bare = name.replace(/\.md$/i, "");
		const place = byName.get(bare.toLowerCase()) ?? (bare.includes("/") ? places.find(({ note }) => note.path.toLowerCase().endsWith(`/${bare.toLowerCase()}.md`)) : undefined);
		if (place === undefined) return /\.[A-Za-z0-9]{1,5}$/.test(name) && !/\.md$/i.test(name) ? { kind: "file" } : { kind: "none" };
		const setupPage = refs.setupPages[setupPageOf(place.destination) ?? setupPageOfFile(place.note.path) ?? ("" as PageKey)];
		const template = place.note.path.startsWith("templates/") ? refs.templates[place.note.title] : undefined;
		const ref = refs.notes.get(place.note.path) ?? setupPage ?? template;
		if (ref === undefined) return { kind: "left out" };
		return { kind: "page", target: { path: place.note.path, title: setupPage?.title ?? place.note.title, url: ref.url } };
	};
}

/** A relation that the links of the body fill. The first rule that takes a link gets it. */
interface LinkRelation {
	readonly property: string;
	readonly takes: (link: { readonly to: RowDestination; readonly section: string | null }, from: RowDestination) => boolean;
}

const toDatabase = (database: DatabaseKey): LinkRelation["takes"] => (link) => link.to.database === database;

/** The relations of part c.3 of the design record. */
const LINK_RELATIONS: Readonly<Partial<Record<DatabaseKey, readonly LinkRelation[]>>> = {
	work: [
		{ property: "Feeds into", takes: (link, from) => from.type === "Thinking" && link.to.database === "work" && /^feeds into$/i.test(link.section ?? "") },
		{ property: "Decisions", takes: (link) => link.to.database === "work" && link.to.type === "Decision" },
		{ property: "Related", takes: toDatabase("work") },
		{ property: "Person", takes: toDatabase("people") },
		{ property: "Team", takes: toDatabase("teams") },
		{ property: "Competencies", takes: toDatabase("competencies") },
	],
	people: [{ property: "Team", takes: toDatabase("teams") }],
	perf_docs: [
		{ property: "Person", takes: toDatabase("people") },
		{ property: "Work evidence", takes: toDatabase("work") },
		{ property: "Competencies", takes: toDatabase("competencies") },
	],
};

const DERIVED: readonly string[] = ["Changed", "Bytes", "Open tasks", "Open loops", "Has content"];
const WRITABLE: readonly PropertySpec["type"][] = ["text", "date", "number", "checkbox", "select", "multi_select", "relation"];
/** Properties that a different writer owns: the stamp of each write, and the mark of a row of the setup. */
const NOT_MANAGED: readonly string[] = ["Hook stamp", "Scaffold"];

/** The option of a select that a frontmatter value names: `work-note` names `Work note`. */
const optionNamed = (options: readonly string[], raw: string): string | undefined =>
	options.find((option) => option.toLowerCase() === raw.toLowerCase().replace(/[-_]/g, " ") || option.toLowerCase() === raw.toLowerCase());

function databaseProperties(database: DatabaseKey): Readonly<Record<string, PropertySpec>> {
	const spec = DATABASES.find((candidate) => candidate.key === database);
	if (spec === undefined) throw new Error(`The model has no database with the key "${database}".`);
	return spec.properties;
}

/** The property of a frontmatter key. `current-level` is the property `Current level`. */
function propertyOf(database: DatabaseKey, field: string, properties: Readonly<Record<string, PropertySpec>>): string | undefined {
	const spaced = field.replace(/[-_]/g, " ");
	return [propertyOfField(database, field), `${spaced.charAt(0).toUpperCase()}${spaced.slice(1)}`].find((name) => name in properties);
}

/** The name in a relation field: `"[[Ada Park|Ada]]"` names `Ada Park`. */
const relationName = (raw: string): string => (raw.replace(/^!?\[\[|\]\]$/g, "").split(/[|#]/)[0] ?? "").trim();

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/;

interface RowContext {
	readonly rowOf: (path: string) => { readonly destination: RowDestination; readonly id: string } | undefined;
	readonly resolve: (name: string) => Resolution;
	readonly titlesOf: (database: DatabaseKey) => ReadonlyMap<string, string>;
	readonly openLoopSections: RegExp;
}

/** The properties of the row of `note`. The frontmatter line of a field is not known, so a loss of a field names line 1. */
function rowValues(note: SourceNote, destination: RowDestination, links: readonly BodyLink[], context: RowContext): { values: Values; losses: Loss[] } {
	const properties = databaseProperties(destination.database);
	const losses: Loss[] = [];
	const values: Record<string, Value> = {};
	for (const [name, property] of Object.entries(properties)) {
		if (WRITABLE.includes(property.type) && !NOT_MANAGED.includes(name)) values[name] = property.type === "checkbox" ? false : null;
	}
	const typeProperty = properties["Type"];
	if (typeProperty !== undefined) values["Type"] = destination.type;
	const relationIds: Record<string, string[]> = {};
	const relate = (property: string, id: string): void => {
		(relationIds[property] ??= []).push(id);
	};

	const fields: Readonly<Record<string, FieldValue>> = { ...destination.defaults, ...note.fields };
	for (const [field, raw] of Object.entries(fields)) {
		const shown = `${field}: ${listOf(raw).join(", ")}`;
		if (field === "verbatim") {
			values[VERBATIM_PROPERTY] = raw === "true";
			continue;
		}
		if (field === "type" && typeProperty?.type === "select" && destination.adopts === undefined) {
			const option = typeof raw === "string" ? optionNamed(typeProperty.options, raw) : undefined;
			if (option === undefined) losses.push({ kind: "frontmatter value", line: 1, example: shown });
			else values["Type"] = option;
			continue;
		}
		const name = propertyOf(destination.database, field, properties);
		const property = name === undefined ? undefined : properties[name];
		if (name === undefined || property === undefined || !WRITABLE.includes(property.type) || DERIVED.includes(name) || NOT_MANAGED.includes(name)) {
			losses.push({ kind: "frontmatter key", line: 1, example: shown });
			continue;
		}
		const items = listOf(raw);
		const invalid = (): void => {
			losses.push({ kind: "frontmatter value", line: 1, example: shown });
		};
		switch (property.type) {
			case "relation":
				for (const item of items) {
					const resolution = context.resolve(relationName(item));
					const row = resolution.kind === "page" ? context.rowOf(resolution.target.path) : undefined;
					if (row === undefined || row.destination.database !== property.target) losses.push({ kind: "relation target", line: 1, example: `${field}: ${item}` });
					else relate(name, row.id);
				}
				break;
			case "multi_select": {
				// Notion reads a comma as the end of an option.
				const valid = items.filter((item) => !item.includes(","));
				if (valid.length < items.length) invalid();
				values[name] = sortedList(valid);
				break;
			}
			case "select":
				if (items.length === 1 && !items[0]?.includes(",")) values[name] = items[0] ?? null;
				else invalid();
				break;
			case "date": {
				const text = items.length === 1 ? (items[0] ?? "") : "";
				const time = DATE_TIME.exec(text);
				if (DATE.test(text)) values[name] = text;
				else if (time !== null) values[name] = `${time[1]}T${time[2]}`;
				else invalid();
				break;
			}
			case "number":
				if (items.length === 1 && items[0]?.trim() !== "" && Number.isFinite(Number(items[0]))) values[name] = Number(items[0]);
				else invalid();
				break;
			case "checkbox":
				if (raw === "true" || raw === "false") values[name] = raw === "true";
				else invalid();
				break;
			default:
				values[name] = items.join(", ");
		}
	}
	for (const link of links) {
		const to = link.target.path === note.path ? undefined : context.rowOf(link.target.path);
		if (to === undefined) continue;
		const relation = LINK_RELATIONS[destination.database]?.find((candidate) => candidate.takes({ to: to.destination, section: link.section }, destination));
		if (relation !== undefined) relate(relation.property, to.id);
	}
	const satellite = satelliteOf(note.title);
	const core = satellite === null ? undefined : context.titlesOf(destination.database).get(satellite.core);
	const parent = properties["Parent"];
	if (core !== undefined && parent?.type === "relation" && parent.target === destination.database) relate("Parent", core);
	for (const [name, ids] of Object.entries(relationIds)) values[name] = sortedList(ids);

	const derived = derivedValues(note.text, context.openLoopSections);
	const derivedByName: Readonly<Record<string, Value>> = {
		Changed: minute(note.changed),
		Bytes: derived.bytes,
		"Open tasks": derived.openTasks,
		"Open loops": derived.openLoops,
		"Has content": derived.hasContent,
	};
	for (const name of DERIVED) if (name in properties) values[name] = derivedByName[name] ?? null;
	values[SOURCE_PATH_PROPERTY] = note.path;
	return { values, losses };
}

function optionsOf(values: Values, database: DatabaseKey): Record<string, readonly string[]> {
	const properties = databaseProperties(database);
	const options: Record<string, readonly string[]> = {};
	for (const [name, value] of Object.entries(values)) {
		const type = properties[name]?.type;
		if ((type === "select" || type === "multi_select") && value !== null) options[name] = typeof value === "string" ? [value] : (value as readonly string[]);
	}
	return options;
}

/** A page of the setup keeps each section that it holds as a synced block, so the body has the heading of each such section. */
function withSyncedSections(body: string, page: PageKey | undefined): string {
	const missing = SYNCED_SECTIONS.filter((sync) => sync.original === page && !body.split("\n").includes(`## ${sync.section}`));
	return missing.length === 0 ? body : `${body}${missing.map((sync) => `\n## ${sync.section}\n`).join("")}`;
}

const titleOfPage = (page: PageKey): string => PAGES.find((spec) => spec.key === page)?.title ?? page;
/** The order of the sections of a page of the setup, as `PAGES` gives its parts. */
const sectionOrder = (page: PageKey, section: string): number => PAGES.find((spec) => spec.key === page)?.body.findIndex((part) => part.section === section) ?? -1;

type SectionPlace = Placement & { readonly destination: Extract<Destination, { kind: "section" }> };

/** The page of each note that `places` puts in Notion. `refs` has the page of each such note. */
export function planImport(vault: Vault, places: readonly Placement[], refs: Refs): ImportPlan {
	const resolve = linkResolver(places, refs);
	const rows = new Map<string, { readonly destination: RowDestination; readonly id: string }>();
	const titles = new Map<DatabaseKey, Map<string, string>>();
	for (const { note, destination } of places) {
		const ref = refs.notes.get(note.path);
		if (destination.kind !== "row" || ref === undefined) continue;
		rows.set(note.path, { destination, id: ref.id });
		const ofDatabase = titles.get(destination.database) ?? new Map<string, string>();
		if (!ofDatabase.has(note.title)) ofDatabase.set(note.title, ref.id);
		titles.set(destination.database, ofDatabase);
	}
	const context: RowContext = {
		rowOf: (path) => rows.get(path),
		resolve,
		titlesOf: (database) => titles.get(database) ?? new Map(),
		openLoopSections: parseOpenLoopConfig(vault.manifest).sectionRe,
	};

	const wholePages = new Set(places.flatMap(({ destination }) => (destination.kind === "section" ? [] : (setupPageOf(destination) ?? []))));
	const sections = places
		.filter((place): place is SectionPlace => place.destination.kind === "section")
		.sort((a, b) => sectionOrder(a.destination.page, a.destination.section) - sectionOrder(b.destination.page, b.destination.section));
	/** The section of a note, converted, and its losses. The text outside the section is a loss. */
	const sectionOf = ({ note, destination }: SectionPlace): { readonly body: string; readonly losses: PlannedLoss[] } => {
		const converted = convertSection(note, destination.section, resolve);
		const losses: PlannedLoss[] = (converted?.losses ?? []).map((loss) => ({ ...loss, path: note.path }));
		const restIndex = note.body.split("\n").findIndex((line) => line.trim() !== "" && !/^#\s/.test(line));
		const rest = converted === null ? (restIndex === -1 ? null : { line: note.bodyLine + restIndex, text: (note.body.split("\n")[restIndex] ?? "").trim() }) : converted.rest;
		if (rest !== null) losses.push({ kind: "replaced text", line: rest.line, example: rest.text, path: note.path });
		return { body: converted?.body ?? "", losses };
	};

	const pages: PlannedPage[] = [];
	const leftOut: { path: string; reason: string }[] = [];
	const planned = (note: SourceNote, destination: PlannedPage["destination"], title: string, values: Values, body: string, losses: readonly PlannedLoss[]): PlannedPage => {
		const digest = `sha256:${createHash("sha256").update(JSON.stringify([title, destination, values, body])).digest("hex")}`;
		return { note, destination, title, values, options: destination.kind === "row" ? optionsOf(values, destination.database) : {}, body, losses, digest };
	};
	for (const place of places) {
		const { note, destination } = place;
		if (destination.kind === "skip") {
			leftOut.push({ path: note.path, reason: destination.reason });
			continue;
		}
		if (destination.kind === "section") {
			const section = sectionOf(place as SectionPlace);
			if (wholePages.has(destination.page)) {
				const takes = section.body === "" ? `It has no section "${destination.section}", which the page "${titleOfPage(destination.page)}" takes.` : `The page "${titleOfPage(destination.page)}" takes its section "${destination.section}".`;
				leftOut.push({ path: note.path, reason: `${takes} ${destination.rest}` });
				continue;
			}
			pages.push(planned(note, destination, titleOfPage(destination.page), {}, section.body, section.losses));
			continue;
		}
		const page = setupPageOf(destination);
		const converted = convertBody(note, resolve);
		const merged = sections.filter((section) => section.destination.page === page).map(sectionOf);
		const body = [withSyncedSections(converted.body, page), ...merged.map((section) => section.body)].filter((part) => part !== "").join("\n");
		const row =
			destination.kind === "row"
				? rowValues(note, destination, converted.links, context)
				: { values: {}, losses: Object.entries(note.fields).map(([field, raw]): Loss => ({ kind: "frontmatter key", line: 1, example: `${field}: ${listOf(raw).join(", ")}` })) };
		const own = [...row.losses, ...note.nestedKeys.map((key): Loss => ({ kind: "frontmatter value", line: 1, example: `${key}: (a nested map)` })), ...converted.losses];
		const losses = [...own.map((loss) => ({ ...loss, path: note.path })), ...merged.flatMap((section) => section.losses)];
		pages.push(planned(note, destination, page === undefined ? note.title : titleOfPage(page), row.values, body, losses));
	}
	for (const path of vault.otherFiles) leftOut.push({ path, reason: replacedFolderReason(path) ?? NOT_A_NOTE });
	return { pages, leftOut };
}
