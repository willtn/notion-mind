/**
 * Pure parsers from a Notion MCP reply to the types that the setup and the
 * hooks read. Each parser throws a `NotionError` when the reply does not
 * have the measured shape, so a format change fails at this boundary and
 * not in a caller.
 *
 * The shapes come from live replies of the hosted Notion MCP server. The
 * tests hold one captured reply for each parser.
 */

import { NotionError, type NotionReply } from "./notion-client.ts";

export interface LiveProperty {
	readonly name: string;
	readonly type: string;
	readonly options: readonly { readonly name: string; readonly color: string }[];
	/** The `collection://` URL of the related data source, for a relation. */
	readonly target: string | undefined;
}

export interface LiveFilter {
	readonly property: string;
	readonly operator: string;
	readonly value: unknown;
}

export interface LiveView {
	readonly url: string;
	readonly name: string;
	readonly type: string;
	/** The leaf filters, with groups flattened. */
	readonly filters: readonly LiveFilter[];
	readonly sorts: readonly { readonly property: string; readonly direction: string }[];
	readonly groupBy: string | undefined;
}

export interface LiveDatabase {
	readonly id: string;
	readonly url: string;
	readonly title: string;
	readonly inTrash: boolean;
	readonly dataSource: string;
	readonly properties: Readonly<Record<string, LiveProperty>>;
	readonly views: readonly LiveView[];
}

export type ChildKind = "page" | "database" | "linked_view";

export interface LiveChild {
	readonly kind: ChildKind;
	readonly id: string;
	readonly url: string;
	readonly title: string;
	readonly dataSource: string | undefined;
}

export interface LivePage {
	readonly id: string;
	readonly url: string;
	readonly title: string;
	readonly inTrash: boolean;
	readonly content: string;
	readonly children: readonly LiveChild[];
}

export interface PageRef {
	readonly id: string;
	readonly url: string;
	readonly title: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const bad = (what: string, text: string): NotionError =>
	new NotionError("tool_error", `Notion sent ${what} in a form that this code does not know: ${text.slice(0, 200)}`);

const str = (value: unknown): string => (typeof value === "string" ? value : "");

/** The 32 hexadecimal characters of a Notion URL or ID, as a UUID with hyphens. */
export function notionId(urlOrId: string): string {
	const hex = urlOrId.replace(/[?#].*$/, "").replace(/-/g, "").match(/[0-9a-f]{32}(?![0-9a-f])/gi)?.at(-1);
	if (hex === undefined) throw bad("an ID", urlOrId);
	const h = hex.toLowerCase();
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** The Markdown-like body: `text` of a fetch reply, `result` of a create or update reply. */
function body(reply: NotionReply): string {
	if (isRecord(reply.json)) {
		if (typeof reply.json["text"] === "string") return reply.json["text"];
		if (typeof reply.json["result"] === "string") return reply.json["result"];
	}
	return reply.text;
}

function parseProperty(name: string, raw: unknown): LiveProperty {
	const record = isRecord(raw) ? raw : {};
	const options = Array.isArray(record["options"])
		? record["options"].filter(isRecord).map((o) => ({ name: str(o["name"]), color: str(o["color"]) || "default" }))
		: [];
	const target = str(record["dataSourceUrl"]);
	return { name, type: str(record["type"]), options, target: target === "" ? undefined : target };
}

function flattenFilters(node: unknown): LiveFilter[] {
	if (!isRecord(node)) return [];
	if (Array.isArray(node["filters"])) return node["filters"].flatMap(flattenFilters);
	// A filter on a formula holds the real test in `resultFilter`.
	const leaf = isRecord(node["resultFilter"]) ? node["resultFilter"] : node;
	const value = isRecord(leaf["value"]) ? leaf["value"]["value"] : undefined;
	return [{ property: str(node["property"]), operator: str(leaf["operator"]), value }];
}

function parseViewConfig(url: string, json: string): LiveView {
	let config: unknown;
	try {
		config = JSON.parse(json);
	} catch {
		throw bad("a view", json);
	}
	if (!isRecord(config)) throw bad("a view", json);
	const sorts = Array.isArray(config["sorts"])
		? config["sorts"].filter(isRecord).map((s) => ({ property: str(s["property"]), direction: str(s["direction"]) }))
		: [];
	const groupBy = isRecord(config["groupBy"]) ? str(config["groupBy"]["property"]) : "";
	return {
		url,
		name: str(config["name"]),
		type: str(config["type"]),
		filters: flattenFilters(config["advancedFilter"]),
		sorts,
		groupBy: groupBy === "" ? undefined : groupBy,
	};
}

/** Each `<view url="view://…">` block of a database, a view fetch, or a `notion-create-view` reply. */
export function parseViews(reply: NotionReply): LiveView[] {
	const views: LiveView[] = [];
	for (const match of body(reply).matchAll(/<view url="(view:\/\/[0-9a-f-]{36})">\n([\s\S]*?)\n<\/view>/g)) {
		views.push(parseViewConfig(match[1] ?? "", match[2] ?? ""));
	}
	return views;
}

/** A database from `notion-fetch`, `notion-create-database`, or `notion-update-data-source`. */
export function parseDatabase(reply: NotionReply): LiveDatabase {
	const text = body(reply);
	const tag = text.match(/<database url="([^"]+)"[^>]*?( deleted)?>/);
	const state = text.match(/<data-source-state>\n([\s\S]*?)\n<\/data-source-state>/)?.[1];
	const dataSource = text.match(/<data-source url="(collection:\/\/[0-9a-f-]{36})"/)?.[1];
	if (tag === null || state === undefined || dataSource === undefined) throw bad("a database", text);
	let schema: unknown;
	try {
		schema = JSON.parse(state);
	} catch {
		throw bad("a data source state", state);
	}
	const rawProperties = isRecord(schema) && isRecord(schema["schema"]) ? schema["schema"] : {};
	const properties: Record<string, LiveProperty> = {};
	for (const [name, raw] of Object.entries(rawProperties)) properties[name] = parseProperty(name, raw);
	const url = (tag[1] ?? "").replace(/\?.*$/, "");
	return {
		id: notionId(url),
		url,
		title: text.match(/The title of this Database is: (.*)/)?.[1] ?? "",
		inTrash: tag[2] !== undefined,
		dataSource,
		properties,
		views: parseViews(reply),
	};
}

function parseChildren(content: string): LiveChild[] {
	const children: LiveChild[] = [];
	const pattern = /<(page|database) url="([^"]+)"([^>]*)>\n?([^<]*?)\n?<\/\1>/g;
	for (const match of content.matchAll(pattern)) {
		const url = match[2] ?? "";
		const attributes = match[3] ?? "";
		const dataSource = attributes.match(/data-source-url="(collection:\/\/[0-9a-f-]{36})"/)?.[1];
		const inline = /inline="true"/.test(attributes);
		const kind: ChildKind = match[1] === "page" ? "page" : inline ? "linked_view" : "database";
		children.push({ kind, id: notionId(url), url, title: (match[4] ?? "").trim(), dataSource });
	}
	return children;
}

/** A page from `notion-fetch`, with the child pages, databases, and linked views of its content. */
export function parsePage(reply: NotionReply): LivePage {
	const text = body(reply);
	const tag = text.match(/<page url="([^"]+)"( deleted)?>/);
	const content = text.match(/<content>\n?([\s\S]*)\n?<\/content>/)?.[1];
	if (tag === null) throw bad("a page", text);
	const url = (tag[1] ?? "").replace(/\?.*$/, "");
	return {
		id: notionId(url),
		url,
		title: isRecord(reply.json) ? str(reply.json["title"]) : "",
		inTrash: tag[2] !== undefined,
		content: content ?? "",
		children: parseChildren(content ?? ""),
	};
}

