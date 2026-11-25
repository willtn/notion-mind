/**
 * The Notion form of the fixture: the notes of a spec as pages under the
 * fixture root, and the environment that runs the hooks on them.
 *
 * `writeFixture` reads the live pages, compares each with the spec, and
 * writes only the difference. It finds a page by its title, so a second run
 * with the same `now` creates nothing and updates nothing.
 */

import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseOpenLoopConfig } from "../lib/active-hygiene.ts";
import { createNotionClient, type NotionClient } from "../lib/notion-client.ts";
import { NOTION_MAP_ENV, NOTION_MAP_FILE, readNotionMap, type NotionMap } from "../lib/notion-map.ts";
import type { DatabaseKey } from "../lib/notion-model.ts";
import { ensureSelectOptions } from "../lib/notion-options.ts";
import { notionId, parseCreatedPages, parsePage, parseRows, parseWorkspaceId } from "../lib/notion-parse.ts";
import { notionHookEnvironment } from "./notion-env.ts";
import { NOTION_WORDING } from "./notion-wording.ts";
import {
	changedValues,
	composeContent,
	desiredValues,
	FIXTURE_DATABASES,
	hookStampArguments,
	liveValues,
	notesInGroup,
	notionBody,
	propertyArguments,
	sameContent,
	stampIsStale,
	targetOf,
	userValues,
	wantedOptions,
	type NoteContext,
	type PageRef,
	type Pages,
	type Target,
} from "./notion-pages.ts";
import type { FixtureNote, FixtureSpec, HookForm } from "./spec.ts";

/** The map file of the fixture root in the repository root, as `notion-setup.ts --map` writes it. */
export const FIXTURE_MAP_FILE = "notion-map.fixtures.json";

/** The only root that the writer changes. It moves pages to Trash, so it must not run on a root that holds the notes of a person. */
export const FIXTURE_ROOT_TITLE = "obsidian-mind parity fixtures";

export type CreatedKind = "row" | "page" | "option";
export type PageKind = "row" | "page";

/** What a caller records about a run, and what it permits. */
export interface WriteHooks {
	/** Called for each Notion object that the run makes. */
	readonly onCreated?: (kind: CreatedKind, id: string, title: string) => void;
	/** Called for each row and plain page of a fixture note that was there before the run. A row of the setup is not one. */
	readonly onExisting?: (kind: PageKind, id: string, title: string) => void;
	/** Called for each page of an earlier spec that the run moves to Trash. */
	readonly onTrashed?: (kind: PageKind, id: string, title: string) => void;
	/** True when the page is one that this writer made. Without this function, no page goes to Trash. */
	readonly mayTrash?: (id: string) => boolean;
}

export interface WriteOptions extends WriteHooks {
	readonly now: Date;
	readonly log?: (line: string) => void;
}

export interface WriteResult {
	readonly pages: Pages;
	readonly created: number;
	readonly updated: number;
	readonly unchanged: number;
	/** The pages of an earlier spec that the run moved to Trash: a note that the spec no longer has, under its old title, or in its old place. */
	readonly trashed: number;
	/** The pages under the fixture root that are not notes of the spec and that this writer did not make. They stay. */
	readonly left: number;
	readonly optionsAdded: number;
}

/**
 * The hooks that keep a ledger file: one JSON line for each page that a run
 * makes or moves to Trash, with the field `tag` on each line. Other writers
 * use the same file with their own tag. A run moves to Trash only a page
 * that has a line with its own tag, so it needs a tag for that.
 *
 * The file is read once. A page of a fixture note that has no line gets one,
 * so a run that stopped before it wrote its lines is repaired by the next.
 */
