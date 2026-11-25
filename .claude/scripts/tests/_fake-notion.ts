/**
 * A stand-in for the `mcporter` runtime, for a hook process in a test. The
 * hook finds it as it finds the real one: an `mcporter` file on `PATH`
 * with `index.js` beside it. Each call goes into a file, and the reply
 * comes from a table.
 *
 *     const fake = fakeNotion(dir, { "notion-update-page": '{"result":"ok"}' });
 *     runScript(HOOK, payload, fake.env);
 *     fake.calls()   // [{ tool: "notion-update-page", args: { … } }]
 *
 * The live proof of a hook is the parity run on the real workspace.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { NotionMap } from "../lib/notion-map.ts";
import { DATABASES } from "../lib/notion-model.ts";
import { LOOSE_ACTIVE_VIEW } from "../lib/write-check.ts";

/**
 * The reply of each tool: the text of the reply, or `{ error }` for a tool
 * error. A table by ID answers a `notion-fetch` call. A tool that the
 * table does not hold fails, so a test sees each call that it did not plan.
 */
export type FakeReplies = Readonly<Record<string, string | { readonly error: string } | { readonly byId: Readonly<Record<string, string>> }>>;

export interface FakeCall {
	readonly tool: string;
	readonly args: Readonly<Record<string, unknown>>;
}

export interface FakeNotion {
	/** The variables of the hook process. */
	readonly env: Record<string, string>;
	readonly calls: () => FakeCall[];
}

const RUNTIME = `
const { appendFileSync, readFileSync } = require("node:fs");
const result = (text, isError) => ({ content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) });
exports.createRuntime = async () => ({
	listServers: () => ["notion"],
	callTool: async (_server, tool, { args }) => {
		appendFileSync(process.env.FAKE_NOTION_CALLS, JSON.stringify({ tool, args }) + "\\n");
		const reply = JSON.parse(readFileSync(process.env.FAKE_NOTION_REPLIES, "utf-8"))[tool];
		if (reply === undefined) return result(JSON.stringify({ code: "not_planned", message: "the test has no reply for " + tool }), true);
		if (typeof reply === "string") return result(reply);
		if (typeof reply.error === "string") return result(reply.error, true);
		const text = reply.byId[String(args.id ?? args.page_id).replace(/-/g, "")];
		return text === undefined ? result(JSON.stringify({ code: "object_not_found", message: "no page" }), true) : result(text);
	},
	close: async () => {},
});
`;

export function fakeNotion(dir: string, replies: FakeReplies): FakeNotion {
	const bin = join(dir, "bin");
	mkdirSync(bin, { recursive: true });
	writeFileSync(join(bin, "mcporter"), "");
	writeFileSync(join(bin, "index.js"), RUNTIME);
	const repliesFile = join(dir, "replies.json");
	const callsFile = join(dir, "calls.jsonl");
	const byBareId = (table: Readonly<Record<string, string>>): Record<string, string> => Object.fromEntries(Object.entries(table).map(([id, text]) => [id.replace(/-/g, ""), text]));
	writeFileSync(repliesFile, JSON.stringify(Object.fromEntries(Object.entries(replies).map(([tool, reply]) => [tool, typeof reply === "object" && "byId" in reply ? { byId: byBareId(reply.byId) } : reply]))));
	return {
		env: { PATH: bin, FAKE_NOTION_REPLIES: repliesFile, FAKE_NOTION_CALLS: callsFile },
		calls: () =>
			existsSync(callsFile)
				? readFileSync(callsFile, "utf-8")
						.split("\n")
						.filter((line) => line !== "")
						.map((line) => JSON.parse(line) as FakeCall)
				: [],
	};
}

export const fakeUrl = (id: string): string => `https://app.notion.com/p/${id.replace(/-/g, "")}`;

/** A map file with made-up IDs, and the source of more IDs of the same kind. */
export function fakeMap(): { readonly map: NotionMap; readonly nextId: () => string } {
	let serial = 0;
	const nextId = (): string => `00000000-0000-4000-8000-${String(++serial).padStart(12, "0")}`;
	const ref = (title: string) => {
		const id = nextId();
		return { id, url: fakeUrl(id), title, views: {} };
	};
	const map = {
		version: 1,
		workspace_id: "offline",
		root: ref("offline root"),
		databases: Object.fromEntries(
			DATABASES.map((database) => [database.key, { ...ref(database.title), data_source: `collection://${nextId()}`, views: { [LOOSE_ACTIVE_VIEW]: `view://${nextId()}` } }]),
		),
		pages: { home: ref("Home"), north_star: ref("North Star") },
		templates: {},
	} as unknown as NotionMap;
	return { map, nextId };
}

/**
 * The reply of `notion-fetch` for a page, in the shape of a live reply
 * (measured on a row of the Work database, on a page under the root, and on
 * a page under a page). `rowOf` is the database of a row. `under` has the
 * page above the page and each page above that one, nearest first. Only a
 * row has an `<ancestor-path>`. Each page has the `path` field, which has
 * titles and no IDs, and a top-level page has none.
 */
export function fetchedPage(page: {
	readonly id: string;
	readonly title: string;
	readonly properties: Readonly<Record<string, unknown>>;
	readonly content: string;
	readonly rowOf?: { readonly id: string; readonly data_source: string; readonly title: string };
	readonly under: readonly { readonly id: string; readonly title: string }[];
}): string {
	const url = fakeUrl(page.id);
	const above = page.rowOf === undefined ? [] : [{ id: page.rowOf.id, title: page.rowOf.title, kind: "database" }, ...page.under.map((entry) => ({ ...entry, kind: "page" }))];
	const path =
		page.rowOf === undefined
			? []
			: [
					`<parent-data-source url="${page.rowOf.data_source}" name="${page.rowOf.title}"/>`,
					...above.map((entry, index) => `<ancestor-${index + 2}-${entry.kind} url="${fakeUrl(entry.id)}" title="${entry.title}"/>`),
				];
	const titles = [...page.under.map((entry) => entry.title).reverse(), ...(page.rowOf === undefined ? [] : [page.rowOf.title])];
	const text = [
		`Here is the result of "fetch" for the Page with URL ${url} as of 2026-11-25T15:22:02.605Z:`,
		`<page url="${url}">`,
		"<ancestor-path>",
		...path,
		"</ancestor-path>",
		"<properties>",
		JSON.stringify(page.properties),
		"</properties>",
		"<iconMetadata>null</iconMetadata>",
		"<content>",
		page.content,
		"</content>",
		"</page>",
	].join("\n");
	return JSON.stringify({ metadata: { type: "page" }, title: page.title, url: `${url}?pvs=204`, text, ...(titles.length === 0 ? {} : { path: titles.join(" / ") }) });
}
