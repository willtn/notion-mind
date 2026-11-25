/**
 * The reads of the SessionStart hook (lib/session-sources.ts): the value of
 * each part for the rows and the pages of a workspace, the calls that the
 * reads make, and a read that fails. The `call` of each test is a table of
 * rows by view and of pages by ID. The parity run on the real workspace is
 * the live proof.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NotionClient } from "../lib/notion-client.ts";
import type { DatabaseKey } from "../lib/notion-model.ts";
import { ownContent, plainMarkdown, readSessionSources, sessionSourcesNotRead, type Read, type SessionSources } from "../lib/session-sources.ts";
import { fakeMap, fakeUrl, fetchedPage, rootContent } from "./_fake-notion.ts";
import { rmTemp } from "./_helpers.ts";

type Row = Readonly<Record<string, unknown>>;
type Views = Readonly<Partial<Record<DatabaseKey, Readonly<Record<string, readonly Row[] | Error>>>>>;
type Pages = Readonly<Record<string, { readonly title: string; readonly content: string } | Error>>;

const NOW = Date.parse("2026-11-26T12:00:00Z");
const HOUR = 3_600_000;
const { map, nextId } = fakeMap();
const { home, north_star: northStar } = map.pages;

let PROJECT = "";
before(() => {
	PROJECT = mkdtempSync(join(tmpdir(), "session-sources-"));
});
after(() => rmTemp(PROJECT));

const changed = (hoursAgo: number): string => new Date(NOW - hoursAgo * HOUR).toISOString();
const row = (Name: string, fields: Row = {}): Row => ({ Name, ...fields });

/** The pages that each run fetches, with no text. A test puts its own pages over them. */
const BASE_PAGES: Pages = {
	[home.id]: { title: "Home", content: "" },
	[northStar.id]: { title: "North Star", content: "" },
	[map.root.id]: { title: map.root.title, content: rootContent(Object.values(map.pages)) },
};

/** A `call` that answers each view query with the rows of `views`, 100 rows on a page, and each fetch with a page of `pages`. It keeps what it gets. */
function notion(views: Views, pages: Pages = {}): { readonly call: NotionClient["call"]; readonly queried: string[]; readonly fetched: string[] } {
	const byUrl = new Map<string, { readonly name: string; readonly rows: readonly Row[] | Error }>();
	for (const key of Object.keys(map.databases) as DatabaseKey[]) {
		for (const [view, url] of Object.entries(map.databases[key].views)) byUrl.set(url, { name: `${key} / ${view}`, rows: views[key]?.[view] ?? [] });
	}
	const all = { ...BASE_PAGES, ...pages };
	const queried: string[] = [];
	const fetched: string[] = [];
	const call: NotionClient["call"] = async (tool, args = {}) => {
		if (tool === "notion-fetch") {
			const id = String(args["id"]);
			fetched.push(id);
			const page = all[id];
			if (page === undefined) throw new Error(`no page ${id}`);
			if (page instanceof Error) throw page;
			const text = fetchedPage({ id, title: page.title, properties: { title: page.title }, content: page.content, under: [] });
			return { text, json: JSON.parse(text) };
		}
		assert.equal(tool, "notion-query-data-sources");
		const data = args["data"] as { readonly view_url: string; readonly page_size: number; readonly start_cursor?: string };
		const view = byUrl.get(data.view_url);
		assert.ok(view !== undefined, `the map file has no view ${data.view_url}`);
		queried.push(view.name);
		if (view.rows instanceof Error) throw view.rows;
		const from = Number(data.start_cursor ?? 0);
		const next = from + data.page_size;
		const json = { results: view.rows.slice(from, next), has_more: next < view.rows.length, next_cursor: String(next) };
		return { text: JSON.stringify(json), json };
	};
	return { call, queried, fetched };
}

const read = (views: Views, pages: Pages = {}, mode: SessionSources["mode"] = "full", openTaskLimit = 10): Promise<SessionSources> =>
	readSessionSources({ call: notion(views, pages).call, map, projectDir: PROJECT, nowMs: NOW, mode, watchedTypes: ["1:1", "Inbox item", "Incident"], openTaskLimit });