export function ledgerHooks(path: string, tag?: readonly [string, string]): WriteHooks {
	const listed = new Set<string>();
	const own = new Set<string>();
	for (const text of existsSync(path) ? readFileSync(path, "utf-8").split("\n") : []) {
		let entry: unknown;
		try {
			entry = JSON.parse(text);
		} catch {
			continue;
		}
		if (typeof entry !== "object" || entry === null) continue;
		const fields = entry as Record<string, unknown>;
		if (typeof fields["id"] !== "string") continue;
		listed.add(fields["id"]);
		if (tag !== undefined && String(fields[tag[0]]) === tag[1] && (fields["kind"] === "row" || fields["kind"] === "page")) own.add(fields["id"]);
	}
	const line = (id: string, kind: string, title: string): void =>
		appendFileSync(path, `${JSON.stringify({ id, kind, title, ...(tag === undefined ? {} : { [tag[0]]: tag[1] }), at: new Date().toISOString() })}\n`);
	const add = (kind: string, id: string, title: string): void => {
		line(id, kind, title);
		listed.add(id);
		if (tag !== undefined && (kind === "row" || kind === "page")) own.add(id);
	};
	return {
		onCreated: add,
		onExisting: (kind, id, title) => {
			if (!listed.has(id)) add(kind, id, title);
		},
		onTrashed: (kind, id, title) => line(id, `trashed_${kind}`, title),
		mayTrash: (id) => own.has(id),
	};
}

/** The ledger of `NOTION_LEDGER`, with the `key=value` field of `NOTION_LEDGER_TAG`. No variable gives no ledger. */
export function ledgerHooksOf(env: NodeJS.ProcessEnv = process.env): WriteHooks {
	const path = env["NOTION_LEDGER"];
	if (path === undefined || path === "") return {};
	const [key, value] = (env["NOTION_LEDGER_TAG"] ?? "").split("=");
	return ledgerHooks(path, key === undefined || key === "" || value === undefined ? undefined : [key, value]);
}

type Row = Readonly<Record<string, unknown>>;

/** A fixture note with the state of its page at the start of the run. A new page has an empty row and no content. */
interface LiveNote {
	readonly note: FixtureNote;
	readonly page: PageRef;
	readonly row: Row;
	readonly isNew: boolean;
}

const ALL_ROWS_VIEW = "Recently changed";
const CREATE_BATCH = 100;
const TRASH_BATCH = 20;

const manifestOf = (spec: FixtureSpec): string | null => spec.repoFiles.find((file) => file.path === "vault-manifest.json")?.content ?? null;

