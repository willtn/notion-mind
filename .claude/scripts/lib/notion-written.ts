/**
 * From the hook payload of a `Bash` call to the notes that the call wrote.
 *
 *     const call = notionCall(payload, host);           // the outbox form of lib/notion-write.ts
 *     if (call?.outcome === "done") {
 *       const notes = await writtenNotes(call, map, fetchPage);
 *     }
 *
 * Each written page is fetched one time, for a create and for an update, so
 * the note is the body as Notion stores it and not the text of the outbox
 * file.
 */

import type { NotionMap } from "./notion-map.ts";
import type { DatabaseKey } from "./notion-model.ts";
import { DERIVED_PROPERTIES, type Place, type WrittenNote } from "./notion-note.ts";
import { notionId, type Ancestors, type NotePage } from "./notion-parse.ts";
import { parseCommand, type Host, type JsonObject } from "./notion-write.ts";

/** A Notion write in the outbox form, and how the shell call ended. */
export interface NotionCall {
	readonly tool: string;
	readonly args: JsonObject;
	readonly outbox: string;
	/** `done` has the reply of the tool. `failed` has the error text of the shell. */
	readonly outcome: "done" | "failed";
	readonly reply: unknown;
	readonly error: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

/**
 * The Notion write of a `PostToolUse` or `PostToolUseFailure` payload of
 * `Bash`, or `null` for each other payload. Claude Code sends `PostToolUse`
 * only for a command that ended with status 0, and `mcporter` ends with
 * status 1 for a tool error (measured), so a reply is a done write.
 */
export function notionCall(payload: unknown, host: Host): NotionCall | null {
	if (!isRecord(payload) || payload["tool_name"] !== "Bash") return null;
	const input = payload["tool_input"];
	const command = isRecord(input) ? input["command"] : undefined;
	if (typeof command !== "string") return null;
	const parsed = parseCommand(command, host);
	if (parsed.kind !== "write") return null;

	const call = { tool: parsed.tool, args: parsed.args, outbox: parsed.outbox };
	const response = payload["tool_response"];
	if (isRecord(response) && typeof response["stdout"] === "string" && response["interrupted"] !== true) {
		return { ...call, outcome: "done", reply: parseJson(response["stdout"]), error: "" };
	}
	return { ...call, outcome: "failed", reply: undefined, error: typeof payload["error"] === "string" ? payload["error"] : "" };
}

const sameId = (a: string, b: string): boolean => {
	try {
		return notionId(a) === notionId(b);
	} catch {
		return false;
	}
};

const databaseOf = (map: NotionMap, matches: (database: NotionMap["databases"][DatabaseKey]) => boolean): DatabaseKey | undefined =>
	(Object.keys(map.databases) as DatabaseKey[]).find((key) => matches(map.databases[key]));

/** The place of a fetched page. */
export function placeOf(page: Pick<NotePage, "id">, ancestors: Ancestors, map: NotionMap): Place {
	const dataSource = ancestors.dataSource;
	const database = dataSource === undefined ? undefined : databaseOf(map, (entry) => sameId(entry.data_source, dataSource));
	if (database !== undefined) return { kind: "row", database };
	if (!ancestors.ids.some((id) => sameId(id, map.root.id))) return { kind: "outside" };
	return Object.values(map.pages).some((entry) => sameId(entry.id, page.id)) ? { kind: "scaffold" } : { kind: "page" };
}

/** The place of a new page from the `parent` argument, or `null` when only a fetch can tell. */
function placeOfParent(parent: unknown, map: NotionMap): Place | null {
	if (!isRecord(parent)) return { kind: "outside" };
	const { data_source_id: dataSource, database_id: databaseId, page_id: pageId } = parent;
	const database =
		typeof dataSource === "string"
			? databaseOf(map, (entry) => sameId(entry.data_source, dataSource))
			: typeof databaseId === "string"
				? databaseOf(map, (entry) => sameId(entry.id, databaseId))
				: undefined;
	if (database !== undefined) return { kind: "row", database };
	if (typeof pageId !== "string") return { kind: "outside" };
	const known = [map.root, ...Object.values(map.pages)].some((entry) => sameId(entry.id, pageId));
	return known ? { kind: "page" } : null;
}

/** The place that a create call or an update call writes to, or `null` for each other tool and for a parent that the map does not name. */
export async function targetPlace(call: NotionCall, map: NotionMap, fetchPage: (id: string) => Promise<NotePage>): Promise<Place | null> {
	if (call.tool === "notion-create-pages") return placeOfParent(call.args["parent"], map);
	const id = call.args["page_id"];
	if (call.tool !== "notion-update-page" || typeof id !== "string") return null;
	const page = await fetchPage(id);
	return placeOf(page, page.ancestors, map);
}

/**
 * Fetched content in the form that a write sends. Notion returns a line
 * break in a paragraph as `<br />`, and it puts a backslash before a
 * character that Markdown reads as syntax. The content ends with one line
 * break, as a Markdown file does (measured on three rows of the fixture).
 */
export const writtenForm = (content: string): string => content.replace(/<br\s*\/?>/g, "\n").replace(/\\([!-/:-@[-`{-~])/g, "$1");

const CONTENT_COMMANDS: readonly string[] = ["update_content", "replace_content", "insert_content", "apply_template"];

/** True when an update call changes the body, or a property that the write hook does not derive. */
function changesNote(args: JsonObject): boolean {
	if (CONTENT_COMMANDS.includes(String(args["command"]))) return true;
	const properties = isRecord(args["properties"]) ? Object.keys(args["properties"]) : [];
	return properties.some((name) => !DERIVED_PROPERTIES.some((derived) => name === derived || name.startsWith(`date:${derived}:`)));
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/**
 * The note of a fetched page. Every note that the hook checks comes from
 * here, so a create and an update of one note give the same size, the same
 * counts, and the same findings. The outbox content of a create is not
 * the stored body: Notion moves a leading `# <title>` into the title,
 * changes `**bold**` to `<b>`, and changes `*` bullets to `-` (measured).
 */
function noteOfPage(page: NotePage, map: NotionMap, changed: boolean): WrittenNote {
	const { id, url, title, properties } = page;
	return { id, url, title, place: placeOf(page, page.ancestors, map), properties, body: writtenForm(page.content), changed };
}

/** The notes of a done write. A tool that writes no note content gives none. */
export async function writtenNotes(call: NotionCall, map: NotionMap, fetchPage: (id: string) => Promise<NotePage>): Promise<WrittenNote[]> {
	if (call.tool === "notion-update-page") {
		const id = text(call.args["page_id"]);
		if (id === "") return [];
		return [noteOfPage(await fetchPage(id), map, changesNote(call.args))];
	}
	if (call.tool !== "notion-create-pages") return [];

	const requested = Array.isArray(call.args["pages"]) ? call.args["pages"].filter(isRecord) : [];
	const made = isRecord(call.reply) && Array.isArray(call.reply["pages"]) ? call.reply["pages"].filter(isRecord) : [];
	if (made.length !== requested.length) throw new Error(`The reply of notion-create-pages names ${made.length} pages for ${requested.length} pages of ${call.outbox}.`);
	return Promise.all(made.map(async (reply) => noteOfPage(await fetchPage(text(reply["id"]) || text(reply["url"])), map, true)));
}

/** The values that a create call puts in each select and multi-select of `properties`, for `ensureSelectOptions`. */
export function selectValues(call: NotionCall, selects: readonly string[]): Record<string, string[]> {
	const pages = call.tool === "notion-create-pages" && Array.isArray(call.args["pages"]) ? call.args["pages"].filter(isRecord) : [call.args];
	const wanted: Record<string, string[]> = {};
	for (const page of pages) {
		const properties = isRecord(page["properties"]) ? page["properties"] : {};
		for (const name of selects) {
			const raw = properties[name];
			const list = typeof raw === "string" && raw.startsWith("[") ? parseJson(raw) : raw;
			const values = (Array.isArray(list) ? list : [list]).filter((value): value is string => typeof value === "string" && value !== "");
			if (values.length > 0) wanted[name] = [...new Set([...(wanted[name] ?? []), ...values])];
		}
	}
	return wanted;
}
