/**
 * parity/notion-form.ts on a small model of Notion in memory. The model
 * keeps pages, rows, and select options, and it changes a written body in
 * the ways that the live runs showed. These tests cover the order and the
 * counts of the writes. `notion-fixture-live.test.ts` is the proof on the
 * real workspace.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { NotionError, type NotionClient, type NotionReply } from "../lib/notion-client.ts";
import type { NotionMap } from "../lib/notion-map.ts";
import { DATABASES, type DatabaseKey } from "../lib/notion-model.ts";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIXTURE_ROOT_TITLE, ledgerHooks, ledgerHooksOf, writeFixture, type WriteResult } from "../parity/notion-form.ts";
import type { FixtureSpec } from "../parity/spec.ts";
import { SPEC } from "./_notion-spec.ts";

interface FakePage {
	readonly id: string;
	readonly title: string;
	readonly database: DatabaseKey | undefined;
	properties: Record<string, unknown>;
	content: string;
}

const KEYS = ["work", "people", "knowledge"] as const;
const SYNCED = /<synced-block url="([^"]+)">\n([\s\S]*?)\n<\/synced-block>/;
const REFERENCE = /(<synced-block-reference url="[^"]+">)\n?([\s\S]*?)\n?(<\/synced-block-reference>)/;

/** Notion in memory, with the pages that the setup makes under the fixture root. */
function fakeNotion() {
	let serial = 0;
	const nextId = (): string => `00000000-0000-0000-0000-${String(++serial).padStart(12, "0")}`;
	const urlOf = (id: string): string => `https://app.notion.com/p/${id.replace(/-/g, "")}`;
	const pages = new Map<string, FakePage>();
	const add = (title: string, database: DatabaseKey | undefined, content = "", properties: Record<string, unknown> = {}): FakePage => {
		const page: FakePage = { id: nextId(), title, database, properties, content };
		pages.set(page.id, page);
		return page;
	};
	const root = add(FIXTURE_ROOT_TITLE, undefined);
	const databaseIds = Object.fromEntries(KEYS.map((key) => [key, nextId()])) as Record<DatabaseKey, string>;
	const options = Object.fromEntries(
		KEYS.map((key) => [key, Object.fromEntries(Object.entries(DATABASES.find((d) => d.key === key)?.properties ?? {}).flatMap(([name, p]) => (p.type === "select" || p.type === "multi_select" ? [[name, [...p.options]]] : [])))]),
	) as Record<DatabaseKey, Record<string, string[]>>;

	const northStar = add("North Star", undefined, "");
	const blockUrl = `${urlOf(northStar.id)}#${"b".repeat(32)}`;
	northStar.content = `Old text.\n\n## Current Focus\n\n<synced-block url="${blockUrl}">\n- Old focus.\n</synced-block>\n`;
	const view = `<database url="${urlOf(nextId())}" data-source-url="collection://${databaseIds.work}" inline="true"></database>`;
	const home = add("Home", undefined, `## Current Focus\n\n<synced-block-reference url="${blockUrl}">\n- Old focus.\n</synced-block-reference>\n\n## Open Questions\n\nOld.\n\n${view}\n`);
	for (const title of ["Patterns", "Gotchas", "Key Decisions"]) add(title, "knowledge", "Old.\n", { Type: "Brain topic", Scaffold: "__YES__", Description: "Old description" });
	const readerMap = add("Reader map", undefined, "The setup fills this page.\n");

	const map = {
		version: 1,
		workspace_id: "workspace-1",
		root: { id: root.id, url: urlOf(root.id), title: root.title },
		databases: Object.fromEntries(KEYS.map((key) => [key, { id: databaseIds[key], url: urlOf(databaseIds[key]), title: key, data_source: `collection://${databaseIds[key]}`, views: { "Recently changed": `view://${key}` } }])),
		pages: Object.fromEntries([["north_star", northStar] as const, ["home", home] as const, ["reader_map", readerMap] as const].map(([key, page]) => [key, { id: page.id, url: urlOf(page.id), title: page.title, views: {} }])),
		templates: {},
	} as unknown as NotionMap;

	const titleOfUrl = (url: string): string => [...pages.values()].find((page) => urlOf(page.id) === url)?.title ?? "";
	/** A body as Notion returns it after a write. */
	const stored = (content: string): string =>
		content
			.replace(/<mention url="([^"]+)"\/>/g, (_, url: string) => `<mention url="${url}">${titleOfUrl(url)}</mention>`)
			.replace(/\[\[/g, "\\[\\[")
			.replace(/\]\]/g, "\\]\\]")
			.replace(/~~([^~]+)~~/g, "<s>$1</s>");
	/** The text of a synced block is one text on each page that holds it. An edit in a reference is an edit of the original. */
	const syncFrom = (edited: FakePage): void => {
		const text = edited.content.match(SYNCED)?.[2] ?? edited.content.match(REFERENCE)?.[2];
		if (text === undefined) return;
		for (const page of pages.values()) {
			page.content = page.content.replace(SYNCED, (_, url: string) => `<synced-block url="${url}">\n${text}\n</synced-block>`).replace(REFERENCE, (_, open: string, __: string, close: string) => `${open}\n${text}\n${close}`);
		}
	};

	const calls: { tool: string; args: Record<string, unknown> }[] = [];
	const reply = (json: unknown): NotionReply => ({ text: JSON.stringify(json), json });
	const fetch = (id: string): NotionReply => {
		const key = KEYS.find((candidate) => databaseIds[candidate] === id);
		if (key !== undefined) {
			const schema = { schema: Object.fromEntries(Object.entries(options[key]).map(([name, names]) => [name, { type: name === "Tags" ? "multi_select" : "select", options: names.map((option) => ({ name: option, color: "gray" })) }])) };
			return reply({ text: `<database url="${urlOf(id)}">\nThe title of this Database is: ${key}\n<data-source url="collection://${id}">\n<data-source-state>\n${JSON.stringify(schema)}\n</data-source-state>\n</data-source>\n</database>` });
		}
		const page = pages.get(id);
		if (page === undefined) throw new NotionError("tool_error", `no page ${id}`);
		const children = page === root ? [...pages.values()].filter((child) => child !== root && child.database === undefined).map((child) => `<page url="${urlOf(child.id)}">\n${child.title}\n</page>`).join("\n\n") : "";
		return reply({ title: page.title, text: `<page url="${urlOf(page.id)}">\n<properties>\n${JSON.stringify(page.properties)}\n</properties>\n<content>\n${page.content}${children}\n</content>\n</page>` });
	};

	const client: NotionClient = {
		close: async () => {},
		call: async (tool, args = {}) => {
			calls.push({ tool, args });
			switch (tool) {
				case "notion-get-self":
					return reply({ workspace: { id: "workspace-1" } });
				case "notion-fetch":
					return fetch(String(args["id"]));
				case "notion-query-data-sources": {
					const key = String((args["data"] as { view_url: string }).view_url).replace("view://", "");
					const results = [...pages.values()].filter((page) => page.database === key).map((page) => ({ ...page.properties, Name: page.title, url: urlOf(page.id) }));
					return reply({ results, has_more: false });
				}
				case "notion-update-data-source": {
					const key = KEYS.find((candidate) => `collection://${databaseIds[candidate]}` === args["data_source_id"]) ?? assert.fail("unknown data source");
					for (const [, name, list] of String(args["statements"]).matchAll(/ALTER COLUMN "([^"]+)" SET \w+\(([^)]*)\)/g)) {
						options[key][name ?? ""] = [...(list ?? "").matchAll(/'([^']+)':/g)].map((match) => match[1] ?? "");
					}
					return reply({});
				}
				case "notion-create-pages": {
					const parent = args["parent"] as { data_source_id?: string; page_id?: string };
					const key = KEYS.find((candidate) => `collection://${databaseIds[candidate]}` === parent.data_source_id);
					const made = (args["pages"] as { properties: Record<string, string> }[]).map((entry) => add(entry.properties["Name"] ?? entry.properties["title"] ?? "", key));
					return reply({ pages: made.map((page) => ({ id: page.id, url: urlOf(page.id), properties: { title: page.title } })) });
				}
				case "notion-delete-pages": {
					for (const id of args["page_ids"] as string[]) assert.ok(pages.delete(id), `the model has no page ${id}`);
					return reply({});
				}
				case "notion-update-page": {
					const page = pages.get(String(args["page_id"])) ?? assert.fail("unknown page");
					if (args["command"] === "replace_content") {
						page.content = stored(String(args["new_str"]));
						syncFrom(page);
					} else {
						for (const [name, value] of Object.entries(args["properties"] as Record<string, unknown>)) {
							const option = typeof value === "string" && page.database !== undefined ? options[page.database][name] : undefined;
							if (option !== undefined && !option.includes(value as string)) throw new NotionError("tool_error", `Invalid select value for property "${name}": "${String(value)}"`);
							if (value === null) delete page.properties[name];
							else page.properties[name] = Array.isArray(value) ? JSON.stringify(value.map((item: string) => (pages.has(item) ? urlOf(item) : item))) : value;
						}
					}
					page.properties["Last edited"] = new Date().toISOString();
					return reply({ page_id: page.id });
				}
				default:
					throw new NotionError("tool_error", `the model has no tool ${tool}`);
			}
		},
	};
	const pageOf = (title: string): FakePage => [...pages.values()].find((page) => page.title === title) ?? assert.fail(`no page ${title}`);
	const has = (title: string): boolean => [...pages.values()].some((page) => page.title === title);
	return { client, map, calls, pageOf, has, pages };
}

