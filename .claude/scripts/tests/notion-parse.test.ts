/**
 * lib/notion-parse.ts: each parser on a reply captured from the hosted
 * Notion MCP server. The IDs are replaced, and long schemas are cut down.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { classifyReply, NotionError, type NotionReply } from "../lib/notion-client.ts";
import { notionId, parseCreatedPages, parseDatabase, parsePage, parsePrivatePages, parseRows, parseViews, parseWorkspaceId } from "../lib/notion-parse.ts";

const DB = "aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa";
const DS = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PAGE = "cccccccccccc4ccc8ccccccccccccccc";
const VIEW = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

/** A reply as the client returns it, from the raw text of the server. */
function reply(raw: string): NotionReply {
	const outcome = classifyReply({ content: [{ type: "text", text: raw }] });
	assert.equal(outcome.kind, "ok");
	return outcome.kind === "ok" ? outcome.reply : { text: "", json: undefined };
}

const DATABASE_TEXT = [
	`<database url="{{https://app.notion.com/p/${DB}}}" inline="false">`,
	"The title of this Database is: Work",
	"<data-sources>",
	`<data-source url="{{collection://${DS}}}">`,
	"<data-source-state>",
	JSON.stringify({
		name: "Work",
		schema: {
			Name: { name: "Name", type: "title" },
			Status: { name: "Status", type: "select", options: [{ name: "active", color: "green" }, { name: "completed", color: "gray" }] },
			Team: { name: "Team", type: "relation", dataSourceUrl: `collection://${DS}` },
			Stale: { name: "Stale", type: "formula", codeUrl: "formulaCode://x/y" },
		},
	}),
	"</data-source-state>",
	"</data-source>",
	"</data-sources>",
	"<views>",
	`<view url="{{view://${VIEW}}}">`,
	JSON.stringify({
		name: "Hygiene: open loops",
		type: "table",
		advancedFilter: {
			type: "group",
			operator: "and",
			filters: [
				{ type: "property", property: "Open loops", propertyType: "number", operator: "number_greater_than", value: { type: "exact", value: 0 } },
				{
					type: "group",
					operator: "or",
					filters: [
						{ type: "property", property: "Type", propertyType: "select", operator: "enum_is", value: { type: "exact", value: "1:1" } },
						{ type: "property", property: "Type", propertyType: "select", operator: "enum_is", value: { type: "exact", value: "Incident" } },
					],
				},
				{
					type: "property",
					property: "Stale",
					propertyType: "formula",
					operator: "every",
					resultFilter: { type: "property", property: "Stale", propertyType: "text", operator: "string_is", value: { type: "exact", value: "yes" } },
				},
			],
		},
		sorts: [{ property: "Changed", direction: "descending" }],
		groupBy: { property: "Project", propertyType: "select" },
	}),
	"</view>",
	"</views>",
].join("\n");

