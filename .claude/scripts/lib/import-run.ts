/**
 * The import run: make the pages of a plan exist in Notion, and write only
 * what differs.
 *
 *     const result = await runImport(client, readVault(dir), map, { rootTitle: "obsidian-mind", log: console.log });
 *     result.created     // rows that the run made
 *     result.updated     // pages of an earlier run that the run wrote again
 *     result.unchanged   // pages that the run left as they are
 *
 * A row has its source path in the property `Source path`, and the run
 * finds it by that value. So a second run makes no page. The last write of
 * a row sets the property `Import digest`. A row with the digest of its
 * plan is complete and gets no call. A run that stops early leaves rows
 * with no digest or an old one, and the next run writes them again.
 */

import { createLedger, type CreatedKind } from "../notion-setup.ts";
import { canonicalContent, composeContent, hookStampArguments, propertyArguments, sameContent } from "../parity/notion-pages.ts";
import { storedLanguage } from "./code-language.ts";
import type { PageCheck } from "./import-report.ts";
import { DIGEST_PROPERTY, IMPORT_PROPERTIES, placeholderRefs, placeVault, planImport, setupPageOf, SOURCE_PATH_PROPERTY, type ImportPlan, type PageRef, type PlannedPage, type Value, type Values } from "./import-plan.ts";
import type { Vault } from "./import-source.ts";
import { NotionError, type NotionClient } from "./notion-client.ts";
import type { NotionMap } from "./notion-map.ts";
import { DATABASES, type DatabaseKey, type PropertySpec } from "./notion-model.ts";
import { optionStatements } from "./notion-options.ts";
import { notionId, parseCreatedPages, parseDatabase, parseNotePage, parsePage, parseRows, parseWorkspaceId } from "./notion-parse.ts";

export interface ImportOptions {
	/** The title of the root that the map file must name. A map of a different root stops the run. */
	readonly rootTitle: string;
	readonly log: (line: string) => void;
	readonly ledgerPath?: string;
	readonly ledgerTag?: readonly [string, unknown];
	readonly sleep?: (ms: number) => Promise<void>;
}

export interface ImportResult {
	readonly plan: ImportPlan;
	/** The page of each planned note, by source path. */
	readonly refs: ReadonlyMap<string, PageRef>;
	readonly created: number;
	readonly updated: number;
	readonly unchanged: number;
	readonly propertiesAdded: number;
	readonly optionsAdded: number;
	/** Pages that Notion did not accept, with its message. The next run writes them again. */
	readonly failed: readonly { readonly path: string; readonly message: string }[];
	/** Rows of an earlier import whose source path the vault does not hold. They stay. */
	readonly notInVault: readonly { readonly path: string; readonly title: string; readonly url: string }[];
}

interface LiveRow extends PageRef {
	readonly database: DatabaseKey;
	readonly title: string;
	readonly path: string;
	readonly digest: string;
}

const ALL_ROWS_VIEW = "Recently changed";
const CREATE_BATCH = 100;
const KEY_TRIES = 4;

const text = (value: unknown): string => (typeof value === "string" ? value : "");
/**
 * A text value as it was written. Notion makes a link of a token that looks
 * like a domain, so `reference/Runbook.md` comes back as
 * `reference/[Runbook.md](http://Runbook.md)` (measured on each key of the
 * first live import).
 */
export const plainText = (value: string): string => value.replace(/\[([^\]\n]+)\]\((?:https?:\/\/|mailto:)\1\/?\)/g, "$1");
const setValues = (values: Values): Values => Object.fromEntries(Object.entries(values).filter(([, value]) => value !== null && value !== false));
/** Notion did not accept this one page. Each other failure stops the run, and a rejected page does not stop the pages after it. */
const isRejectedPage = (error: unknown): error is NotionError => error instanceof NotionError && error.code === "tool_error";