function refs(list: unknown, what: string, text: string): PageRef[] {
	if (!Array.isArray(list)) throw bad(what, text);
	return list.filter(isRecord).map((item) => {
		const url = str(item["url"]).replace(/\?.*$/, "");
		const properties = isRecord(item["properties"]) ? item["properties"] : {};
		const title = str(item["title"]) || str(properties["title"]) || str(properties["Name"]) || str(item["Name"]);
		return { id: str(item["id"]) || notionId(url), url, title };
	});
}

/** The pages that a synchronous `notion-create-pages` call made, in request order. */
export function parseCreatedPages(reply: NotionReply): PageRef[] {
	return refs(isRecord(reply.json) ? reply.json["pages"] : undefined, "created pages", reply.text);
}

/** One page of a `notion-query-data-sources` result. A row is the raw record, with `Name` and `url`. */
export function parseRows(reply: NotionReply): { rows: Record<string, unknown>[]; nextCursor: string | undefined } {
	if (!isRecord(reply.json) || !Array.isArray(reply.json["results"])) throw bad("query rows", reply.text);
	const more = reply.json["has_more"] === true ? str(reply.json["next_cursor"]) : "";
	return { rows: reply.json["results"].filter(isRecord), nextCursor: more === "" ? undefined : more };
}

/** One page of `notion-list-private-pages`: the top-level private pages of the login. */
export function parsePrivatePages(reply: NotionReply): { pages: PageRef[]; nextCursor: string | undefined } {
	if (!isRecord(reply.json)) throw bad("private pages", reply.text);
	const cursor = str(reply.json["nextCursor"]);
	return { pages: refs(reply.json["results"], "private pages", reply.text), nextCursor: cursor === "" ? undefined : cursor };
}

/** The workspace ID of `notion-get-self`. */
export function parseWorkspaceId(reply: NotionReply): string {
	const workspace = isRecord(reply.json) ? reply.json["workspace"] : undefined;
	if (!isRecord(workspace) || typeof workspace["id"] !== "string") throw bad("the workspace", reply.text);
	return workspace["id"];
}