/** Make the notes of `spec` exist under the root of `map`, with the values that the spec gives for `options.now`. */
export async function writeFixture(client: NotionClient, spec: FixtureSpec, map: NotionMap, options: WriteOptions): Promise<WriteResult> {
	const log = options.log ?? (() => {});
	if (map.root.title !== FIXTURE_ROOT_TITLE) {
		throw new Error(`The map file names the root "${map.root.title}". The fixture writer changes only the root "${FIXTURE_ROOT_TITLE}". The run made no change.`);
	}
	if (parseWorkspaceId(await client.call("notion-get-self")) !== map.workspace_id) {
		throw new Error("The Notion login is in a different workspace from the one that the map file names. The run made no change.");
	}

	const targets = new Map<string, Target>();
	for (const note of spec.notes) {
		if (targets.has(note.title)) throw new Error(`Two fixture notes have the title "${note.title}".`);
		targets.set(note.title, targetOf(note));
	}
	const notesOf = (database: DatabaseKey): FixtureNote[] =>
		spec.notes.filter((note) => {
			const target = targets.get(note.title);
			return target?.kind === "row" && target.database === database;
		});
	let optionsAdded = 0;
	for (const database of FIXTURE_DATABASES) {
		const added = await ensureSelectOptions(client, map.databases[database], wantedOptions(notesOf(database), database));
		if (added === 0) continue;
		optionsAdded += added;
		log(`added ${added} options to ${map.databases[database].title}`);
		options.onCreated?.("option", map.databases[database].id, `${map.databases[database].title}: ${added} options for the fixture values`);
	}

	const queryRows = async (database: DatabaseKey): Promise<Map<string, Row>> => {
		const rows = new Map<string, Row>();
		const view = map.databases[database].views[ALL_ROWS_VIEW];
		if (view === undefined) throw new Error(`The map file has no "${ALL_ROWS_VIEW}" view for ${map.databases[database].title}. Run notion-setup.ts again.`);
		let cursor: string | undefined;
		do {
			const reply = await client.call("notion-query-data-sources", { data: { mode: "view", view_url: view, page_size: 100, ...(cursor === undefined ? {} : { start_cursor: cursor }) } });
			const page = parseRows(reply);
			for (const row of page.rows) {
				const title = String(row["Name"] ?? "");
				if (rows.has(title)) throw new Error(`${map.databases[database].title} holds two rows with the title "${title}". Move one of them to Trash, then run again.`);
				rows.set(title, row);
			}
			cursor = page.nextCursor;
		} while (cursor !== undefined);
		return rows;
	};
	const live: LiveNote[] = [];
	let created = 0;
	/** Make one page with only a title for each note. The run fills each new page in the same way as a page of an earlier run. */
	const createPages = async (kind: "row" | "page", parent: Readonly<Record<string, string>>, titleKey: string, notes: readonly FixtureNote[], target: Target): Promise<void> => {
		for (let i = 0; i < notes.length; i += CREATE_BATCH) {
			const batch = notes.slice(i, i + CREATE_BATCH);
			const reply = await client.call("notion-create-pages", { parent, allow_async: false, pages: batch.map((note) => ({ properties: { [titleKey]: note.title } })) });
			const refs = parseCreatedPages(reply);
			if (refs.length !== batch.length) throw new Error(`notion-create-pages returned ${refs.length} pages for ${batch.length} titles.`);
			for (const [index, note] of batch.entries()) {
				const ref = refs[index];
				if (ref === undefined) continue;
				created++;
				log(`created ${kind}: ${note.title}`);
				options.onCreated?.(kind, ref.id, note.title);
				live.push({ note, page: { id: ref.id, url: ref.url, target }, row: {}, isNew: true });
			}
		}
	};

	/** The pages of an earlier spec: a note that is gone, has a new title, or has a type with a different place. */
	const stale: { kind: PageKind; id: string; title: string }[] = [];
	for (const database of FIXTURE_DATABASES) {
		const rows = await queryRows(database);
		const target: Target = { kind: "row", database };
		const notes = notesOf(database);
		const missing: FixtureNote[] = [];
		for (const note of notes) {
			const row = rows.get(note.title);
			if (row === undefined) {
				missing.push(note);
				continue;
			}
			const id = notionId(String(row["url"] ?? ""));
			live.push({ note, page: { id, url: String(row["url"] ?? ""), target }, row, isNew: false });
			if (row["Scaffold"] !== "__YES__") options.onExisting?.("row", id, note.title);
		}
		for (const [title, row] of rows) {
			// A row of the setup stays, also when the spec has no note for it. The setup would make it again.
			if (row["Scaffold"] === "__YES__" || notes.some((note) => note.title === title)) continue;
			stale.push({ kind: "row", id: notionId(String(row["url"] ?? "")), title });
		}
		await createPages("row", { data_source_id: map.databases[database].data_source }, "Name", missing, target);
	}

	const setupPages = new Set(Object.values(map.pages).map((page) => page.id));
	const rootChildren = parsePage(await client.call("notion-fetch", { id: map.root.id })).children.filter((child) => child.kind === "page" && !setupPages.has(child.id));
	for (const child of rootChildren) {
		if (targets.get(child.title)?.kind !== "loose") stale.push({ kind: "page", id: child.id, title: child.title });
	}
	const mine = stale.filter((page) => options.mayTrash?.(page.id) === true);
	for (const page of stale) {
		if (!mine.includes(page)) log(`left in place, ${page.kind}: ${page.title} (not a note of the spec, and not a page of this writer)`);
	}
	for (let i = 0; i < mine.length; i += TRASH_BATCH) {
		const batch = mine.slice(i, i + TRASH_BATCH);
		await client.call("notion-delete-pages", { page_ids: batch.map((page) => page.id), user_confirmed: true });
		for (const page of batch) {
			log(`moved to Trash, ${page.kind}: ${page.title}`);
			options.onTrashed?.(page.kind, page.id, page.title);
		}
	}

	const missingLoose: FixtureNote[] = [];
	for (const note of spec.notes) {
		const target = targets.get(note.title);
		if (target?.kind === "scaffold") {
			const page = map.pages[target.page];
			live.push({ note, page: { id: page.id, url: page.url, target }, row: {}, isNew: false });
		} else if (target?.kind === "loose") {
			const matches = rootChildren.filter((child) => child.title === note.title);
			if (matches.length > 1) throw new Error(`The root page holds ${matches.length} pages with the title "${note.title}". Move the extra pages to Trash, then run again.`);
			const found = matches[0];
			if (found === undefined) {
				missingLoose.push(note);
				continue;
			}
			live.push({ note, page: { id: found.id, url: found.url, target }, row: {}, isNew: false });
			options.onExisting?.("page", found.id, note.title);
		}
	}
	await createPages("page", { page_id: map.root.id }, "title", missingLoose, { kind: "loose" });

	const context: NoteContext = {
		now: options.now,
		openLoopSections: parseOpenLoopConfig(manifestOf(spec)).sectionRe,
		pages: new Map(live.map((entry) => [entry.note.title, entry.page] as const)),
	};
	const fetchContent = async (id: string): Promise<string> => parsePage(await client.call("notion-fetch", { id })).content;

	let updated = 0;
	/** Write what differs: the content first, then the properties with the stamp, as the write hook sets the stamp last. */
	const apply = async (entry: LiveNote, content: string): Promise<void> => {
		const { note, page, row } = entry;
		const wanted = composeContent(notionBody(note, context.pages), content);
		const contentDiffers = !sameContent(wanted, content);
		if (contentDiffers) await client.call("notion-update-page", { page_id: page.id, command: "replace_content", new_str: wanted });

		let changed: string[] = [];
		if (page.target.kind === "row") {
			const difference = changedValues(desiredValues(note, page.target.database, context), liveValues(row, page.target.database));
			changed = Object.keys(difference);
			if (contentDiffers || changed.length > 0 || stampIsStale(row)) {
				const properties = { ...propertyArguments(difference, page.target.database), ...hookStampArguments(new Date()) };
				await client.call("notion-update-page", { page_id: page.id, command: "update_properties", properties });
				if (!contentDiffers && changed.length === 0) changed = ["Hook stamp"];
			}
		}
		if (!contentDiffers && changed.length === 0) return;
		if (!entry.isNew) {
			updated++;
			log(`updated ${note.title}: ${[...(contentDiffers ? ["content"] : []), ...changed].join(", ")}`);
		}
	};

	// A page that shows a synced block of another page comes last: its content holds the text of that block, which an earlier write can change.
	const contents = await Promise.all(live.map((entry) => (entry.isNew ? "" : fetchContent(entry.page.id))));
	const showsOtherPage = (index: number): boolean => (contents[index] ?? "").includes("<synced-block-reference");
	await Promise.all(live.map((entry, index) => (showsOtherPage(index) ? undefined : apply(entry, contents[index] ?? ""))));
	for (const [index, entry] of live.entries()) {
		if (showsOtherPage(index)) await apply(entry, await fetchContent(entry.page.id));
	}

	return { pages: context.pages, created, updated, unchanged: spec.notes.length - created - updated, trashed: mine.length, left: stale.length - mine.length, optionsAdded };
}

