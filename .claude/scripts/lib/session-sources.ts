/**
 * What the SessionStart hook reads from the Notion workspace, as data. The
 * hook makes its context from this value and from nothing else of Notion.
 *
 *     const notion = lazyNotion(budgetMs, { concurrency });
 *     const sources = await readSessionSources({ call: notion.call, map, projectDir, nowMs: Date.now(), mode, watchedTypes, openTaskLimit: 10 });
 *     await notion.close();
 *     sources.activeWork   // { value: ["Billing Export Pipeline", …] } or { notRead: "the cause" }
 *
 * The reads run at the same time on the one `call`, so they share its
 * client and its time. A read that fails gives `notRead` with its cause
 * for its own part, and each other part stays. The function does not throw.
 */

import { type HygieneReport, hygieneNotRead, scanHygiene } from "./hygiene-scan.ts";
import type { NotionClient } from "./notion-client.ts";
import type { NotionMap } from "./notion-map.ts";
import { DATABASES, LOOSE_ACTIVE_TYPES, type DatabaseKey, type DatabaseSpec } from "./notion-model.ts";
import { notionId, parsePage, parseRows } from "./notion-parse.ts";
import type { ListingGroup } from "./session-start.ts";
import { LOOSE_ACTIVE_VIEW } from "./write-check.ts";

const RECENTLY_CHANGED_VIEW = "Recently changed";
const BRAIN_INDEX_VIEW = "Brain index";
const OPEN_TASKS_VIEW = "Open tasks";

/** The listing group of the work that is done. The vault kept it in `work/archive/`. */
const ARCHIVED_WORK_GROUP = "Work / Archived";

const RECENT_CHANGE_MS = 48 * 3_600_000;
const ARCHIVED_STATUSES: readonly string[] = ["completed", "archived"];
/** The vault kept these rows in `thinking/`, which the listing did not show. */
const UNLISTED_TYPE = "Thinking";
/** The rows of this database are scaffold, as the files of `templates/` were. */
const SCAFFOLD_DATABASE: DatabaseKey = "templates";
/** The pages of the setup under the root page that hold views and no note text. */
const UNLISTED_PAGES = ["recently_touched", "people_and_context", "reader_map"] as const;

/** A part of the workspace as the hook read it, or the cause of a read that failed. */
export type Read<T> = { readonly value: T } | { readonly notRead: string };

export interface BrainTopic {
	readonly name: string;
	readonly description: string | null;
	readonly hasContent: boolean;
}

export interface OpenTasks {
	/** The notes whose tasks the section can show, with their text: the loose active rows first, then Home. */
	readonly notes: readonly { readonly title: string; readonly content: string }[];
	/** The open tasks of the rows that the hook did not fetch, from their `Open tasks` property. */
	readonly notFetched: number;
}

export interface Listing {
	/** The titles of the note pages under the root page, which are in no database. */
	readonly pages: readonly string[];
	readonly groups: readonly ListingGroup[];
}

/** The parts that each SessionStart gives. */
interface VolatileSources {
	/** The titles of the rows with `Changed` in the last 48 hours, the latest first. */
	readonly recentChanges: Read<readonly string[]>;
	readonly openTasks: Read<OpenTasks>;
	/** The titles of the active Work rows with no `Project`, in the order of the titles. */
	readonly activeWork: Read<readonly string[]>;
	readonly hygiene: HygieneReport;
}

/** The parts that only a full context gives. After a resume or a compaction the session has them already. */
interface StaticSources {
	/** The body of the North Star page as plain Markdown. */
	readonly northStar: Read<string>;
	readonly brainTopics: Read<readonly BrainTopic[]>;
	readonly listing: Read<Listing>;
}

export type SessionSources = VolatileSources & ({ readonly mode: "pointer" } | ({ readonly mode: "full" } & StaticSources));

export interface SessionRequest {
	/** The Notion call of the hook run. */
	readonly call: NotionClient["call"];
	readonly map: NotionMap;
	/** The directory that holds AGENTS.md. */
	readonly projectDir: string;
	readonly nowMs: number;
	readonly mode: SessionSources["mode"];
	/** `open_loop_types` of the manifest, for the hygiene scan. */
	readonly watchedTypes: readonly string[];
	/** The most open tasks that the section shows. The hook fetches at most this number of rows for their tasks. */
	readonly openTaskLimit: number;
}

type Row = Readonly<Record<string, unknown>>;

const causeOf = (error: unknown): string => (error instanceof Error ? error.message : String(error)).split("\n")[0]!.slice(0, 200);

const textOf = (row: Row, name: string): string | null => {
	const value = row[name];
	return typeof value === "string" && value !== "" ? value : null;
};