function valueOf<T>(part: Read<T>): T {
	assert.ok("value" in part, `the part is not read: ${"notRead" in part ? part.notRead : ""}`);
	return part.value;
}

async function full(views: Views, pages: Pages = {}) {
	const sources = await read(views, pages);
	assert.equal(sources.mode, "full");
	return sources as Extract<SessionSources, { mode: "full" }>;
}

describe("the Markdown of a fetched page", () => {
	test("plainMarkdown drops the lines of a synced block tag and keeps the text between them", () => {
		const content = '## Current Focus\n\n<synced-block url="https://app.notion.com/p/0#1">\n- Ship the export.\n  - A detail.\n</synced-block>\n\n## Goals';
		assert.equal(plainMarkdown(content), "## Current Focus\n\n- Ship the export.\n  - A detail.\n\n## Goals");
	});

	test("plainMarkdown gives Markdown marks for the inline tags, and the title of a page for a mention", () => {
		assert.equal(plainMarkdown('- <s>Close it.</s> See <mention url="https://app.notion.com/p/1">Atlas</mention>, <b>now</b>, in <code>main</code>.'), "- ~~Close it.~~ See Atlas, **now**, in `main`.");
	});

	test("plainMarkdown gives an empty bullet for the empty list item of a fetched template", () => {
		assert.equal(plainMarkdown("## Goals\n\n<ul>\n<li></li>\n</ul>"), "## Goals\n\n- ");
	});

	test("ownContent drops the text that a page only shows from a different page", () => {
		const content = '## Current Focus\n\n<synced-block-reference url="https://app.notion.com/p/0#1">\n- [ ] a task of the other page\n</synced-block-reference>\n\n- [ ] a task of this page\n';
		assert.equal(ownContent(content), "## Current Focus\n\n\n- [ ] a task of this page\n");
	});
});

describe("SS-11: the North Star", () => {
	test("the part is the body of the North Star page as plain Markdown", async () => {
		const sources = await full({}, { [northStar.id]: { title: "North Star", content: '## Current Focus\n\n<synced-block url="https://app.notion.com/p/0#1">\n- <s>Done.</s>\n- Ship it.\n</synced-block>\n\n' } });
		assert.equal(valueOf(sources.northStar), "## Current Focus\n\n- ~~Done.~~\n- Ship it.");
	});
});

describe("SS-12: the brain topics", () => {
	test("each row of the brain index is a topic, by name, with its description and its content mark", async () => {
		const sources = await full({
			knowledge: { "Brain index": [row("Patterns", { Description: "The patterns", "Has content": "__YES__" }), row("Gotchas", { Description: "", "Has content": "__NO__" }), row("Key Decisions", { "Has content": "__YES__" })] },
		});
		assert.deepEqual(valueOf(sources.brainTopics), [
			{ name: "Gotchas", description: null, hasContent: false },
			{ name: "Key Decisions", description: null, hasContent: true },
			{ name: "Patterns", description: "The patterns", hasContent: true },
		]);
	});
});