/**
 * The arguments of the one `notion-create-pages` call that writes `notes`:
 * the properties that a person writes and the body of each note. The write
 * hook adds the derived properties after the write. One call has one
 * parent, so the notes must have one place.
 */
export function createArguments(notes: readonly FixtureNote[], map: NotionMap, context: NoteContext): Record<string, unknown> {
	const [first] = notes;
	if (first === undefined) throw new Error("A write needs a note.");
	const target = targetOf(first);
	if (target.kind === "scaffold") throw new Error(`${first.title} is a page of the setup, and no scenario writes it.`);
	const other = notes.find((note) => JSON.stringify(targetOf(note)) !== JSON.stringify(target));
	if (other !== undefined) throw new Error(`${first.title} and ${other.title} have different places in Notion, so one call cannot write both.`);
	const parent = target.kind === "loose" ? { page_id: map.root.id } : { data_source_id: map.databases[target.database].data_source };
	const pages = notes.map((note) => ({
		properties: target.kind === "loose" ? { title: note.title } : { Name: note.title, ...propertyArguments(userValues(desiredValues(note, target.database, context)), target.database) },
		content: notionBody(note, context.pages),
	}));
	return { parent, allow_async: false, pages };
}

/**
 * Make the notes of `spec` exist in the Notion workspace that `mapFile`
 * describes. Each note has `Changed` at the instant that `changedAt` of
 * `spec.ts` gives for `now`. Each note also has the derived properties that
 * the write hook sets, with the values that its content gives: `Bytes`,
 * `Open tasks`, `Open loops`, `Has content`, and `Hook stamp`. The ported
 * hooks read these properties, so a note without them gives wrong findings.
 *
 * The result runs the hooks of `scriptsDir` on those notes. Its `wording`
 * is `NOTION_WORDING`, its `projectDir` holds the repository files of
 * `spec`, and its `env` adds only what the Notion calls need.
 *
 * `mapFile` is the path of the map file of the fixture root.
 */