export async function runImport(client: NotionClient, vault: Vault, map: NotionMap, options: ImportOptions): Promise<ImportResult> {
	const { log } = options;
	if (map.root.title !== options.rootTitle) {
		throw new Error(`The map file names the root "${map.root.title}", and --root-title names "${options.rootTitle}". The run made no change.`);
	}
	if (parseWorkspaceId(await client.call("notion-get-self")) !== map.workspace_id) {
		throw new Error("The Notion login is in a different workspace from the one that the map file names. The run made no change.");
	}
	const sleep = options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
	const counts: Record<CreatedKind, number> = { page: 0, database: 0, property: 0, option: 0, view: 0, row: 0, block: 0, probe_row: 0 };
	const { record, reconcile } = createLedger(options, counts);

	const places = placeVault(vault);
	const draft = planImport(vault, places, placeholderRefs(places));
	const rowsOf = (database: DatabaseKey): PlannedPage[] => draft.pages.filter((page) => page.destination.kind === "row" && page.destination.database === database);
	const databases = DATABASES.map((spec) => spec.key).filter((key) => rowsOf(key).length > 0);
	const unmapped = draft.pages.map((page) => setupPageOf(page.destination)).find((key) => key !== undefined && map.pages[key] === undefined);
	if (unmapped !== undefined) throw new Error(`The map file has no page "${unmapped}". Run notion-setup.ts again. The run made no change.`);

	let optionsAdded = 0;
	for (const database of databases) {
		const entry = map.databases[database];
		const live = parseDatabase(await client.call("notion-fetch", { id: entry.id })).properties;
		const wrongType = IMPORT_PROPERTIES.find((name) => live[name] !== undefined && live[name]?.type !== "text");
		if (wrongType !== undefined) throw new Error(`The property "${wrongType}" of "${entry.title}" is not a text property. Rename it in Notion, then run the import again.`);
		const columns = IMPORT_PROPERTIES.filter((name) => live[name] === undefined);
		const wanted: Record<string, string[]> = {};
		for (const page of rowsOf(database)) {
			for (const [name, values] of Object.entries(page.options)) wanted[name] = [...new Set([...(wanted[name] ?? []), ...values])];
		}
		const { statements, added } = optionStatements(live, wanted);
		const all = [...columns.map((name) => `ADD COLUMN "${name}" RICH_TEXT`), ...statements];
		if (all.length === 0) continue;
		await client.call("notion-update-data-source", { data_source_id: entry.data_source, statements: all.join("; ") });
		for (const name of columns) record("property", entry.id, `${entry.title}: ${name}`);
		if (added > 0) {
			optionsAdded += added;
			record("option", entry.id, `${entry.title}: ${added} options for the imported values`);
		}
	}

	const queryRows = async (database: DatabaseKey): Promise<LiveRow[]> => {
		const view = map.databases[database].views[ALL_ROWS_VIEW];
		if (view === undefined) throw new Error(`The map file has no "${ALL_ROWS_VIEW}" view for ${map.databases[database].title}. Run notion-setup.ts again.`);
		const rows: LiveRow[] = [];
		let cursor: string | undefined;
		do {
			const page = parseRows(await client.call("notion-query-data-sources", { data: { mode: "view", view_url: view, page_size: 100, ...(cursor === undefined ? {} : { start_cursor: cursor }) } }));
			for (const row of page.rows) {
				const url = text(row["url"]);
				rows.push({ id: notionId(url), url, database, title: plainText(text(row["Name"])), path: plainText(text(row[SOURCE_PATH_PROPERTY])), digest: text(row[DIGEST_PROPERTY]) });
			}
			cursor = page.nextCursor;
		} while (cursor !== undefined);
		return rows;
	};

	const byPath = new Map<string, LiveRow>();
	const byId = new Map<string, LiveRow>();
	for (const rows of await Promise.all(databases.map(queryRows))) {
		for (const row of rows) {
			byId.set(row.id, row);
			if (row.path === "") continue;
			const other = byPath.get(row.path);
			if (other !== undefined) throw new Error(`Two rows have the source path "${row.path}": "${other.title}" and "${row.title}". Move one of them to Trash, then run the import again.`);
			byPath.set(row.path, row);
		}
	}

	const refs = new Map<string, PageRef>();
	const fresh = new Set<string>();
	const missing = new Map<DatabaseKey, PlannedPage[]>();
	for (const page of draft.pages) {
		const { destination, note } = page;
		const setupPage = setupPageOf(destination);
		const found = setupPage === undefined ? byPath.get(note.path) : map.pages[setupPage];
		if (found !== undefined) refs.set(note.path, { id: found.id, url: found.url });
		else if (destination.kind === "row") missing.set(destination.database, [...(missing.get(destination.database) ?? []), page]);
		if (found !== undefined && setupPage === undefined) reconcile("row", found.id, note.path);
	}
	const planned = new Set(draft.pages.map((page) => page.note.path));
	const orphanKeys = [...byId.values()].filter((row) => row.path !== "" && !planned.has(row.path));
	const clash = [...missing].flatMap(([database, pages]) => pages.flatMap((page) => orphanKeys.filter((row) => row.database === database && row.title === page.title).map((row) => ({ page, row }))));
	if (clash.length > 0) {
		const [{ page, row }] = clash as [(typeof clash)[number]];
		throw new Error(
			`${clash.length} notes have no row with their source path, and a row with their title has a source path that the vault does not hold. For example, "${page.note.path}" and the row "${row.title}" with "${row.path}". A new row would be a second row of one note. Set the source path of the old row, or move it to Trash, then run the import again. The run made no row.`,
		);
	}

	for (const [database, pages] of missing) {
		for (let i = 0; i < pages.length; i += CREATE_BATCH) {
			const batch = pages.slice(i, i + CREATE_BATCH);
			const reply = await client.call("notion-create-pages", {
				parent: { data_source_id: map.databases[database].data_source },
				allow_async: false,
				pages: batch.map((page) => ({ properties: { Name: page.title, [SOURCE_PATH_PROPERTY]: page.note.path } })),
			});
			const made = parseCreatedPages(reply);
			if (made.length !== batch.length) throw new Error(`notion-create-pages returned ${made.length} pages for ${batch.length} notes.`);
			for (const [index, page] of batch.entries()) {
				const ref = made[index];
				if (ref === undefined) continue;
				refs.set(page.note.path, { id: ref.id, url: ref.url });
				fresh.add(page.note.path);
				record("row", ref.id, page.note.path);
			}
		}
		const wanted = pages.map((page) => page.note.path);
		let absent = wanted;
		let stored: readonly LiveRow[] = [];
		for (let attempt = 0; attempt < KEY_TRIES && absent.length > 0; attempt++) {
			if (attempt > 0) await sleep(2000);
			stored = await queryRows(database);
			const keys = new Set(stored.map((row) => row.path));
			absent = wanted.filter((path) => !keys.has(path));
		}
		if (absent.length > 0) {
			const example = absent[0] ?? "";
			const read = stored.find((row) => row.id === refs.get(example)?.id);
			const shown = read === undefined ? "no row with its ID" : `"${read.path}"`;
			throw new Error(`The view "${ALL_ROWS_VIEW}" of ${map.databases[database].title} does not give back the source path of ${absent.length} new rows as the run wrote it. For example, the run wrote "${example}" and read ${shown}. The next run would not find these rows.`);
		}
	}

	const setupPages = Object.fromEntries(Object.entries(map.pages).map(([key, page]) => [key, { id: page.id, url: page.url, title: page.title }]));
	const plan = planImport(vault, places, { notes: refs, setupPages, templates: map.templates });

	let updated = 0;
	let unchanged = 0;
	const failed: { path: string; message: string }[] = [];
	const fetchContent = async (id: string): Promise<string> => parsePage(await client.call("notion-fetch", { id })).content;
	/** Write the body, and return true when the page did not hold it. A new row has no content to keep. */
	const writeBody = async (page: PlannedPage, id: string, isFresh: boolean): Promise<boolean> => {
		if (isFresh && page.body === "") return false;
		const live = isFresh ? "" : await fetchContent(id);
		if (page.destination.kind === "section") {
			const edit = sectionEdit(live, page.body, page.destination.section);
			if (edit === null) return false;
			if ("append" in edit) await client.call("notion-update-page", { page_id: id, command: "insert_content", content: edit.append });
			else await client.call("notion-update-page", { page_id: id, command: "update_content", content_updates: [edit] });
			return true;
		}
		const wanted = isFresh ? page.body : composeContent(page.body, live);
		if (!isFresh && sameStored(wanted, live)) return false;
		await client.call("notion-update-page", { page_id: id, command: "replace_content", new_str: wanted });
		return true;
	};
	const apply = async (page: PlannedPage): Promise<void> => {
		const ref = refs.get(page.note.path);
		if (ref === undefined) throw new Error(`${page.note.path} has no page.`);
		const isFresh = fresh.has(page.note.path);
		const { destination } = page;
		if (destination.kind !== "row") {
			if (await writeBody(page, ref.id, false)) {
				updated++;
				log(`updated ${page.note.path}: content`);
			} else unchanged++;
			return;
		}
		if (!isFresh && byId.get(ref.id)?.digest === page.digest) {
			unchanged++;
			return;
		}
		await writeBody(page, ref.id, isFresh);
		const values = isFresh ? setValues(page.values) : page.values;
		const properties = { ...propertyArguments(values, destination.database), [DIGEST_PROPERTY]: page.digest, ...hookStampArguments(new Date()) };
		await client.call("notion-update-page", { page_id: ref.id, command: "update_properties", properties });
		if (isFresh) return;
		updated++;
		log(`updated ${page.note.path}`);
	};
	await Promise.all(
		plan.pages.map((page) =>
			apply(page).catch((error: unknown) => {
				if (!isRejectedPage(error)) throw error;
				failed.push({ path: page.note.path, message: error.message });
				log(`failed ${page.note.path}: ${error.message}`);
			}),
		),
	);

	const inVault = new Set(plan.pages.map((page) => page.note.path));
	const notInVault = [...byPath.values()].filter((row) => !inVault.has(row.path)).map((row) => ({ path: row.path, title: row.title, url: row.url }));
	return { plan, refs, created: fresh.size, updated, unchanged, propertiesAdded: counts.property, optionsAdded, failed, notInVault };
}