describe("parseDatabase", () => {
	test("reads the IDs, the properties, and the views of a fetched database", () => {
		const database = parseDatabase(reply(JSON.stringify({ metadata: { type: "database" }, title: "Work", text: DATABASE_TEXT })));
		assert.equal(database.id, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
		assert.equal(database.url, `https://app.notion.com/p/${DB}`);
		assert.equal(database.title, "Work");
		assert.equal(database.inTrash, false);
		assert.equal(database.dataSource, `collection://${DS}`);
		assert.deepEqual(database.properties["Status"], { name: "Status", type: "select", options: [{ name: "active", color: "green" }, { name: "completed", color: "gray" }], target: undefined });
		assert.equal(database.properties["Team"]?.target, `collection://${DS}`);
		assert.equal(database.properties["Stale"]?.type, "formula");
	});

	test("flattens the filter groups of a view and reads the test of a formula filter", () => {
		const view = parseDatabase(reply(JSON.stringify({ text: DATABASE_TEXT }))).views[0];
		assert.equal(view?.url, `view://${VIEW}`);
		assert.deepEqual(view?.filters, [
			{ property: "Open loops", operator: "number_greater_than", value: 0 },
			{ property: "Type", operator: "enum_is", value: "1:1" },
			{ property: "Type", operator: "enum_is", value: "Incident" },
			{ property: "Stale", operator: "string_is", value: "yes" },
		]);
		assert.deepEqual(view?.sorts, [{ property: "Changed", direction: "descending" }]);
		assert.equal(view?.groupBy, "Project");
	});

	test("reads a create reply, and marks a database in Trash", () => {
		const created = parseDatabase(reply(JSON.stringify({ result: `Created database: ${DATABASE_TEXT}` })));
		assert.equal(created.title, "Work");
		const trashed = parseDatabase(reply(JSON.stringify({ text: DATABASE_TEXT.replace('inline="false">', 'inline="false" deleted>') })));
		assert.equal(trashed.inTrash, true);
	});

	test("a reply in an unknown form is an error at this boundary", () => {
		assert.throws(() => parseDatabase(reply('{"text":"no database here"}')), NotionError);
	});
});

describe("parseViews", () => {
	test("reads a view from a notion-create-view reply", () => {
		const result = `Created view "Stale" (table) — view://${VIEW}\n\n<view url="view://${VIEW}">\n${JSON.stringify({ type: "table", name: "Stale", advancedFilter: { type: "group", operator: "and", filters: [] } })}\n</view>`;
		assert.deepEqual(parseViews(reply(JSON.stringify({ result }))), [{ url: `view://${VIEW}`, name: "Stale", type: "table", filters: [], sorts: [], groupBy: undefined }]);
	});
});

describe("parsePage", () => {
	const content = [
		"Intro.",
		"",
		`<database url="https://app.notion.com/p/${DB}" data-source-url="collection://${DS}" inline="false">`,
		"Work",
		"</database>",
		"",
		`<database url="https://app.notion.com/p/${DB.replace(/a/g, "e")}" data-source-url="collection://${DS}" inline="true"></database>`,
		"",
		`<page url="https://app.notion.com/p/${PAGE}">`,
		"Reader map",
		"</page>",
	].join("\n");
	const pageText = (attribute: string): string =>
		`Here is the result of "fetch" for the Page:\n<page url="https://app.notion.com/p/${PAGE.replace(/c/g, "f")}"${attribute}>\n<ancestor-path></ancestor-path>\n<properties>\n{"title":"obsidian-mind"}\n</properties>\n<content>\n${content}\n</content>\n</page>`;

	test("reads the title, the content, and each kind of child", () => {
		const page = parsePage(reply(JSON.stringify({ metadata: { type: "page" }, title: "obsidian-mind", url: "https://app.notion.com/p/x?pvs=204", text: pageText("") })));
		assert.equal(page.title, "obsidian-mind");
		assert.equal(page.id, "ffffffff-ffff-4fff-8fff-ffffffffffff");
		assert.equal(page.inTrash, false);
		assert.match(page.content, /^Intro\./);
		assert.deepEqual(
			page.children.map((child) => [child.kind, child.title, child.dataSource]),
			[
				["database", "Work", `collection://${DS}`],
				["linked_view", "", `collection://${DS}`],
				["page", "Reader map", undefined],
			],
		);
	});

	test("marks a page in Trash", () => {
		assert.equal(parsePage(reply(JSON.stringify({ title: "t", text: pageText(" deleted") }))).inTrash, true);
	});
});

describe("the JSON replies", () => {
	test("parseCreatedPages returns the ID and the URL without the query", () => {
		const created = reply(JSON.stringify({ pages: [{ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", url: `https://app.notion.com/p/${PAGE}?pvs=204`, properties: { Name: "Row" } }] }));
		assert.deepEqual(parseCreatedPages(created), [{ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", url: `https://app.notion.com/p/${PAGE}`, title: "Row" }]);
	});

	test("parseRows returns the rows and the cursor only when more rows exist", () => {
		const last = parseRows(reply(JSON.stringify({ results: [{ Name: "a", url: `https://app.notion.com/p/${PAGE}` }], has_more: false })));
		assert.deepEqual(last, { rows: [{ Name: "a", url: `https://app.notion.com/p/${PAGE}` }], nextCursor: undefined });
		assert.equal(parseRows(reply(JSON.stringify({ results: [], has_more: true, next_cursor: "c1" }))).nextCursor, "c1");
	});

	test("parsePrivatePages returns the titles and the cursor", () => {
		const list = parsePrivatePages(reply(JSON.stringify({ results: [{ type: "page", url: `https://app.notion.com/p/${PAGE}?pvs=204`, title: "obsidian-mind" }, { type: "page", url: `https://app.notion.com/p/${DB}` }], nextCursor: "offset:5" })));
		assert.deepEqual(list.pages.map((page) => page.title), ["obsidian-mind", ""]);
		assert.equal(list.pages[0]?.id, "cccccccc-cccc-4ccc-8ccc-cccccccccccc");
		assert.equal(list.nextCursor, "offset:5");
	});

	test("parseWorkspaceId reads notion-get-self", () => {
		assert.equal(parseWorkspaceId(reply('{"workspace":{"id":"11111111-1111-4111-8111-111111111111"},"user":{}}')), "11111111-1111-4111-8111-111111111111");
		assert.throws(() => parseWorkspaceId(reply('{"user":{}}')), NotionError);
	});
});

describe("notionId", () => {
	test("gives the UUID of a URL, of a URL with a title slug, and of a bare ID", () => {
		const uuid = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
		assert.equal(notionId(`https://app.notion.com/p/${PAGE}?pvs=204`), uuid);
		assert.equal(notionId(`https://www.notion.so/Some-Title-${PAGE}`), uuid);
		assert.equal(notionId(uuid), uuid);
		assert.equal(notionId(`view://${uuid}`), uuid);
	});
});
