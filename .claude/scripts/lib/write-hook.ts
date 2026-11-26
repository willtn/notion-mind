/**
 * The write check for one `Bash` payload: the Notion calls, the map file,
 * the manifest, and the outbox file around the pure findings of
 * lib/write-check.ts. validate-write.ts loads this module only for a
 * command that names `mcporter` and Notion, so each other `Bash` call
 * pays for none of it.
 */

import { readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseOpenLoopConfig } from "./active-hygiene.ts";
import { parseFrontmatterRequired } from "./frontmatter.ts";
import { debug } from "./hook-io.ts";
import { createNotionClient, type NotionClient, type NotionClientOptions } from "./notion-client.ts";
import { notionMapPath, readNotionMap, type NotionMap } from "./notion-map.ts";
import { DATABASES } from "./notion-model.ts";
import { ensureSelectOptions } from "./notion-options.ts";
import { parseNotePage, parseRows, type NotePage } from "./notion-parse.ts";
import { notionCall, selectValues, targetPlace, writtenNotes, type NotionCall } from "./notion-written.ts";
import { LOOSE_ACTIVE_VIEW, checkNote, derivedUpdate, isLooseActive, type NoteFindings } from "./write-check.ts";

const NO_FINDINGS: NoteFindings = { blocks: [], policyResults: [] };
const causeOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * The time that one hook run has for all its Notion calls. The hook
 * timeout of `settings.json` is 15 s, and a run that passes it prints
 * nothing and leaves the outbox file. A limit for each call was too short:
 * one view query of about 200 live calls took more than 4 s (measured).
 */
export const NOTION_BUDGET_MS = 12_000;

/** The Notion calls of one hook run. */
export interface Notion {
	readonly call: NotionClient["call"];
	readonly fetchPage: (id: string) => Promise<NotePage>;
	readonly close: () => Promise<void>;
}

/**
 * A Notion client that connects at the first call, so a write with no
 * Notion call opens no connection. Each call has the time that is left of
 * `budgetMs`. A call runs one more time after a `rate_limited` reply when
 * the wait that Notion names is inside that time. A longer wait ends the
 * call at once: after 180 requests in 10 s the named wait was 49 s, and it
 * went down by 1 s in each second (measured). `options` has the transport
 * and the clock of a test.
 */
export function lazyNotion(budgetMs: number = NOTION_BUDGET_MS, options: Pick<NotionClientOptions, "transport" | "sleep" | "now"> = {}): Notion {
	const deadline = Date.now() + budgetMs;
	const sleep = (ms: number): Promise<void> => {
		const left = deadline - Date.now();
		if (ms <= left) return new Promise((resolve) => setTimeout(resolve, ms));
		return Promise.reject(new Error(`Notion limits the rate and names a wait of ${Math.ceil(ms / 1000)} s, and the hook has ${Math.max(0, Math.floor(left / 1000))} s left`));
	};
	const connect = (): Promise<NotionClient> => createNotionClient({ maxRetries: 1, timeoutMs: budgetMs, sleep, ...options });
	let client: Promise<NotionClient> | undefined;
	const call: NotionClient["call"] = (tool, args) => {
		const left = deadline - Date.now();
		const late = (): Error => new Error(`${tool} got no reply in the ${budgetMs / 1000} s that the hook has for Notion`);
		if (left <= 0) return Promise.reject(late());
		let timer: NodeJS.Timeout | undefined;
		const timeout = new Promise<never>((_, reject) => {
			timer = setTimeout(() => reject(late()), left);
		});
		const reply = (async () => (await (client ??= connect())).call(tool, args))();
		return Promise.race([reply, timeout]).finally(() => clearTimeout(timer));
	};
	return {
		call,
		fetchPage: async (id) => parseNotePage(await call("notion-fetch", { id })),
		close: async () => {
			await client?.then((open) => open.close()).catch(() => {});
		},
	};
}

function readManifest(vaultRoot: string): string | null {
	try {
		return readFileSync(join(vaultRoot, "vault-manifest.json"), "utf-8");
	} catch {
		return null;
	}
}

function parseManifest(text: string | null): unknown {
	try {
		return text === null ? null : JSON.parse(text);
	} catch {
		return null;
	}
}

async function looseActiveTitles(notion: Notion, map: NotionMap): Promise<string[] | null> {
	const view = map.databases.work.views[LOOSE_ACTIVE_VIEW];
	if (view === undefined) return null;
	const titles: string[] = [];
	let cursor: string | undefined;
	do {
		const reply = await notion.call("notion-query-data-sources", {
			data: { mode: "view", view_url: view, page_size: 100, ...(cursor === undefined ? {} : { start_cursor: cursor }) },
		});
		const page = parseRows(reply);
		for (const row of page.rows) if (typeof row["Name"] === "string") titles.push(row["Name"]);
		cursor = page.nextCursor;
	} while (cursor !== undefined);
	return titles;
}