const now = new Date("2026-03-04T10:00:00.000Z");
const counts = (result: WriteResult) => ({ created: result.created, updated: result.updated, unchanged: result.unchanged });
const writes = (calls: readonly { tool: string }[]): number =>
	calls.filter((call) => ["notion-create-pages", "notion-update-page", "notion-update-data-source", "notion-delete-pages"].includes(call.tool)).length;
const ALL = SPEC.notes.length;
const ROWS = SPEC.notes.filter((n) => !["Home", "North Star", "Loose page"].includes(n.type)).length;
/** The spec with one note changed. */
const withNote = (title: string, change: (note: FixtureSpec["notes"][number]) => FixtureSpec["notes"][number]): FixtureSpec => ({
	...SPEC,
	notes: SPEC.notes.map((n) => (n.title === title ? change(n) : n)),
});

describe("writeFixture", () => {
	test("the first run creates each note that the setup did not make, and fills the pages of the setup", async () => {
		const notion = fakeNotion();
		const created: string[] = [];
		const result = await writeFixture(notion.client, SPEC, notion.map, { now, onCreated: (kind, _id, title) => created.push(`${kind}: ${title}`) });
		assert.deepEqual(counts(result), { created: 12, updated: 4, unchanged: 0 });
		assert.equal(created.filter((line) => line.startsWith("row: ")).length, 11);
		assert.ok(created.includes("page: Loose Draft"));
		assert.equal(result.pages.size, ALL);
		assert.equal(result.trashed, 0);
		assert.equal(notion.pageOf("Patterns").properties["Description"], undefined);
		assert.equal(notion.pageOf("Planning Export").properties["Open loops"], 1);
		assert.equal(notion.pageOf("Ada Park 2026-02-07").properties["Person"], JSON.stringify([`https://app.notion.com/p/${notion.pageOf("Ada Park").id.replace(/-/g, "")}`]));
	});

	test("a second run with the same instant makes no write", async () => {
		const notion = fakeNotion();
		await writeFixture(notion.client, SPEC, notion.map, { now });
		const before = notion.calls.length;
		const second = await writeFixture(notion.client, SPEC, notion.map, { now });
		assert.deepEqual(counts(second), { created: 0, updated: 0, unchanged: ALL });
		assert.equal(second.optionsAdded, 0);
		assert.equal(writes(notion.calls.slice(before)), 0);
	});

	test("the synced block of North Star holds the focus of the fixture, Home shows it, and Home keeps its linked view", async () => {
		const notion = fakeNotion();
		await writeFixture(notion.client, SPEC, notion.map, { now });
		const focus = "- Ship the export.";
		assert.match(notion.pageOf("North Star").content, /<synced-block url="[^"]+">\n- Ship the export\./);
		assert.ok(notion.pageOf("Home").content.includes(focus));
		assert.ok(!notion.pageOf("North Star").content.includes("Old focus"));
		assert.match(notion.pageOf("Home").content, /- \[ \] Review the goals[\s\S]*<database url=/);
		assert.ok(!notion.pageOf("Home").content.includes("Open Questions"));
	});

	test("the page that shows the synced block is written after the page that owns it, in each order of the notes", async () => {
		const first = (title: string) => ({ ...SPEC, notes: [...SPEC.notes].sort((a, b) => Number(b.title === title) - Number(a.title === title)) });
		for (const spec of [first("North Star"), first("Home")]) {
			const notion = fakeNotion();
			await writeFixture(notion.client, spec, notion.map, { now });
			assert.ok(!notion.pageOf("North Star").content.includes("Old focus"), `${spec.notes[0]?.title} first: the original keeps the focus of the fixture`);
			assert.ok(notion.pageOf("Home").content.includes("- Ship the export."), `${spec.notes[0]?.title} first: Home shows the focus`);
			assert.deepEqual(counts(await writeFixture(notion.client, spec, notion.map, { now })), { created: 0, updated: 0, unchanged: ALL });
		}
	});

	test("a run with a later instant updates Changed of each row and nothing else", async () => {
		const notion = fakeNotion();
		await writeFixture(notion.client, SPEC, notion.map, { now });
		const before = notion.calls.length;
		const later = await writeFixture(notion.client, SPEC, notion.map, { now: new Date(now.getTime() + 3_600_000) });
		assert.deepEqual(counts(later), { created: 0, updated: ROWS, unchanged: ALL - ROWS });
		const updates = notion.calls.slice(before).filter((call) => call.tool === "notion-update-page");
		assert.equal(updates.length, ROWS);
		for (const update of updates) {
			assert.deepEqual(Object.keys(update.args["properties"] as object).sort(), ["date:Changed:is_datetime", "date:Changed:start", "date:Hook stamp:is_datetime", "date:Hook stamp:start"]);
		}
	});

	test("a value and a body that changed in Notion go back to the spec, and only those pages get a write", async () => {
		const notion = fakeNotion();
		await writeFixture(notion.client, SPEC, notion.map, { now });
		notion.pageOf("Outage").properties["Severity"] = "low";
		notion.pageOf("Ada Park").properties["Role"] = "";
		notion.pageOf("Loose Draft").content = "A different body.\n";
		const lines: string[] = [];
		const repaired = await writeFixture(notion.client, SPEC, notion.map, { now, log: (line) => lines.push(line) });
		assert.deepEqual(counts(repaired), { created: 0, updated: 3, unchanged: ALL - 3 });
		assert.deepEqual(lines.sort(), ["updated Ada Park: Role", "updated Loose Draft: content", "updated Outage: Severity"]);
		assert.equal(notion.pageOf("Outage").properties["Severity"], "high");
		assert.match(notion.pageOf("Loose Draft").content, /A page outside the databases/);
	});

	test("a row whose last edit is later than its stamp gets a new stamp", async () => {
		const notion = fakeNotion();
		await writeFixture(notion.client, SPEC, notion.map, { now });
		notion.pageOf("Runbook").properties["Last edited"] = new Date(Date.now() + 600_000).toISOString();
		const lines: string[] = [];
		const result = await writeFixture(notion.client, SPEC, notion.map, { now, log: (line) => lines.push(line) });
		assert.deepEqual(lines, ["updated Runbook: Hook stamp"]);
		assert.equal(result.updated, 1);
	});

	test("a run that stopped after it made the pages is finished by the next run", async () => {
		const notion = fakeNotion();
		let updates = 0;
		const stopsEarly: NotionClient = {
			close: async () => {},
			call: async (tool, args) => {
				if (tool === "notion-update-page" && ++updates > 10) throw new NotionError("transport", "connection lost");
				return notion.client.call(tool, args);
			},
		};
		await assert.rejects(writeFixture(stopsEarly, SPEC, notion.map, { now }), /connection lost/);
		const next = await writeFixture(notion.client, SPEC, notion.map, { now });
		assert.equal(next.created, 0);
		assert.deepEqual(counts(await writeFixture(notion.client, SPEC, notion.map, { now })), { created: 0, updated: 0, unchanged: ALL });
	});

	test("a login in a different workspace stops the run before a write", async () => {
		const notion = fakeNotion();
		const other = { ...notion.map, workspace_id: "workspace-2" };
		await assert.rejects(writeFixture(notion.client, SPEC, other, { now }), /different workspace/);
		assert.equal(writes(notion.calls), 0);
	});

	test("a root with a different title stops the run before a write", async () => {
		const notion = fakeNotion();
		const other = { ...notion.map, root: { ...notion.map.root, title: "obsidian-mind" } };
		await assert.rejects(writeFixture(notion.client, SPEC, other, { now }), /changes only the root "obsidian-mind parity fixtures"/);
		assert.equal(notion.calls.length, 0);
	});

	test("a note with a new title: the row of the old title goes to Trash, and the hooks get both actions", async () => {
		const notion = fakeNotion();
		await writeFixture(notion.client, SPEC, notion.map, { now });
		const oldId = notion.pageOf("Runbook").id;
		const events: string[] = [];
		const renamed = withNote("Runbook", (n) => ({ ...n, title: "Runbook 2" }));
		const result = await writeFixture(notion.client, renamed, notion.map, {
			now,
			mayTrash: () => true,
			onCreated: (kind, _id, title) => events.push(`created ${kind}: ${title}`),
			onTrashed: (kind, id, title) => events.push(`trashed ${kind}: ${title}: ${id === oldId}`),
		});
		assert.deepEqual({ ...counts(result), trashed: result.trashed }, { created: 1, updated: 0, unchanged: ALL - 1, trashed: 1 });
		assert.deepEqual(events.sort(), ["created row: Runbook 2", "trashed row: Runbook: true"]);
		assert.equal(notion.has("Runbook"), false);
		const again = await writeFixture(notion.client, renamed, notion.map, { now, mayTrash: () => true });
		assert.deepEqual({ ...counts(again), trashed: again.trashed, left: again.left }, { created: 0, updated: 0, unchanged: ALL, trashed: 0, left: 0 });
	});

	test("a note whose new type has a different place: the old page goes to Trash, and the note is made in the new place", async () => {
		const notion = fakeNotion();
		await writeFixture(notion.client, SPEC, notion.map, { now });
		const looseId = notion.pageOf("Loose Draft").id;
		const moved = withNote("Loose Draft", (n) => ({ ...n, type: "Reference", fields: { date: "2026-01-05", description: "A draft", tags: ["reference"] } }));
		const result = await writeFixture(notion.client, moved, notion.map, { now, mayTrash: () => true });
		assert.deepEqual({ ...counts(result), trashed: result.trashed }, { created: 1, updated: 0, unchanged: ALL - 1, trashed: 1 });
		assert.equal(notion.pages.has(looseId), false);
		assert.equal(notion.pageOf("Loose Draft").database, "knowledge");

		const toPeople = withNote("Outage RCA", (n) => ({ ...n, type: "Person", fields: { date: "2026-01-05" } }));
		const second = await writeFixture(notion.client, toPeople, notion.map, { now, mayTrash: () => true });
		assert.equal(second.trashed, 2, "the row in Work, and the row that the first change put in Knowledge");
		assert.equal(notion.pageOf("Outage RCA").database, "people");
	});

	test("a note whose new type is in the same database keeps its row", async () => {
		const notion = fakeNotion();
		await writeFixture(notion.client, SPEC, notion.map, { now });
		const id = notion.pageOf("Ticket Links").id;
		const lines: string[] = [];
		const result = await writeFixture(notion.client, withNote("Ticket Links", (n) => ({ ...n, type: "Archive note" })), notion.map, { now, log: (line) => lines.push(line) });
		assert.deepEqual({ ...counts(result), trashed: result.trashed }, { created: 0, updated: 1, unchanged: ALL - 1, trashed: 0 });
		assert.deepEqual(lines, ["updated Ticket Links: Type"]);
		assert.equal(notion.pageOf("Ticket Links").id, id);
	});

	test("a row and a page of the setup that the spec does not have stay", async () => {
		const notion = fakeNotion();
		const result = await writeFixture(notion.client, SPEC, notion.map, { now });
		assert.equal(result.trashed, 0);
		assert.ok(notion.has("Key Decisions"));
		assert.ok(notion.has("Reader map"));
	});

	test("with no permission, a page of an earlier spec stays, and the run goes on", async () => {
		const notion = fakeNotion();
		await writeFixture(notion.client, SPEC, notion.map, { now });
		const before = notion.calls.length;
		const renamed = withNote("Runbook", (n) => ({ ...n, title: "Runbook 2" }));
		const lines: string[] = [];
		for (const hooks of [{}, { mayTrash: () => false }]) {
			const result = await writeFixture(notion.client, renamed, notion.map, { now, log: (line) => lines.push(line), ...hooks });
			assert.deepEqual({ trashed: result.trashed, left: result.left }, { trashed: 0, left: 1 });
		}
		assert.ok(notion.has("Runbook"));
		assert.ok(notion.has("Runbook 2"));
		assert.ok(lines.includes("left in place, row: Runbook (not a note of the spec, and not a page of this writer)"));
		assert.equal(notion.calls.slice(before).filter((call) => call.tool === "notion-delete-pages").length, 0);
	});

	test("with a ledger, only a page with a line of the tag of this writer goes to Trash", async () => {
		const dir = mkdtempSync(join(tmpdir(), "om-ledger-"));
		try {
			const path = join(dir, "created.jsonl");
			const notion = fakeNotion();
			await writeFixture(notion.client, SPEC, notion.map, { now, ...ledgerHooks(path, ["pr", "4b"]) });
			const foreignPage = "00000000-0000-0000-0000-0000000000f1";
			const foreignRow = "00000000-0000-0000-0000-0000000000f2";
			const unlistedRow = "00000000-0000-0000-0000-0000000000f3";
			notion.pages.set(foreignPage, { id: foreignPage, title: "pr05 live outbox write", database: undefined, properties: {}, content: "" });
			notion.pages.set(foreignRow, { id: foreignRow, title: "pr05 row", database: "work", properties: {}, content: "" });
			notion.pages.set(unlistedRow, { id: unlistedRow, title: "a row with no ledger line", database: "work", properties: {}, content: "" });
			appendFileSync(path, `{"id": "${foreignPage}", "kind": "page", "title": "pr05 live outbox write", "pr": 5, "at": "2026-11-25T14:54:44Z"}\n`);
			appendFileSync(path, `{"id": "${foreignRow}", "kind": "row", "title": "pr05 row", "pr": 5, "at": "2026-11-25T14:54:44Z"}\n`);

			const renamed = withNote("Runbook", (n) => ({ ...n, title: "Runbook 2" }));
			const result = await writeFixture(notion.client, renamed, notion.map, { now, ...ledgerHooks(path, ["pr", "4b"]) });
			assert.deepEqual({ created: result.created, trashed: result.trashed, left: result.left }, { created: 1, trashed: 1, left: 3 });
			assert.equal(notion.has("Runbook"), false, "the page of this writer goes");
			for (const id of [foreignPage, foreignRow, unlistedRow]) assert.ok(notion.pages.has(id), `${id} stays`);

			const untagged = await writeFixture(notion.client, SPEC, notion.map, { now, ...ledgerHooks(path) });
			assert.deepEqual({ trashed: untagged.trashed, left: untagged.left }, { trashed: 0, left: 4 }, "a ledger with no tag names no page of this writer");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("a page of a fixture note that the ledger lacks gets a line, and a row of the setup gets none", async () => {
		const dir = mkdtempSync(join(tmpdir(), "om-ledger-"));
		try {
			const path = join(dir, "created.jsonl");
			const notion = fakeNotion();
			await writeFixture(notion.client, SPEC, notion.map, { now });
			await writeFixture(notion.client, SPEC, notion.map, { now, ...ledgerHooks(path, ["pr", "4b"]) });
			const lines = readFileSync(path, "utf-8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, string>);
			assert.deepEqual(lines.map((line) => line["title"]).sort(), SPEC.notes.filter((n) => !["Home", "North Star", "Patterns", "Gotchas"].includes(n.title)).map((n) => n.title).sort());
			assert.ok(lines.every((line) => line["pr"] === "4b" && (line["kind"] === "row" || line["kind"] === "page")));
			await writeFixture(notion.client, SPEC, notion.map, { now, ...ledgerHooks(path, ["pr", "4b"]) });
			assert.equal(readFileSync(path, "utf-8").trim().split("\n").length, lines.length, "a second run adds no line");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("two rows with one title stop the run", async () => {
		const notion = fakeNotion();
		await writeFixture(notion.client, SPEC, notion.map, { now });
		const twin = notion.pageOf("Runbook");
		notion.pages.set("twin", { ...twin, id: "00000000-0000-0000-0000-00000000ffff" });
		await assert.rejects(writeFixture(notion.client, SPEC, notion.map, { now }), /two rows with the title "Runbook"/);
	});
});

describe("ledgerHooks", () => {
	test("writes one line for each page that a run makes or moves to Trash, and permits only a page with a line of its own tag", () => {
		const dir = mkdtempSync(join(tmpdir(), "om-ledger-"));
		try {
			const path = join(dir, "created.jsonl");
			appendFileSync(path, '{"id": "id-5", "kind": "page", "title": "pr05 page", "pr": 5, "at": "2026-11-25T14:54:44Z"}\nnot json\n');
			const hooks = ledgerHooks(path, ["pr", "4b"]);
			assert.equal(hooks.mayTrash?.("id-1"), false, "no line yet");
			hooks.onCreated?.("row", "id-1", "Runbook");
			hooks.onCreated?.("option", "id-db", "Work: 2 options");
			hooks.onExisting?.("row", "id-1", "Runbook");
			hooks.onExisting?.("page", "id-5", "pr05 page");
			hooks.onExisting?.("row", "id-2", "Found");
			hooks.onTrashed?.("row", "id-1", "Runbook");
			const lines = readFileSync(path, "utf-8").trim().split("\n").slice(2).map((line) => JSON.parse(line) as Record<string, string>);
			assert.deepEqual(lines.map(({ at: _at, ...rest }) => rest), [
				{ id: "id-1", kind: "row", title: "Runbook", pr: "4b" },
				{ id: "id-db", kind: "option", title: "Work: 2 options", pr: "4b" },
				{ id: "id-2", kind: "row", title: "Found", pr: "4b" },
				{ id: "id-1", kind: "trashed_row", title: "Runbook", pr: "4b" },
			]);
			assert.deepEqual(["id-1", "id-2", "id-5", "id-db", "id-9"].map((id) => hooks.mayTrash?.(id)), [true, true, false, false, false]);
			assert.equal(ledgerHooks(path, ["pr", "5"]).mayTrash?.("id-5"), true, "the tag of the line is a number in the file of the other writer");
			assert.equal(ledgerHooks(path).mayTrash?.("id-1"), false, "no tag, no page of this writer");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("the environment names the ledger and its tag, and no variable gives no ledger", () => {
		assert.deepEqual(ledgerHooksOf({}), {});
		assert.deepEqual(ledgerHooksOf({ NOTION_LEDGER: "" }), {});
		assert.equal(typeof ledgerHooksOf({ NOTION_LEDGER: "/tmp/ledger.jsonl", NOTION_LEDGER_TAG: "pr=6" }).onCreated, "function");
	});
});
