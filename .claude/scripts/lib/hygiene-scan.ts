/**
 * The hygiene scan of the Notion workspace, for the Stop hook and the
 * SessionStart hook. It reads the saved hygiene views with view queries
 * that run at the same time, and it gives one report.
 *
 *     const notion = lazyNotion();
 *     const report = await scanHygiene({ call: notion.call, map, projectDir, nowMs: Date.now(), watchedTypes });
 *     const lines = formatHygiene(report);   // [] when the workspace is clean
 *     const claims = hygieneClaims(report);  // one short claim for each finding
 *
 * A view gives the rows that can have a finding. Each rule is also in this
 * file, so a view that returns too many rows adds no finding. A view that
 * the scan cannot read is in `notRead`, and its finding is not in the
 * report. The scan does not throw.
 *
 * The text of a finding is the text of the scan at `fae7be4` with the name
 * of the Notion object in the place of the Markdown object.
 */

import {
	agentsMdClaim,
	agentsMdLine,
	agentsMdPastFlag,
	HYGIENE_LIST_CAP,
	INBOX_PRESSURE_DAYS,
	instructionFileFindings,
	isMonolithExempt,
	leftoverClaim,
	leftoverLine,
	MONOLITH_BYTES,
	namesCapped,
	OPEN_LOOP_CAP,
	OPEN_LOOP_DAYS,
	topicClusters,
	type InboxPressure,
	type TopicCluster,
} from "./active-hygiene.ts";
import type { NotionClient } from "./notion-client.ts";
import type { NotionMap } from "./notion-map.ts";
import { DATABASES, type DatabaseKey } from "./notion-model.ts";
import { parseRows } from "./notion-parse.ts";
import { LOOSE_ACTIVE_VIEW } from "./write-check.ts";

export const OVERSIZED_VIEW = "Hygiene: oversized";
export const OPEN_LOOPS_VIEW = "Hygiene: open loops";
export const INBOX_PRESSURE_VIEW = "Hygiene: inbox pressure";
/** Each 1:1 row, the latest `Date` first. */
export const ONE_ON_ONE_VIEW = "1:1 History";

const ONE_ON_ONE_TYPE = "1:1";
const INBOX_TYPE = "Inbox item";
/** The rows of this database are scaffold, as the files of `templates/` were. The size rule leaves them out. */
const SCAFFOLD_DATABASE: DatabaseKey = "templates";
const DAY_MS = 86_400_000;

export interface OversizedNote {
	readonly title: string;
	readonly sizeKb: number;
}

export interface OpenLoop {
	readonly title: string;
	readonly ageDays: number;
	readonly openItems: number;
}

/** A part of the scan that gave no result, so the report does not hold its finding. */
export interface NotRead {
	/** The view and its database, or the file that the scan needs. */
	readonly view: string;
	readonly cause: string;
}

export interface HygieneReport {
	/** HY-02: the topic clusters of the active rows with no `Project`. `files` holds row titles. */
	readonly ungroupedClusters: readonly TopicCluster[];
	/** HY-03: the largest first. */
	readonly oversizedNotes: readonly OversizedNote[];
	/** HY-04: the oldest first, at most `OPEN_LOOP_CAP`. */
	readonly openLoops: readonly OpenLoop[];
	/** HY-05 */
	readonly inboxPressure: InboxPressure | null;
	/** HY-07: retired instruction files beside AGENTS.md, in the project directory. */
	readonly leftoverInstructionFiles: readonly string[];
	/** HY-09: the size of AGENTS.md from its flag size, or `null`. */
	readonly agentsMd: { readonly sizeKb: number } | null;
	readonly notRead: readonly NotRead[];
}

/**
 * The fields of a report that change with no new drift: a size, an age, and
 * the words of a failure. The identity of a report leaves them out
 * (lib/report-key.ts), so a Stop report does not show again for them.
 */
export const HYGIENE_VOLATILE_FIELDS: ReadonlySet<string> = new Set(["sizeKb", "ageDays", "oldestDays", "cause"]);