async function checkWrite(notion: Notion, call: NotionCall, map: NotionMap, vaultRoot: string): Promise<NoteFindings[]> {
	const notes = await writtenNotes(call, map, notion.fetchPage);
	if (notes.length === 0) return [];
	const manifest = readManifest(vaultRoot);
	const required = parseFrontmatterRequired(parseManifest(manifest));
	const openLoopSections = parseOpenLoopConfig(manifest).sectionRe;

	// The view query and the updates do not need each other, so they run at the same time.
	const written = notes.filter(isLooseActive).map(({ title }) => title);
	const inView: Promise<readonly string[] | null> =
		written.length === 0
			? Promise.resolve(null)
			: looseActiveTitles(notion, map).catch((error: unknown) => {
					debug(`validate: cluster check failed — ${causeOf(error)}`);
					return null;
				});
	const at = new Date();
	const notSet = notes.map(async (note): Promise<string[]> => {
		const update = derivedUpdate(note, openLoopSections, at);
		if (update === null) return [];
		try {
			await notion.call("notion-update-page", update);
			return [];
		} catch (error) {
			return [`⚠️  The derived properties of \`${note.title}\` are not set (${causeOf(error)}). The view "Hygiene: edited outside hooks" returns the row until the next write.`];
		}
	});

	const titles = await inView;
	// The view held each new row at once in the measured writes. Notion states no guarantee, so each written row counts also when the view does not hold it.
	const looseActive = titles === null ? null : [...titles, ...written];
	return Promise.all(
		notes.map(async (note, index): Promise<NoteFindings> => {
			let findings = NO_FINDINGS;
			try {
				findings = checkNote(note, { required, looseActive });
			} catch (error) {
				debug(`validate: ${note.title} — check failed: ${causeOf(error)}`);
			}
			return { ...findings, blocks: [...findings.blocks, ...((await notSet[index]) ?? [])] };
		}),
	);
}

/** A failed write can lack a select option, because Notion rejects a value that the schema does not hold. */
async function addSelectOptions(notion: Notion, call: NotionCall, map: NotionMap): Promise<NoteFindings> {
	const place = await targetPlace(call, map, notion.fetchPage);
	if (place?.kind !== "row") return NO_FINDINGS;
	const database = map.databases[place.database];
	const model = DATABASES.find((spec) => spec.key === place.database)?.properties ?? {};
	const selects = Object.keys(model).filter((name) => model[name]?.type === "select" || model[name]?.type === "multi_select");
	const wanted = selectValues(call, selects);
	if (Object.keys(wanted).length === 0) return NO_FINDINGS;
	const added = await ensureSelectOptions(notion, database, wanted);
	if (added === 0) return NO_FINDINGS;
	return {
		blocks: [`The database \`${database.title}\` now has ${added} new select option(s) that this write needs. Run the same command again.`],
		policyResults: [],
	};
}

/**
 * The findings for the `Bash` payload `input`, one entry for each written
 * note. `vaultRoot` holds the manifest and the map file.
 */
export async function checkBash(input: { readonly cwd?: unknown }, vaultRoot: string): Promise<NoteFindings[]> {
	const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
	const outboxPath = (outbox: string): string => resolve(cwd, outbox);
	const readOutbox = (outbox: string): string | null => {
		try {
			return readFileSync(outboxPath(outbox), "utf-8");
		} catch {
			return null;
		}
	};
	const call = notionCall(input, { readOutbox, runtimePaths: [] });
	if (call === null) {
		debug("validate: not a Notion write in the outbox form");
		return [];
	}
	const notion = lazyNotion();
	try {
		const map = readNotionMap(notionMapPath(vaultRoot));
		return call.outcome === "done" ? await checkWrite(notion, call, map, vaultRoot) : [await addSelectOptions(notion, call, map)];
	} catch (error) {
		debug(`validate: ${call.tool} — check failed: ${causeOf(error)}`);
		return call.outcome === "done" ? [{ blocks: [`⚠️  The write check did not run for ${call.tool} (${causeOf(error)}).`], policyResults: [] }] : [];
	} finally {
		// A payload file is not a note. After a failed write it stays, so the same command can run again.
		if (call.outcome === "done") rmSync(outboxPath(call.outbox), { force: true });
		await notion.close();
	}
}