describe("SS-13: the recent changes", () => {
	test("a row counts when its change is in the last 48 hours, and the latest is first across the databases", async () => {
		const sources = await read({
			work: { "Recently changed": [row("One Hour", { "date:Changed:start": changed(1) }), row("At The Limit", { "date:Changed:start": changed(48) }), row("Past The Limit", { "date:Changed:start": changed(48.02) })] },
			people: { "Recently changed": [row("Ada Park", { "date:Changed:start": changed(20) }), row("No Date")] },
		});
		assert.deepEqual(valueOf(sources.recentChanges), ["One Hour", "Ada Park", "At The Limit"]);
	});

	test("the context after a resume stops the read of a database at the page that ends with an older row", async () => {
		const recent = Array.from({ length: 120 }, (_, index) => row(`Recent ${String(index).padStart(3, "0")}`, { "date:Changed:start": changed(1 + index / 100) }));
		const old = Array.from({ length: 200 }, (_, index) => row(`Old ${index}`, { "date:Changed:start": changed(100 + index) }));
		const fake = notion({ work: { "Recently changed": [...recent, ...old] } });
		const sources = await readSessionSources({ call: fake.call, map, projectDir: PROJECT, nowMs: NOW, mode: "pointer", watchedTypes: [], openTaskLimit: 10 });
		assert.equal(valueOf(sources.recentChanges).length, 120);
		assert.equal(fake.queried.filter((name) => name === "work / Recently changed").length, 2, "the second page ends with an old row");
	});

	test("a full context reads each page of the view, because it lists each row", async () => {
		const many = Array.from({ length: 230 }, (_, index) => row(`Person ${String(index).padStart(3, "0")}`, { "date:Changed:start": changed(100 + index) }));
		const fake = notion({ people: { "Recently changed": many } });
		const sources = await readSessionSources({ call: fake.call, map, projectDir: PROJECT, nowMs: NOW, mode: "full", watchedTypes: [], openTaskLimit: 10 });
		assert.equal(fake.queried.filter((name) => name === "people / Recently changed").length, 3);
		assert.equal(sources.mode === "full" && valueOf(sources.listing).groups[0]?.titles.length, 230);
	});

	test("the recent changes and the listing do not read the Templates database", async () => {
		const fake = notion({ templates: { "Recently changed": [row("Work Note", { "date:Changed:start": changed(1) })] } });
		const sources = await readSessionSources({ call: fake.call, map, projectDir: PROJECT, nowMs: NOW, mode: "full", watchedTypes: [], openTaskLimit: 10 });
		assert.deepEqual(valueOf(sources.recentChanges), []);
		assert.deepEqual(fake.queried.filter((name) => name.endsWith("Recently changed")).sort(), ["competencies", "knowledge", "people", "perf_docs", "teams", "work"].map((key) => `${key} / Recently changed`));
	});
});

describe("SS-14: the open tasks", () => {
	const taskRow = (Name: string, count: number): { readonly row: Row; readonly id: string } => {
		const id = nextId();
		return { row: row(Name, { url: fakeUrl(id), "Open tasks": count }), id };
	};

	test("the notes are the rows of the open tasks view by title with their text, then Home", async () => {
		const b = taskRow("Billing Export", 2);
		const a = taskRow("Audit Trail", 1);
		const sources = await read(
			{ work: { "Open tasks": [b.row, a.row] } },
			{
				[a.id]: { title: "Audit Trail", content: "- [ ] Name the columns\n" },
				[b.id]: { title: "Billing Export", content: "- [ ] Write the schema\n- [x] Pick the format\n- [ ] Measure the run\n" },
				[home.id]: { title: "Home", content: "- [ ] Plan the offsite\n" },
			},
		);
		assert.deepEqual(valueOf(sources.openTasks), {
			notes: [
				{ title: "Audit Trail", content: "- [ ] Name the columns" },
				{ title: "Billing Export", content: "- [ ] Write the schema\n- [x] Pick the format\n- [ ] Measure the run" },
				{ title: "Home", content: "- [ ] Plan the offsite" },
			],
			notFetched: 0,
		});
	});

	test("the hook fetches at most the limit of rows, and it has the open tasks of the other rows from their property", async () => {
		const entries = Array.from({ length: 5 }, (_, index) => taskRow(`Note ${index}`, index + 1));
		const pages = Object.fromEntries(entries.map(({ id, row: { Name } }) => [id, { title: String(Name), content: "- [ ] a task\n" }]));
		const fake = notion({ work: { "Open tasks": entries.map((entry) => entry.row) } }, pages);
		const sources = await readSessionSources({ call: fake.call, map, projectDir: PROJECT, nowMs: NOW, mode: "pointer", watchedTypes: [], openTaskLimit: 3 });
		const tasks = valueOf(sources.openTasks);
		assert.deepEqual(tasks.notes.map(({ title }) => title), ["Note 0", "Note 1", "Note 2", "Home"]);
		assert.equal(tasks.notFetched, 4 + 5, "the rows Note 3 and Note 4 have 4 and 5 open tasks");
		assert.deepEqual(fake.fetched.filter((id) => id !== home.id).sort(), entries.slice(0, 3).map(({ id }) => id).sort());
	});

	test("the text of Home does not have the block that Home shows from the North Star page", async () => {
		const sources = await read({}, { [home.id]: { title: "Home", content: '<synced-block-reference url="https://app.notion.com/p/0#1">\n- [ ] a goal\n</synced-block-reference>\n- [ ] Plan the offsite\n' } });
		assert.deepEqual(valueOf(sources.openTasks).notes, [{ title: "Home", content: "- [ ] Plan the offsite" }]);
	});
});