export async function notionForm(
	spec: FixtureSpec,
	mapFile: string,
	options: { readonly scriptsDir: string; readonly now: Date },
): Promise<HookForm> {
	const map = readNotionMap(mapFile);
	const client = await createNotionClient();
	let pages: Pages;
	try {
		pages = (await writeFixture(client, spec, map, { now: options.now, ...ledgerHooksOf() })).pages;
	} finally {
		await client.close();
	}
	const context: NoteContext = { now: options.now, openLoopSections: parseOpenLoopConfig(manifestOf(spec)).sectionRe, pages };
	const titleOfId = new Map([...pages].map(([title, page]) => [page.id, title] as const));
	/** A hook names a page by its title, by its ID, or by a URL that ends in its ID. */
	const noteOf = (reference: string): string | null => {
		if (pages.has(reference)) return reference;
		const id = reference.replace(/[?#].*$/, "").replace(/-/g, "").match(/[0-9a-f]{32}$/i)?.[0];
		return id === undefined ? null : (titleOfId.get(notionId(id)) ?? null);
	};

	return (dir) => {
		const projectDir = join(dir, "project");
		const write = (path: string, content: string): void => {
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, content);
		};
		for (const file of spec.repoFiles) write(join(projectDir, file.path), file.content);
		const projectMap = join(projectDir, NOTION_MAP_FILE);
		copyFileSync(mapFile, projectMap);

		return {
			scriptsDir: options.scriptsDir,
			projectDir,
			env: { ...notionHookEnvironment(join(dir, "tools")), [NOTION_MAP_ENV]: projectMap },
			sessionLogDir: join(projectDir, ".claude", "state", "session-logs"),
			writePayload: (notes) => {
				const written = notes.map((note) => {
					const page = pages.get(note.title);
					if (page === undefined) throw new Error(`${note.title} is not a page of the fixture.`);
					return { id: page.id, url: page.url, properties: { title: note.title } };
				});
				const outbox = join(".claude", "state", "outbox", `${written[0]?.id}.json`);
				write(join(projectDir, outbox), JSON.stringify(createArguments(notes, map, context)));
				return {
					tool_name: "Bash",
					tool_input: { command: `mcporter call notion.notion-create-pages --args "$(cat ${outbox})"` },
					tool_response: { stdout: JSON.stringify({ pages: written }, null, 2), stderr: "", interrupted: false, isImage: false, noOutputExpected: false },
				};
			},
			wording: NOTION_WORDING,
			noteOf,
			notesIn: (group) => notesInGroup(spec.notes, group),
		};
	};
}
