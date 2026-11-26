/**
 * Notion in memory for the tests of the import run. It keeps the databases
 * of the model with their columns and select options, the rows, and the
 * pages of the setup, and it answers each tool that the import calls. It
 * stores a written body in the measured ways of the live runs: a mention
 * gets the title of its page, bold and code become tags, and the lines of
 * one paragraph join with `<br />`. `failAfter` makes a write fail at a
 * chosen point, as a crash or a lost connection does.
 */

import assert from "node:assert/strict";
import { NotionError, type NotionClient, type NotionReply } from "../lib/notion-client.ts";
import type { NotionMap } from "../lib/notion-map.ts";
import { DATABASES, PAGES, type DatabaseKey, type PageKey } from "../lib/notion-model.ts";

export interface MemoryPage {
	readonly id: string;
	readonly title: string;
	readonly database: DatabaseKey | undefined;
	properties: Record<string, unknown>;
	content: string;
}

export interface MemoryCall {
	readonly tool: string;
	readonly args: Readonly<Record<string, unknown>>;
}

const WRITE_TOOLS: readonly string[] = ["notion-create-pages", "notion-update-page", "notion-update-data-source"];
const BLOCK = /^\s*(#{1,6} |[-*+] |\d+\. |>|\||```|<)/;
const SYNCED = /<synced-block url="([^"]+)">\n([\s\S]*?)\n<\/synced-block>/;
const REFERENCE = /(<synced-block-reference url="[^"]+">)\n?([\s\S]*?)\n?(<\/synced-block-reference>)/;

export const isWrite = (call: MemoryCall): boolean => WRITE_TOOLS.includes(call.tool);