describe("SS-15: the active work", () => {
	test("the titles of the loose active view, in the order of the titles", async () => {
		const sources = await read({ work: { "Hygiene: loose active": [row("Search Ranking"), row("Billing Retry"), row("Audit Trail")] } });
		assert.deepEqual(valueOf(sources.activeWork), ["Audit Trail", "Billing Retry", "Search Ranking"]);
	});
});

describe("SS-16: the listing", () => {
	const groupsOf = async (views: Views) => Object.fromEntries(valueOf((await full(views)).listing).groups.map(({ name, titles, alwaysCollapsed }) => [name, { titles, alwaysCollapsed }]));

	test("a row is in the group of its database and its Type, and a database with no Type is one group", async () => {
		const groups = await groupsOf({
			work: { "Recently changed": [row("Checkout Outage", { Type: "Incident", Status: "active" }), row("Ada Park 2026-01-10", { Type: "1:1" }), row("No Type")] },
			people: { "Recently changed": [row("Ada Park")] },
		});
		assert.deepEqual(groups, {
			"Work / Incident": { titles: ["Checkout Outage"], alwaysCollapsed: false },
			"Work / 1:1": { titles: ["Ada Park 2026-01-10"], alwaysCollapsed: false },
			Work: { titles: ["No Type"], alwaysCollapsed: false },
			People: { titles: ["Ada Park"], alwaysCollapsed: false },
		});
	});

	test("a work note or a decision that is completed or archived is in the archived work, which always collapses", async () => {
		const groups = await groupsOf({
			work: {
				"Recently changed": [
					row("Legacy Importer", { Type: "Work note", Status: "completed" }),
					row("Search Migration", { Type: "Work note", Status: "archived" }),
					row("Old Choice", { Type: "Decision", Status: "archived" }),
					row("Billing Retry", { Type: "Work note", Status: "active" }),
					row("Accepted Choice", { Type: "Decision", Status: "accepted" }),
					row("Closed Outage", { Type: "Incident", Status: "completed" }),
				],
			},
		});
		assert.deepEqual(groups, {
			"Work / Archived": { titles: ["Legacy Importer", "Search Migration", "Old Choice"], alwaysCollapsed: true },
			"Work / Work note": { titles: ["Billing Retry"], alwaysCollapsed: false },
			"Work / Decision": { titles: ["Accepted Choice"], alwaysCollapsed: false },
			"Work / Incident": { titles: ["Closed Outage"], alwaysCollapsed: false },
		});
	});

	test("a thinking note is in no group", async () => {
		assert.deepEqual(await groupsOf({ work: { "Recently changed": [row("Draft Thoughts", { Type: "Thinking" })] } }), {});
	});

	test("the pages are the note pages under the root page: no page of the setup that holds only views, and no database", async () => {
		const draft = nextId();
		const children = [...Object.values(map.pages), { url: fakeUrl(draft), title: "Loose Draft" }];
		const content = `${rootContent(children)}\n<database url="${map.databases.work.url}" inline="false" data-source-url="${map.databases.work.data_source}">Work</database>`;
		const sources = await full({}, { [map.root.id]: { title: map.root.title, content } });
		assert.deepEqual([...valueOf(sources.listing).pages].sort(), ["Home", "Loose Draft", "North Star"]);
	});
});