const TABLE_ROW = /^\s*\|.*\|\s*$/;
const FENCE_LINE = /^(\s*)(`{3,}|~{3,})(.*)$/;
const UNDERSCORE_ITALIC = /(^|[^\w*\\])_([^_\s][^_\n]*?)_(?![\w])/g;

/**
 * `content` with the forms that Notion stores in place of what a write
 * sends (measured on the pages of the setup): `_text_` comes back as
 * `<i>text</i>`, and a table row with each cell trimmed and each separator
 * cell as `---`. An empty bullet is no text on both sides: Notion stores it
 * as a `<ul>` block, and drops it at the end of a synced block. A link that
 * `plainText` removes is text on both sides. A line in a code block stays
 * as it is, and the language of the block gets the name that Notion returns.
 * A fence with no language is `txt`, which is what the import sends.
 */
function storedForm(content: string): string {
	let openFence: string | null = null;
	return plainText(content)
		.replace(/<ul>\n<li><\/li>\n<\/ul>/g, "")
		.split("\n")
		.map((line) => {
			const [, indent = "", fence, rest = ""] = FENCE_LINE.exec(line) ?? [];
			if (openFence !== null) {
				if (fence?.startsWith(openFence) && rest.trim() === "") openFence = null;
				return line;
			}
			if (fence !== undefined) {
				openFence = fence;
				return `${indent}${fence}${rest.trim() === "" ? "txt" : (storedLanguage(rest.trim())?.name ?? rest)}`;
			}
			if (/^\s*-\s*$/.test(line)) return "";
			if (!TABLE_ROW.test(line)) return line.replace(UNDERSCORE_ITALIC, "$1<i>$2</i>");
			const cells = line.trim().slice(1, -1).split("|").map((cell) => cell.trim());
			return `| ${cells.map((cell) => (/^:?-+:?$/.test(cell) ? "---" : cell)).join(" | ")} |`;
		})
		.join("\n");
}

/** True when `a` and `b` are one content after a write: `sameContent` with the measured forms of `storedForm`. */
const sameStored = (a: string, b: string): boolean => sameContent(storedForm(a), storedForm(b));

/** The lines of the `##` section `heading`: from the heading to its last line of text, before the next heading or block of the setup. */
function sectionSpan(content: string, heading: string): string | undefined {
	const lines = content.split("\n");
	const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
	if (start === -1) return undefined;
	const next = lines.findIndex((line, index) => index > start && /^##? |^<(database|page|synced-block|synced-block-reference) /.test(line));
	let end = (next === -1 ? lines.length : next) - 1;
	while (end > start && (lines[end] ?? "").trim() === "") end--;
	return lines.slice(start, end + 1).join("\n");
}

/**
 * The edit that makes the section `heading` of the page content `live`
 * hold `planned`, the section with its heading. `null` when it holds it
 * already, or when the vault has no text for it. A page without the
 * section gets it at the end.
 */
export function sectionEdit(live: string, planned: string, heading: string): { readonly old_str: string; readonly new_str: string } | { readonly append: string } | null {
	if (planned.trim() === "") return null;
	const current = sectionSpan(live, heading);
	if (current === undefined) return { append: planned };
	return sameStored(current, planned) ? null : { old_str: current, new_str: planned.trimEnd() };
}

const DERIVED: readonly string[] = ["Changed", "Bytes", "Open tasks", "Open loops", "Has content"];

/** A list of a fetch reply: an array, or the JSON text of an array. */
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

const sorted = (items: readonly string[]): Value => (items.length === 0 ? null : [...new Set(items)].sort());

/** The value of a property of a fetch reply, in the form of a planned value. */
function fetchedValue(properties: Readonly<Record<string, unknown>>, name: string, type: PropertySpec["type"] | undefined): Value {
	const raw = properties[name];
	switch (type) {
		case "date": {
			const start = properties[`date:${name}:start`];
			if (typeof start !== "string" || start === "") return null;
			return properties[`date:${name}:is_datetime`] === 1 ? new Date(start).toISOString().slice(0, 16) : start.slice(0, 10);
		}
		case "checkbox":
			return raw === "__YES__";
		case "number":
			return typeof raw === "number" ? raw : null;
		case "multi_select":
			return sorted(listOf(raw));
		case "relation":
			return sorted(listOf(raw).map(notionId));
		default:
			return typeof raw === "string" && raw !== "" ? plainText(raw) : null;
	}
}

const shown = (value: Value | undefined): string => (value === null || value === undefined ? "(empty)" : Array.isArray(value) ? value.join(", ") : String(value));
const sameValue = (a: Value | undefined, b: Value): boolean => (Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((item, index) => item === b[index]) : a === b);

/** Fetch each page of the plan, and compare it with the plan: the title, the place, each property, the body, and the derived values. */
export async function verifyImport(client: NotionClient, map: NotionMap, plan: ImportPlan, refs: ReadonlyMap<string, PageRef>): Promise<PageCheck[]> {
	return Promise.all(
		plan.pages.map(async (page): Promise<PageCheck> => {
			const ref = refs.get(page.note.path);
			if (ref === undefined) throw new Error(`${page.note.path} has no page.`);
			const live = parseNotePage(await client.call("notion-fetch", { id: ref.id }));
			const { destination } = page;
			const spec = destination.kind === "row" ? DATABASES.find((candidate) => candidate.key === destination.database) : undefined;
			const differences = (names: readonly string[]): string => {
				const different = names.filter((name) => !sameValue(page.values[name], fetchedValue(live.properties, name, spec?.properties[name]?.type)));
				if (different.length === 0) return `same (${names.length})`;
				return different.map((name) => `${name}: plan ${shown(page.values[name])}, Notion ${shown(fetchedValue(live.properties, name, spec?.properties[name]?.type))}`).join("; ");
			};
			const names = Object.keys(page.values).filter((name) => name !== "Type");
			const inDatabase = destination.kind === "row" && live.ancestors.dataSource !== undefined && notionId(live.ancestors.dataSource) === notionId(map.databases[destination.database].data_source);
			const bodyCell = (): string => {
				if (destination.kind === "section") return sectionEdit(live.content, page.body, destination.section) === null ? "same" : "different";
				return firstDifference(composeContent(page.body, live.content), live.content);
			};
			const cells = {
				title: live.title === page.title ? "same" : `plan ${page.title}, Notion ${live.title}`,
				database: destination.kind !== "row" ? "same (a page of the setup)" : inDatabase ? "same" : `Notion has the row outside ${map.databases[destination.database].title}`,
				type: spec?.properties["Type"] === undefined ? "same (no Type)" : differences(["Type"]).replace(/ \(1\)$/, ""),
				properties: differences(names.filter((name) => !DERIVED.includes(name))),
				body: bodyCell(),
				derived: differences(names.filter((name) => DERIVED.includes(name))),
			};
			return { path: page.note.path, cells, same: Object.values(cells).every((cell) => cell.startsWith("same")) };
		}),
	);
}

/** "same", or the first line where the two contents differ in the form that `sameStored` compares. */
function firstDifference(planned: string, live: string): string {
	if (sameStored(planned, live)) return "same";
	const a = canonicalContent(storedForm(planned)).split("\n");
	const b = canonicalContent(storedForm(live)).split("\n");
	const index = a.findIndex((line, i) => line !== b[i]);
	const at = index === -1 ? a.length : index;
	const clip = (line: string | undefined): string => (line === undefined ? "(none)" : line.length > 80 ? `${line.slice(0, 77)}...` : line);
	return `different at line ${at + 1}: plan "${clip(a[at])}", Notion "${clip(b[at])}"`;
}