export interface HygieneSource {
	/** The Notion call of the hook run. Each call that fails becomes an entry of `notRead`. */
	readonly call: NotionClient["call"];
	readonly map: NotionMap;
	/** The directory that holds AGENTS.md. */
	readonly projectDir: string;
	readonly nowMs: number;
	/** The `Type` values of the Work rows whose open loops count: `open_loop_types` of the manifest. */
	readonly watchedTypes: readonly string[];
}

/** One row of a hygiene view, with the values that the rules read. */
interface ViewRow {
	readonly title: string;
	readonly type: string | null;
	readonly changedMs: number | null;
	readonly bytes: number | null;
	readonly openLoops: number | null;
}

function viewRow(raw: Readonly<Record<string, unknown>>): ViewRow | null {
	const title = raw["Name"];
	if (typeof title !== "string" || title === "") return null;
	const changed = raw["date:Changed:start"];
	const changedMs = typeof changed === "string" ? Date.parse(changed) : Number.NaN;
	const number = (name: string): number | null => (typeof raw[name] === "number" ? (raw[name] as number) : null);
	return {
		title,
		type: typeof raw["Type"] === "string" ? raw["Type"] : null,
		changedMs: Number.isNaN(changedMs) ? null : changedMs,
		bytes: number("Bytes"),
		openLoops: number("Open loops"),
	};
}

const ageDays = (row: ViewRow, nowMs: number): number | null => (row.changedMs === null ? null : Math.floor((nowMs - row.changedMs) / DAY_MS));

/** HY-03 for the rows of the oversized views. */
export function oversizedNotes(rows: readonly ViewRow[]): OversizedNote[] {
	return rows
		.filter((row) => row.bytes !== null && row.bytes >= MONOLITH_BYTES && !isMonolithExempt(row.title))
		.sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0) || a.title.localeCompare(b.title))
		.map((row) => ({ title: row.title, sizeKb: Math.round((row.bytes ?? 0) / 1000) }));
}

/** `<Person> YYYY-MM-DD` gives the person. A 1:1 row with a different title has no person. */
export function oneOnOnePerson(title: string): string | null {
	return title.match(/^(.+?)\s+\d{4}-\d{2}-\d{2}$/)?.[1] ?? null;
}

/**
 * HY-04 for the rows of the open-loops view. `latestOneOnOne` has the title
 * of the latest 1:1 row of each person. An older 1:1 row holds items that
 * the later one carries forward, so only the latest one counts.
 */
export function openLoops(rows: readonly ViewRow[], latestOneOnOne: ReadonlyMap<string, string>, nowMs: number, watchedTypes: readonly string[]): OpenLoop[] {
	const found: { readonly loop: OpenLoop; readonly changedMs: number }[] = [];
	for (const row of rows) {
		if (row.type === null || !watchedTypes.includes(row.type)) continue;
		// A row with "Archive" in its name holds a record, not a live loop.
		if (row.title.includes("Archive")) continue;
		if (row.type === ONE_ON_ONE_TYPE) {
			const person = oneOnOnePerson(row.title);
			if (person === null || latestOneOnOne.get(person) !== row.title) continue;
		}
		const age = ageDays(row, nowMs);
		if (age === null || row.changedMs === null || age < OPEN_LOOP_DAYS) continue;
		if (row.openLoops === null || row.openLoops <= 0) continue;
		found.push({ loop: { title: row.title, ageDays: age, openItems: row.openLoops }, changedMs: row.changedMs });
	}
	return found
		.sort((a, b) => a.changedMs - b.changedMs || a.loop.title.localeCompare(b.loop.title))
		.slice(0, OPEN_LOOP_CAP)
		.map(({ loop }) => loop);
}

/** HY-05 for the rows of the inbox view. */
export function inboxPressure(rows: readonly ViewRow[], nowMs: number): InboxPressure | null {
	const ages = rows.flatMap((row) => {
		const age = row.type === INBOX_TYPE ? ageDays(row, nowMs) : null;
		return age !== null && age >= INBOX_PRESSURE_DAYS ? [age] : [];
	});
	return ages.length === 0 ? null : { count: ages.length, oldestDays: Math.max(...ages) };
}

const causeOf = (error: unknown): string => (error instanceof Error ? error.message : String(error)).split("\n")[0]!.slice(0, 200);