export function memoryNotion(options: { readonly rootTitle?: string; readonly pageSize?: number } = {}) {
	let serial = 0;
	const nextId = (): string => `00000000-0000-4000-8000-${(++serial).toString(16).padStart(12, "0")}`;
	const urlOf = (id: string): string => `https://app.notion.com/p/${id.replace(/-/g, "")}`;
	const pages = new Map<string, MemoryPage>();
	const add = (title: string, database: DatabaseKey | undefined, content = "", properties: Record<string, unknown> = {}): MemoryPage => {
		const page: MemoryPage = { id: nextId(), title, database, properties, content };
		pages.set(page.id, page);
		return page;
	};

	const root = add(options.rootTitle ?? "obsidian-mind import test", undefined);
	const databaseIds = Object.fromEntries(DATABASES.map((spec) => [spec.key, nextId()])) as Record<DatabaseKey, string>;
	const columns = Object.fromEntries(
		DATABASES.map((spec) => [
			spec.key,
			Object.fromEntries(Object.entries(spec.properties).map(([name, property]) => [name, { type: property.type, options: "options" in property ? [...property.options] : [] }])),
		]),
	) as Record<DatabaseKey, Record<string, { type: string; options: string[] }>>;

	const northStar = add("North Star", undefined);
	const blockUrl = `${urlOf(northStar.id)}#${"b".repeat(32)}`;
	northStar.content = `Old text.\n\n## Current Focus\n\n<synced-block url="${blockUrl}">\n- Old focus.\n</synced-block>\n`;
	const linkedView = `<database url="${urlOf(nextId())}" data-source-url="collection://${databaseIds.work}" inline="true"></database>`;
	const home = add(
		"Home",
		undefined,
		`## Current Focus\n\n<synced-block-reference url="${blockUrl}">\n- Old focus.\n</synced-block-reference>\n\n## Open Questions\n\nOld question.\n\n## Quick Links\n\n- [North Star](${urlOf(northStar.id)})\n\n${linkedView}\n`,
	);
	const setupPages: Partial<Record<PageKey, MemoryPage>> = { north_star: northStar, home };
	for (const spec of PAGES) {
		if (setupPages[spec.key] !== undefined) continue;
		setupPages[spec.key] = spec.parent === "root" ? add(spec.title, undefined, "Setup text.\n") : add(spec.title, spec.parent, "Setup text.\n", { ...spec.properties });
	}
	const readerMap = add("Reader map", undefined, "The setup fills this page.\n");
	const template = add("Work Note", "templates", "# {{title}}\n");

	const map = {
		version: 1,
		workspace_id: "workspace-1",
		root: { id: root.id, url: urlOf(root.id), title: root.title },
		databases: Object.fromEntries(
			DATABASES.map((spec) => [spec.key, { id: databaseIds[spec.key], url: urlOf(databaseIds[spec.key]), title: spec.title, data_source: `collection://${databaseIds[spec.key]}`, views: { "Recently changed": `view://${spec.key}` } }]),
		),
		pages: {
			...Object.fromEntries(Object.entries(setupPages).map(([key, page]) => [key, { id: page.id, url: urlOf(page.id), title: page.title, views: {} }])),
			reader_map: { id: readerMap.id, url: urlOf(readerMap.id), title: readerMap.title, views: {} },
		},
		templates: { "Work Note": { id: template.id, url: urlOf(template.id) } },
	} as unknown as NotionMap;

	const titleOfUrl = (url: string): string => [...pages.values()].find((page) => urlOf(page.id) === url)?.title ?? "";
	const stored = (content: string): string => {
		const out: string[] = [];
		let fence = false;
		let proseAbove = false;
		for (const line of content.split("\n")) {
			if (line.startsWith("```")) fence = !fence;
			if (fence || line.startsWith("```")) {
				out.push(line);
				proseAbove = false;
				continue;
			}
			const text = line
				.replace(/<mention url="([^"]+)">[^<]*<\/mention>/g, (_, url: string) => `<mention url="${url}">${titleOfUrl(url)}</mention>`)
				.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
				.replace(/`([^`]+)`/g, "<code>$1</code>");
			const prose = text !== "" && !BLOCK.test(text);
			if (prose && proseAbove) out[out.length - 1] += `<br />${text}`;
			else out.push(text);
			proseAbove = prose;
		}
		return out.join("\n");
	};
	const syncFrom = (edited: MemoryPage): void => {
		const text = edited.content.match(SYNCED)?.[2] ?? edited.content.match(REFERENCE)?.[2];
		if (text === undefined) return;
		for (const page of pages.values()) {
			page.content = page.content.replace(SYNCED, (_, url: string) => `<synced-block url="${url}">\n${text}\n</synced-block>`).replace(REFERENCE, (_, open: string, __: string, close: string) => `${open}\n${text}\n${close}`);
		}
	};

	const reply = (json: unknown): NotionReply => ({ text: JSON.stringify(json), json });
	const keyOfDataSource = (url: unknown): DatabaseKey => (Object.keys(databaseIds) as DatabaseKey[]).find((key) => `collection://${databaseIds[key]}` === url) ?? assert.fail(`no data source ${String(url)}`);
	const fetch = (id: string): NotionReply => {
		const key = (Object.keys(databaseIds) as DatabaseKey[]).find((candidate) => databaseIds[candidate] === id);
		if (key !== undefined) {
			const schema = { schema: Object.fromEntries(Object.entries(columns[key]).map(([name, column]) => [name, { type: column.type, options: column.options.map((option) => ({ name: option, color: "gray" })) }])) };
			return reply({ text: `<database url="${urlOf(id)}">\nThe title of this Database is: ${key}\n<data-source url="collection://${id}">\n<data-source-state>\n${JSON.stringify(schema)}\n</data-source-state>\n</data-source>\n</database>` });
		}
		const page = pages.get(id) ?? assert.fail(`no page ${id}`);
		const path = page.database === undefined ? "" : `<parent-data-source url="collection://${databaseIds[page.database]}" name="${page.database}"/>`;
		return reply({ title: page.title, text: `<page url="${urlOf(page.id)}">\n<ancestor-path>\n${path}\n</ancestor-path>\n<properties>\n${JSON.stringify(page.properties)}\n</properties>\n<content>\n${page.content}\n</content>\n</page>` });
	};
	const setProperties = (page: MemoryPage, properties: Readonly<Record<string, unknown>>): void => {
		for (const [name, value] of Object.entries(properties)) {
			const column = page.database === undefined ? undefined : columns[page.database][name.replace(/^date:(.*):(start|is_datetime)$/, "$1")];
			if (page.database !== undefined && column === undefined && name !== "Name") throw new NotionError("tool_error", `No property "${name}"`);
			const items = Array.isArray(value) ? (value as string[]) : typeof value === "string" ? [value] : [];
			if ((column?.type === "select" || column?.type === "multi_select") && items.some((item) => !column.options.includes(item))) {
				throw new NotionError("tool_error", `Invalid select value for property "${name}": "${items.join(", ")}"`);
			}
			if (value === null) delete page.properties[name];
			else page.properties[name] = Array.isArray(value) ? JSON.stringify(value.map((item: string) => (pages.has(item) ? urlOf(item) : item))) : value;
		}
		// An empty date and a box that is not set read the same as a property with no value.
		for (const [name, value] of Object.entries(page.properties)) {
			const date = name.match(/^date:(.*):is_datetime$/)?.[1];
			if (value === "__NO__" || (date !== undefined && page.properties[`date:${date}:start`] === undefined)) delete page.properties[name];
		}
	};

	const calls: MemoryCall[] = [];
	let failAt = Number.POSITIVE_INFINITY;
	const client: NotionClient = {
		close: async () => {},
		call: async (tool, args = {}) => {
			const call = { tool, args };
			if (isWrite(call) && calls.filter(isWrite).length >= failAt) throw new NotionError("transport", `${tool} failed before a reply: the test stops the run here`, tool);
			calls.push(call);
			switch (tool) {
				case "notion-get-self":
					return reply({ workspace: { id: "workspace-1" } });
				case "notion-fetch":
					return fetch(String(args["id"]));
				case "notion-query-data-sources": {
					const data = args["data"] as { view_url: string; page_size: number; start_cursor?: string };
					const key = data.view_url.replace("view://", "") as DatabaseKey;
					const rows = [...pages.values()].filter((page) => page.database === key).map((page) => ({ ...page.properties, Name: page.title, url: urlOf(page.id) }));
					const size = Math.min(data.page_size, options.pageSize ?? data.page_size);
					const start = Number(data.start_cursor ?? 0);
					const more = start + size < rows.length;
					return reply({ results: rows.slice(start, start + size), has_more: more, ...(more ? { next_cursor: String(start + size) } : {}) });
				}
				case "notion-update-data-source": {
					const key = keyOfDataSource(args["data_source_id"]);
					for (const statement of String(args["statements"]).split(/; (?=ADD|ALTER)/)) {
						const added = statement.match(/^ADD COLUMN "([^"]+)" RICH_TEXT$/);
						const altered = statement.match(/^ALTER COLUMN "([^"]+)" SET (?:MULTI_)?SELECT\((.*)\)$/);
						if (added !== null) columns[key][added[1] ?? ""] = { type: "text", options: [] };
						else if (altered !== null) (columns[key][altered[1] ?? ""] ?? assert.fail(`no column ${altered[1]}`)).options = [...(altered[2] ?? "").matchAll(/'([^']+)':/g)].map((match) => match[1] ?? "");
						else assert.fail(`the model cannot run: ${statement}`);
					}
					return reply({});
				}
				case "notion-create-pages": {
					const key = keyOfDataSource((args["parent"] as { data_source_id?: string }).data_source_id);
					const made = (args["pages"] as { properties: Record<string, string> }[]).map((entry) => {
						const { Name: name = "", ...rest } = entry.properties;
						const page = add(name, key);
						setProperties(page, rest);
						return page;
					});
					return reply({ pages: made.map((page) => ({ id: page.id, url: urlOf(page.id), properties: { title: page.title } })) });
				}
				case "notion-update-page": {
					const page = pages.get(String(args["page_id"])) ?? assert.fail("unknown page");
					if (args["command"] === "replace_content") page.content = stored(String(args["new_str"]));
					else if (args["command"] === "update_content") {
						for (const { old_str: old, new_str: replacement } of args["content_updates"] as { old_str: string; new_str: string }[]) {
							if (!page.content.includes(old)) throw new NotionError("tool_error", "old_str matches nothing");
							page.content = stored(page.content.replace(old, replacement));
						}
					} else if (args["command"] === "insert_content") page.content = stored(`${page.content.trimEnd()}\n\n${String(args["content"])}`);
					else setProperties(page, args["properties"] as Record<string, unknown>);
					if (args["command"] !== "update_properties") syncFrom(page);
					page.properties["Last edited"] = new Date().toISOString();
					return reply({ page_id: page.id });
				}
				default:
					throw new NotionError("tool_error", `the model has no tool ${tool}`);
			}
		},
	};

	return {
		client,
		map,
		calls,
		pages,
		columns,
		setupPages: setupPages as Record<PageKey, MemoryPage>,
		/** Rows of the database `key`, by title. */
		rowsOf: (key: DatabaseKey): MemoryPage[] => [...pages.values()].filter((page) => page.database === key),
		row: (title: string): MemoryPage => [...pages.values()].find((page) => page.database !== undefined && page.title === title) ?? assert.fail(`no row ${title}`),
		urlOf,
		/** From now, the write after `writes` more writes fails. */
		failAfter: (writes: number): void => {
			failAt = calls.filter(isWrite).length + writes;
		},
		heal: (): void => {
			failAt = Number.POSITIVE_INFINITY;
		},
		/** A row that another run made, for example the row of a note that the vault no longer has. */
		addRow: (key: DatabaseKey, title: string, properties: Record<string, unknown>): MemoryPage => add(title, key, "", properties),
	};
}