const changedMs = (row: Row): number | null => {
	const ms = Date.parse(textOf(row, "date:Changed:start") ?? "");
	return Number.isNaN(ms) ? null : ms;
};

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const INLINE_TAGS: readonly (readonly [RegExp, string])[] = [
	[/<\/?s>/g, "~~"],
	[/<\/?b>/g, "**"],
	[/<\/?i>/g, "*"],
	[/<\/?code>/g, "`"],
];
const SHOWN_BLOCK = /<synced-block-reference\b[^>]*>[\s\S]*?<\/synced-block-reference>\n?/g;
const BLOCK_TAG_LINE = /^\s*<\/?(?:synced-block|synced-block-reference|ul)\b[^>]*>\s*$/;

/**
 * Fetched content without the text that the page only shows. A synced block
 * reference holds the text of a block of a different page, so a task in it
 * is a task of that page.
 */
export const ownContent = (content: string): string => content.replace(SHOWN_BLOCK, "");

/**
 * Fetched content as the Markdown of the vault (measured on fetched pages):
 * no line of a synced block tag, `~~` for a strike-through tag, the title
 * for a mention of a page, and `- ` for an empty list item.
 */
export function plainMarkdown(content: string): string {
	return content
		.split("\n")
		.filter((line) => !BLOCK_TAG_LINE.test(line))
		.map((line) => {
			let text = line.replace(/^(\s*)<li>(.*)<\/li>\s*$/, "$1- $2").replace(/<mention url="[^"]*"[^>]*>([^<]+)<\/mention>/g, "$1");
			for (const [tag, mark] of INLINE_TAGS) text = text.replace(tag, mark);
			return text;
		})
		.join("\n");
}

/** The rows of one saved view. `enough` stops the read after a page that makes it true. */
async function viewRows(call: NotionClient["call"], url: string, enough: (rows: readonly Row[]) => boolean = () => false): Promise<Row[]> {
	const rows: Row[] = [];
	let cursor: string | undefined;
	do {
		const page = parseRows(await call("notion-query-data-sources", { data: { mode: "view", view_url: url, page_size: 100, ...(cursor === undefined ? {} : { start_cursor: cursor }) } }));
		rows.push(...page.rows.filter((row) => textOf(row, "Name") !== null));
		cursor = page.nextCursor;
	} while (cursor !== undefined && !enough(rows));
	return rows;
}

const titleOf = (row: Row): string => textOf(row, "Name") ?? "";

/** The group of a row in the listing, or `null` for a row that the listing does not show. */
function listingGroup(spec: DatabaseSpec, row: Row): { readonly name: string; readonly alwaysCollapsed: boolean } | null {
	const type = "Type" in spec.properties ? textOf(row, "Type") : null;
	if (type === UNLISTED_TYPE) return null;
	const done = spec.key === "work" && type !== null && (LOOSE_ACTIVE_TYPES as readonly string[]).includes(type) && ARCHIVED_STATUSES.includes(textOf(row, "Status") ?? "");
	if (done) return { name: ARCHIVED_WORK_GROUP, alwaysCollapsed: true };
	return { name: type === null ? spec.title : `${spec.title} / ${type}`, alwaysCollapsed: false };
}

function listingGroups(databases: readonly { readonly spec: DatabaseSpec; readonly rows: readonly Row[] }[]): ListingGroup[] {
	const groups = new Map<string, { titles: string[]; alwaysCollapsed: boolean }>();
	for (const { spec, rows } of databases) {
		for (const row of rows) {
			const group = listingGroup(spec, row);
			if (group === null) continue;
			const entry = groups.get(group.name) ?? { titles: [], alwaysCollapsed: group.alwaysCollapsed };
			entry.titles.push(titleOf(row));
			groups.set(group.name, entry);
		}
	}
	return [...groups].map(([name, { titles, alwaysCollapsed }]) => ({ name, titles, alwaysCollapsed }));
}

/**
 * The sources of a run that cannot start its reads, because it cannot use
 * `what`. Each part names `what`. The hygiene report has the findings of
 * the local files, and it has the cause one time.
 */
export function sessionSourcesNotRead(mode: SessionSources["mode"], projectDir: string, what: string, cause: unknown): SessionSources {
	const notRead = { notRead: `the hook cannot use ${what}` };
	const volatile: VolatileSources = { recentChanges: notRead, openTasks: notRead, activeWork: notRead, hygiene: hygieneNotRead(projectDir, what, cause) };
	return mode === "pointer" ? { mode, ...volatile } : { mode, ...volatile, northStar: notRead, brainTopics: notRead, listing: notRead };
}