describe("a read that fails", () => {
	test("only the part of the read is not read, with the cause, and the scan has its own entry", async () => {
		const sources = await full({ work: { "Hygiene: loose active": new Error("the view did not load\nsecond line") }, people: { "Recently changed": [row("Ada Park")] } }, { [home.id]: new Error("no reply for Home") });
		assert.deepEqual(sources.activeWork, { notRead: "the view did not load" });
		assert.deepEqual(sources.openTasks, { notRead: "no reply for Home" });
		assert.deepEqual(valueOf(sources.listing).groups, [{ name: "People", titles: ["Ada Park"], alwaysCollapsed: false }]);
		assert.deepEqual(valueOf(sources.brainTopics), []);
		assert.deepEqual(sources.hygiene.notRead.map(({ view }) => view), ['"Hygiene: loose active" of Work']);
	});

	test("one database that fails takes the recent changes and the listing with it, because each of them needs each database", async () => {
		const sources = await full({ teams: { "Recently changed": new Error("no reply") }, people: { "Recently changed": [row("Ada Park", { "date:Changed:start": changed(1) })] } });
		assert.deepEqual(sources.recentChanges, { notRead: "no reply" });
		assert.deepEqual(sources.listing, { notRead: "no reply" });
	});

	test("the root page that fails takes only the listing", async () => {
		const sources = await full({ people: { "Recently changed": [row("Ada Park", { "date:Changed:start": changed(1) })] } }, { [map.root.id]: new Error("no root") });
		assert.deepEqual(sources.listing, { notRead: "no root" });
		assert.deepEqual(valueOf(sources.recentChanges), ["Ada Park"]);
	});

	test("sessionSourcesNotRead names what the hook cannot use in each part, and the scan has the cause", () => {
		const sources = sessionSourcesNotRead("full", PROJECT, "the Notion map file", new Error("ENOENT"));
		const notRead = { notRead: "the hook cannot use the Notion map file" };
		assert.equal(sources.mode, "full");
		assert.deepEqual([sources.recentChanges, sources.openTasks, sources.activeWork], [notRead, notRead, notRead]);
		assert.deepEqual(sources.mode === "full" && [sources.northStar, sources.brainTopics, sources.listing], [notRead, notRead, notRead]);
		assert.deepEqual(sources.hygiene.notRead, [{ view: "the Notion map file", cause: "ENOENT" }]);
		assert.deepEqual(Object.keys(sessionSourcesNotRead("pointer", PROJECT, "the Notion map file", new Error("ENOENT"))).sort(), ["activeWork", "hygiene", "mode", "openTasks", "recentChanges"]);
	});
});

describe("the parts of each mode", () => {
	test("the context after a resume has no North Star, no brain topics, and no listing, and it makes no call for them", async () => {
		const fake = notion({});
		const sources = await readSessionSources({ call: fake.call, map, projectDir: PROJECT, nowMs: NOW, mode: "pointer", watchedTypes: [], openTaskLimit: 10 });
		assert.deepEqual(Object.keys(sources).sort(), ["activeWork", "hygiene", "mode", "openTasks", "recentChanges"]);
		assert.deepEqual(fake.fetched, [home.id]);
		assert.equal(fake.queried.includes("knowledge / Brain index"), false);
	});

	test("the hygiene report is the report of the scan, with the watched types of the request", async () => {
		const old = new Date(NOW - 30 * 24 * HOUR).toISOString();
		const views: Views = { work: { "Hygiene: open loops": [row("Vendor Review", { Type: "Work note", "Open loops": 2, "date:Changed:start": old })] } };
		const watched = await readSessionSources({ call: notion(views).call, map, projectDir: PROJECT, nowMs: NOW, mode: "pointer", watchedTypes: ["Work note"], openTaskLimit: 10 });
		assert.deepEqual(watched.hygiene.openLoops, [{ title: "Vendor Review", ageDays: 30, openItems: 2 }]);
		assert.deepEqual((await read(views)).hygiene.openLoops, []);
	});
});