/** The findings of the files of the project directory, which need no Notion. */
function localFindings(projectDir: string): Pick<HygieneReport, "leftoverInstructionFiles" | "agentsMd"> {
	return { ...instructionFileFindings(projectDir), agentsMd: agentsMdPastFlag(projectDir) };
}

/** The report of a scan that cannot start: the findings of the local files, and `what` as not read. */
export function hygieneNotRead(projectDir: string, what: string, cause: unknown): HygieneReport {
	return {
		ungroupedClusters: [],
		oversizedNotes: [],
		openLoops: [],
		inboxPressure: null,
		...localFindings(projectDir),
		notRead: [{ view: what, cause: causeOf(cause) }],
	};
}

export async function scanHygiene({ call, map, projectDir, nowMs, watchedTypes }: HygieneSource): Promise<HygieneReport> {
	const notRead: NotRead[] = [];

	/** The rows of one saved view. `enough` stops the read after a page that makes it true. */
	const rowsOf = async (database: DatabaseKey, view: string, enough: (rows: readonly ViewRow[]) => boolean = () => false): Promise<ViewRow[]> => {
		const url = map.databases[database]?.views[view];
		if (url === undefined) throw new Error("the map file does not have the view, run notion-setup.ts");
		const rows: ViewRow[] = [];
		let cursor: string | undefined;
		do {
			const page = parseRows(await call("notion-query-data-sources", { data: { mode: "view", view_url: url, page_size: 100, ...(cursor === undefined ? {} : { start_cursor: cursor }) } }));
			rows.push(...page.rows.flatMap((raw) => viewRow(raw) ?? []));
			cursor = page.nextCursor;
		} while (cursor !== undefined && !enough(rows));
		return rows;
	};
	const titleOf = (database: DatabaseKey): string => DATABASES.find(({ key }) => key === database)?.title ?? database;
	/** The result of `read`, or `empty` and an entry of `notRead`. */
	const reading = async <T>(database: DatabaseKey, view: string, empty: T, read: () => Promise<T>): Promise<T> => {
		try {
			return await read();
		} catch (error) {
			notRead.push({ view: `"${view}" of ${titleOf(database)}`, cause: causeOf(error) });
			return empty;
		}
	};

	const watchedOpenLoops = async (): Promise<OpenLoop[]> => {
		const rows = await rowsOf("work", OPEN_LOOPS_VIEW);
		const persons = new Set(rows.flatMap((row) => (row.type === ONE_ON_ONE_TYPE && watchedTypes.includes(ONE_ON_ONE_TYPE) ? (oneOnOnePerson(row.title) ?? []) : [])));
		const latest = new Map<string, string>();
		if (persons.size > 0) {
			const personsOf = (seen: readonly ViewRow[]): Set<string> => new Set(seen.flatMap((row) => oneOnOnePerson(row.title) ?? []));
			// The view has the latest row of a person first, so the read stops when it has a row of each person.
			const history = await rowsOf("work", ONE_ON_ONE_VIEW, (seen) => [...persons].every((person) => personsOf(seen).has(person))).catch((error: unknown) => {
				// Without the latest 1:1 row of each person, the list can hold a row that does not count. So the finding has no list.
				throw new Error(`the view "${ONE_ON_ONE_VIEW}" gave no rows: ${causeOf(error)}`);
			});
			for (const { title } of history) {
				const person = oneOnOnePerson(title);
				if (person !== null && title > (latest.get(person) ?? "")) latest.set(person, title);
			}
		}
		return openLoops(rows, latest, nowMs, watchedTypes);
	};

	const sized = DATABASES.map(({ key }) => key).filter((key) => key !== SCAFFOLD_DATABASE);
	const [clusters, loops, inbox, ...large] = await Promise.all([
		reading("work", LOOSE_ACTIVE_VIEW, [], async () => topicClusters((await rowsOf("work", LOOSE_ACTIVE_VIEW)).map(({ title }) => title))),
		reading("work", OPEN_LOOPS_VIEW, [], watchedOpenLoops),
		reading("work", INBOX_PRESSURE_VIEW, null, async () => inboxPressure(await rowsOf("work", INBOX_PRESSURE_VIEW), nowMs)),
		...sized.map((database) => reading(database, OVERSIZED_VIEW, [], () => rowsOf(database, OVERSIZED_VIEW))),
	] as const);

	return {
		ungroupedClusters: clusters,
		oversizedNotes: oversizedNotes(large.flat()),
		openLoops: loops,
		inboxPressure: inbox,
		...localFindings(projectDir),
		notRead: notRead.sort((a, b) => a.view.localeCompare(b.view)),
	};
}