export async function readSessionSources({ call, map, projectDir, nowMs, mode, watchedTypes, openTaskLimit }: SessionRequest): Promise<SessionSources> {
	const reading = async <T>(read: () => Promise<T>): Promise<Read<T>> => {
		try {
			return { value: await read() };
		} catch (error) {
			return { notRead: causeOf(error) };
		}
	};
	const rowsOf = async (database: DatabaseKey, view: string, enough?: (rows: readonly Row[]) => boolean): Promise<Row[]> => {
		const url = map.databases[database]?.views[view];
		if (url === undefined) throw new Error(`the map file does not have the view "${view}", run notion-setup.ts`);
		return viewRows(call, url, enough);
	};
	const fetchPage = async (id: string) => parsePage(await call("notion-fetch", { id }));
	/** The text of a page that is its own, as plain Markdown. */
	const ownText = (content: string): string => plainMarkdown(ownContent(content)).trim();

	const since = nowMs - RECENT_CHANGE_MS;
	const isRecent = (row: Row): boolean => (changedMs(row) ?? Number.NEGATIVE_INFINITY) >= since;
	/** The view has the latest change first. A row with no `Changed` has no known place in it, so it does not end the read. */
	const pastRecent = (rows: readonly Row[]): boolean => {
		const last = rows.at(-1);
		return last !== undefined && changedMs(last) !== null && !isRecent(last);
	};
	const noteDatabases = DATABASES.filter(({ key }) => key !== SCAFFOLD_DATABASE);
	// A full context lists each row, so it reads each page of the view. The other context needs only the rows of the last 48 hours.
	const databases = reading(() => Promise.all(noteDatabases.map(async (spec) => ({ spec, rows: await rowsOf(spec.key, RECENTLY_CHANGED_VIEW, mode === "full" ? undefined : pastRecent) }))));

	const recentChanges = async (): Promise<Read<readonly string[]>> => {
		const read = await databases;
		if ("notRead" in read) return read;
		const recent = read.value.flatMap(({ rows }) => rows.filter(isRecent)).sort((a, b) => (changedMs(b) ?? 0) - (changedMs(a) ?? 0) || byText(titleOf(a), titleOf(b)));
		return { value: recent.map(titleOf) };
	};

	const openTasks = (): Promise<Read<OpenTasks>> =>
		reading(async () => {
			const [rows, home] = await Promise.all([rowsOf("work", OPEN_TASKS_VIEW), fetchPage(map.pages.home.id)]);
			const withTasks = rows
				.flatMap((row) => {
					const url = textOf(row, "url");
					return url === null ? [] : [{ title: titleOf(row), url, openTasks: typeof row["Open tasks"] === "number" ? row["Open tasks"] : 0 }];
				})
				.sort((a, b) => byText(a.title, b.title));
			const fetched = withTasks.slice(0, Math.max(0, openTaskLimit));
			const notes = await Promise.all(fetched.map(async ({ title, url }) => ({ title, content: ownText((await fetchPage(notionId(url))).content) })));
			const notFetched = withTasks.slice(fetched.length).reduce((sum, row) => sum + row.openTasks, 0);
			return { notes: [...notes, { title: home.title || map.pages.home.title, content: ownText(home.content) }], notFetched };
		});

	const activeWork = (): Promise<Read<readonly string[]>> => reading(async () => (await rowsOf("work", LOOSE_ACTIVE_VIEW)).map(titleOf).sort(byText));

	const volatile = async (): Promise<VolatileSources> => {
		const [changes, tasks, active, hygiene] = await Promise.all([recentChanges(), openTasks(), activeWork(), scanHygiene({ call, map, projectDir, nowMs, watchedTypes })]);
		return { recentChanges: changes, openTasks: tasks, activeWork: active, hygiene };
	};
	if (mode === "pointer") return { mode, ...(await volatile()) };

	const northStar = reading(async () => plainMarkdown((await fetchPage(map.pages.north_star.id)).content).trimEnd());
	const brainTopics = reading(async () =>
		(await rowsOf("knowledge", BRAIN_INDEX_VIEW))
			.map((row): BrainTopic => ({ name: titleOf(row), description: textOf(row, "Description"), hasContent: row["Has content"] === "__YES__" }))
			.sort((a, b) => byText(a.name, b.name)),
	);
	const rootPages = reading(async () => {
		const unlisted = new Set(UNLISTED_PAGES.map((key) => map.pages[key].id));
		return (await fetchPage(map.root.id)).children.filter(({ kind, id }) => kind === "page" && !unlisted.has(id)).map(({ title }) => title);
	});
	const [parts, star, topics, pages, read] = await Promise.all([volatile(), northStar, brainTopics, rootPages, databases]);
	const listing: Read<Listing> = "notRead" in pages ? pages : "notRead" in read ? read : { value: { pages: pages.value, groups: listingGroups(read.value) } };
	return { mode, ...parts, northStar: star, brainTopics: topics, listing };
}