/** One finding of a report: its claim, its line, and the lines of its entries. */
interface Block {
	/** What the finding says, without its entries and its instruction. A Stop summary is made of the claims. */
	readonly claim: string;
	/** The claim with its instruction. */
	readonly line: string;
	readonly entries: readonly string[];
}

function listCapped<T>(items: readonly T[], render: (item: T) => string): string[] {
	const more = items.length - HYGIENE_LIST_CAP;
	const shown = items.slice(0, HYGIENE_LIST_CAP).map((item) => `   - ${render(item)}`);
	return more > 0 ? [...shown, `   - … and ${more} more`] : shown;
}

const flag = (claim: string, instruction: string, entries: readonly string[] = []): Block => ({ claim, line: `⚠️  ${claim}${instruction}`, entries });

/**
 * The findings of a report in the order of the output. The lines and the
 * claims both come from this list, so the two have one order and one text.
 * A retired instruction file is first: while it stays, an agent reads none
 * of the conventions in AGENTS.md.
 */
function blocks(report: HygieneReport): Block[] {
	const { ungroupedClusters, oversizedNotes: oversized, openLoops: loops, inboxPressure: inbox, leftoverInstructionFiles, agentsMd, notRead } = report;
	const out: Block[] = [];
	for (const file of leftoverInstructionFiles) out.push({ claim: leftoverClaim(file), line: leftoverLine(file), entries: [] });
	if (agentsMd !== null) out.push({ claim: agentsMdClaim(agentsMd.sizeKb), line: agentsMdLine(agentsMd.sizeKb), entries: [] });
	if (ungroupedClusters.length > 0) {
		out.push(
			flag(
				"Active rows with no `Project` that look like one topic",
				" — consider a `Project` value:",
				listCapped(ungroupedClusters, ({ token, files }) => `"${token}": ${namesCapped(files)}`),
			),
		);
	}
	if (oversized.length > 0) {
		out.push(
			flag(
				`${oversized.length} note(s) past the ${MONOLITH_BYTES / 1000}KB organization threshold`,
				" — do NOT trim content; SPLIT (domain notes / event-log satellites / a cluster folder, verbatim, one-liner index behind):",
				listCapped(oversized, ({ title, sizeKb }) => `${title} (${sizeKb}KB)`),
			),
		);
	}
	if (loops.length > 0) {
		out.push(
			flag(
				`${loops.length} note(s) with open follow-ups untouched ${OPEN_LOOP_DAYS}+ days`,
				" — close, chase, or consciously park (titles + counts only by design):",
				loops.map(({ title, ageDays: age, openItems }) => `   - ${title} (${age}d, ${openItems} open item(s))`),
			),
		);
	}
	if (inbox !== null) {
		out.push(flag(`${inbox.count} inbox item(s) unchanged for ${INBOX_PRESSURE_DAYS}+ days`, ` (oldest ${inbox.oldestDays}d) — ask the agent to run om-intake to drain the inbox.`));
	}
	if (notRead.length > 0) {
		out.push(
			flag(
				`${notRead.length} part(s) of the hygiene scan not read`,
				" — the findings of each one are not in this report:",
				notRead.map(({ view, cause }) => `   - ${view} (${cause})`),
			),
		);
	}
	return out;
}

/** The claim of each finding of `report`, in the order of `formatHygiene`. */
export function hygieneClaims(report: HygieneReport): string[] {
	return blocks(report).map(({ claim }) => claim);
}

/** The report as lines of hook output, with an empty line between two findings. `[]` for a report with no finding. */
export function formatHygiene(report: HygieneReport): string[] {
	return blocks(report).flatMap(({ line, entries }, index) => [...(index === 0 ? [] : [""]), line, ...entries]);
}
