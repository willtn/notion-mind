/**
 * From a hook payload to the written notes (lib/notion-written.ts), and
 * the fetch reply that a partial update reads (lib/notion-parse.ts).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { noteMarkdown } from "../lib/notion-note.ts";
import { derivedUpdate } from "../lib/write-check.ts";
import { parseNotePage, type NotePage } from "../lib/notion-parse.ts";
import { OUTBOX_DIR, outboxCommand } from "../lib/notion-write.ts";
import { notionCall, placeOf, selectValues, writtenForm, writtenNotes, type NotionCall } from "../lib/notion-written.ts";
import { fakeMap, fakeUrl, fetchedPage } from "./_fake-notion.ts";

const { map, nextId } = fakeMap();
const OUTBOX = `${OUTBOX_DIR}/note.json`;
const reply = (text: string) => ({ text, json: JSON.parse(text) as unknown });
const noFetch = async (): Promise<NotePage> => {
	throw new Error("this write must not fetch a page");
};

const payload = (tool: string, response: unknown, more: Record<string, unknown> = {}): Record<string, unknown> => ({
	hook_event_name: "PostToolUse",
	tool_name: "Bash",
	tool_input: { command: outboxCommand(tool, OUTBOX) },
	...(response === undefined ? {} : { tool_response: response }),
	...more,
});
const host = (args: unknown) => ({ readOutbox: (outbox: string) => (outbox === OUTBOX ? JSON.stringify(args) : null), runtimePaths: [] });
const stdout = (value: unknown) => ({ stdout: JSON.stringify(value), stderr: "", interrupted: false });

function created(args: Record<string, unknown>, pages: readonly { id: string }[]): NotionCall {
	const call = notionCall(payload("notion-create-pages", stdout({ pages: pages.map(({ id }) => ({ id, url: `${fakeUrl(id)}?pvs=204` })) })), host(args));
	assert.ok(call !== null);
	return call;
}

describe("the Notion write of a hook payload", () => {
	test("a done write has its tool, its arguments from the outbox file, and the reply", () => {
		const call = notionCall(payload("notion-create-pages", stdout({ pages: [] })), host({ pages: [] }));
		assert.deepEqual(call, { tool: "notion-create-pages", args: { pages: [] }, outbox: OUTBOX, outcome: "done", reply: { pages: [] }, error: "" });
	});

	test("a payload with no reply is a failed write, with the error text of the shell", () => {
		const call = notionCall(payload("notion-create-pages", undefined, { hook_event_name: "PostToolUseFailure", error: "Exit code 1" }), host({}));
		assert.equal(call?.outcome, "failed");
		assert.equal(call?.error, "Exit code 1");
	});

	test("an interrupted call is not a done write", () => {
		assert.equal(notionCall(payload("notion-create-pages", { stdout: "", interrupted: true }), host({}))?.outcome, "failed");
	});

	test("a read, a command of a different tool, and a payload of a different shape give no write", () => {
		const read = { tool_name: "Bash", tool_input: { command: "mcporter call notion.notion-fetch --args '{\"id\":\"x\"}'" }, tool_response: stdout({}) };
		for (const input of [read, { tool_name: "Bash", tool_input: { command: "ls" } }, { tool_name: "Write", tool_input: { file_path: "a.md" } }, { tool_name: "Bash" }, null, "text"]) {
			assert.equal(notionCall(input, host({})), null, JSON.stringify(input));
		}
	});

	test("a write whose outbox file is gone gives no write, because the arguments are unknown", () => {
		assert.equal(notionCall(payload("notion-create-pages", stdout({ pages: [] })), { readOutbox: () => null, runtimePaths: [] }), null);
	});
});

describe("the notes of a create call", () => {
	const page = (title: string, content = "Body") => ({ properties: { Name: title, Type: "Work note" }, content });

	/** A fetch that answers with the stored page of each created ID. `stored` is the body as Notion keeps it. */
	const storing = (pages: ReadonlyMap<string, { title: string; stored: string }>, where: { rowOf?: typeof map.databases.work; under: readonly { id: string; title: string }[] }) => {
		const asked: string[] = [];
		const fetchPage = async (id: string): Promise<NotePage> => {
			asked.push(id);
			const found = pages.get(id);
			if (found === undefined) throw new Error(`no page ${id}`);
			return parseNotePage(reply(fetchedPage({ id, title: found.title, properties: { Name: found.title, Type: "Work note" }, content: found.stored, ...where })));
		};
		return { fetchPage, asked };
	};
	const inWork = { rowOf: map.databases.work, under: [map.root] };

	test("each page of the reply is fetched, and each note has the stored page with the ID of the reply in the same position", async () => {
		const ids = [nextId(), nextId()];
		const call = created({ parent: { data_source_id: map.databases.work.data_source }, pages: [page("One"), page("Two", "Second")] }, ids.map((id) => ({ id })));
		const { fetchPage, asked } = storing(new Map([[ids[0]!, { title: "One", stored: "Body" }], [ids[1]!, { title: "Two", stored: "Second" }]]), inWork);
		const notes = await writtenNotes(call, map, fetchPage);
		assert.deepEqual(
			notes.map(({ id, url, title, place, body, changed }) => ({ id, url, title, place, body, changed })),
			[
				{ id: ids[0], url: fakeUrl(ids[0]!), title: "One", place: { kind: "row", database: "work" }, body: "Body\n", changed: true },
				{ id: ids[1], url: fakeUrl(ids[1]!), title: "Two", place: { kind: "row", database: "work" }, body: "Second\n", changed: true },
			],
		);
		assert.deepEqual(asked, ids);
	});

	test("the note is the stored body and not the outbox content, so a leading title heading is not in the body", async () => {
		const id = nextId();
		const call = created({ parent: { data_source_id: map.databases.work.data_source }, pages: [page("Moved", "# Moved\n\nText with **bold**.\n")] }, [{ id }]);
		const { fetchPage } = storing(new Map([[id, { title: "Moved", stored: "Text with <b>bold</b>.\n" }]]), inWork);
		const [note] = await writtenNotes(call, map, fetchPage);
		assert.equal(note?.body, "Text with <b>bold</b>.\n\n");
	});

	test("a data source with no scheme and a database ID name the same database", async () => {
		for (const parent of [{ data_source_id: map.databases.people.data_source.replace("collection://", "") }, { database_id: map.databases.people.id }]) {
			const id = nextId();
			const { fetchPage } = storing(new Map([[id, { title: "Ada", stored: "Body" }]]), { rowOf: map.databases.people, under: [map.root] });
			const [note] = await writtenNotes(created({ parent, pages: [page("Ada")] }, [{ id }]), map, fetchPage);
			assert.deepEqual(note?.place, { kind: "row", database: "people" }, JSON.stringify(parent));
		}
	});

	test("a page under the root page or under a page of the setup is a page outside the databases", async () => {
		for (const parent of [map.root.id, map.pages.home.id]) {
			const id = nextId();
			const { fetchPage } = storing(new Map([[id, { title: "Draft", stored: "Body" }]]), { under: [{ id: parent, title: "Above" }, map.root] });
			const [note] = await writtenNotes(created({ parent: { page_id: parent }, pages: [{ properties: { title: "Draft" }, content: "Body" }] }, [{ id }]), map, fetchPage);
			assert.deepEqual([note?.place, note?.title], [{ kind: "page" }, "Draft"]);
		}
	});

	test("a page under a page that the map does not name has its ancestors give the place", async () => {
		const id = nextId();
		const parent = nextId();
		const call = created({ parent: { page_id: parent }, pages: [{ properties: { title: "Draft" }, content: "Body" }] }, [{ id }]);
		const placeUnder = async (ancestors: readonly { id: string; title: string }[]) => (await writtenNotes(call, map, storing(new Map([[id, { title: "Draft", stored: "Body" }]]), { under: ancestors }).fetchPage))[0]?.place;
		assert.deepEqual(await placeUnder([{ id: parent, title: "Drafts" }, { id: map.root.id, title: "root" }]), { kind: "page" });
		assert.deepEqual(await placeUnder([{ id: parent, title: "Private" }]), { kind: "outside" });
	});

	test("a call with no parent writes outside the root", async () => {
		const id = nextId();
		const { fetchPage } = storing(new Map([[id, { title: "Private", stored: "" }]]), { under: [{ id: nextId(), title: "Private root" }] });
		const [note] = await writtenNotes(created({ pages: [{ properties: { title: "Private" } }] }, [{ id }]), map, fetchPage);
		assert.deepEqual(note?.place, { kind: "outside" });
	});

	test("a reply with a different number of pages is an error, so no note gets the ID of a different page", async () => {
		const call = created({ parent: { data_source_id: map.databases.work.data_source }, pages: [page("One"), page("Two")] }, [{ id: nextId() }]);
		await assert.rejects(writtenNotes(call, map, noFetch), /names 1 pages for 2 pages/);
	});

	test("a fetch that fails is an error of the write check and not a note from the outbox content", async () => {
		const call = created({ parent: { data_source_id: map.databases.work.data_source }, pages: [page("One")] }, [{ id: nextId() }]);
		await assert.rejects(writtenNotes(call, map, async () => Promise.reject(new Error("no reply"))), /no reply/);
	});
});

describe("one note has one size after a create and after an update", () => {
	const id = nextId();
	const title = "Same Note";
	const stored = "A line that<br />continues. See <mention url=\"" + fakeUrl(nextId()) + "\">Patterns</mention>.\n\n- [ ] One task\n";
	const properties = { Name: title, Type: "Work note", Status: "active", Tags: ["work-note"], "date:Date:start": "2026-01-05", Description: "A note" };
	const fetchRow = async (): Promise<NotePage> => parseNotePage(reply(fetchedPage({ id, title, properties, content: stored, rowOf: map.databases.work, under: [map.root] })));
	const sections = /^$/;

	const bytesAfter = async (call: NotionCall): Promise<unknown> => {
		const [note] = await writtenNotes(call, map, fetchRow);
		assert.ok(note !== undefined);
		return (derivedUpdate(note, sections, new Date(0))?.["properties"] as Record<string, unknown>)["Bytes"];
	};

	test("a create whose outbox content opens with the title heading and an update of one property give the same Bytes, and the same stored size", async () => {
		const create = created({ parent: { data_source_id: map.databases.work.data_source }, pages: [{ properties, content: `# ${title}\n\nA line that\ncontinues. See <mention url="x">Patterns</mention>.\n\n- [ ] One task\n` }] }, [{ id }]);
		const update = notionCall(payload("notion-update-page", stdout({ result: "ok" })), host({ page_id: id, command: "update_properties", properties: { Status: "completed" } }));
		assert.ok(update !== null);
		const afterCreate = await bytesAfter(create);
		assert.equal(afterCreate, await bytesAfter(update));
		const [note] = await writtenNotes(create, map, fetchRow);
		assert.equal(afterCreate, Buffer.byteLength(noteMarkdown(note!), "utf-8"));
	});
});

describe("the note of an update call", () => {
	const id = nextId();
	const properties = { Name: "Billing Retry Design", Type: "Work note", Status: "active", Tags: ["work-note"], "date:Date:start": "2026-01-05", Description: "The retry rules", Role: "" };
	const content = `# Billing Retry Design\n\nA line that<br />continues. See <mention url="${fakeUrl(nextId())}">Patterns</mention> and \\[\\[OPS-9\\]\\].`;
	const fetchRow = async (): Promise<NotePage> => parseNotePage(reply(fetchedPage({ id, title: "Billing Retry Design", properties, content, rowOf: map.databases.work, under: [map.root] })));
	const update = (args: Record<string, unknown>): NotionCall => {
		const call = notionCall(payload("notion-update-page", stdout({ result: "ok" })), host({ page_id: id, ...args }));
		assert.ok(call !== null);
		return call;
	};

	test("the page is fetched, and the note has the stored properties and the body in the form that a write sends", async () => {
		const [note] = await writtenNotes(update({ command: "update_content", content_updates: [] }), map, fetchRow);
		assert.ok(note !== undefined);
		assert.deepEqual([note.id, note.title, note.place], [id, "Billing Retry Design", { kind: "row", database: "work" }]);
		assert.equal(
			noteMarkdown(note),
			"---\ndate: 2026-01-05\ndescription: The retry rules\ntags:\n  - work-note\nstatus: active\n---\n\n# Billing Retry Design\n\nA line that\ncontinues. See [[Patterns]] and [[OPS-9]].\n",
		);
	});

	test("a change of the body or of a property of a person is a change of the note", async () => {
		for (const args of [{ command: "replace_content", new_str: "x" }, { command: "insert_content" }, { command: "update_properties", properties: { Status: "completed" } }, { command: "update_properties", properties: { "date:Date:start": "2026-02-01" } }]) {
			assert.equal((await writtenNotes(update(args), map, fetchRow))[0]?.changed, true, JSON.stringify(args));
		}
	});

	test("a write of only derived properties is not a change of the note", async () => {
		for (const properties of [{ Bytes: 10, "Open tasks": 0 }, { "date:Hook stamp:start": "2026-01-05T00:00:00.000Z", "date:Changed:start": "2026-01-05T00:00:00.000Z" }]) {
			assert.equal((await writtenNotes(update({ command: "update_properties", properties }), map, fetchRow))[0]?.changed, false, JSON.stringify(properties));
		}
	});

	test("a tool that writes no note content gives no note and no fetch", async () => {
		for (const tool of ["notion-delete-pages", "notion-create-view", "notion-update-data-source", "notion-create-comment"]) {
			const call = notionCall(payload(tool, stdout({})), host({ page_ids: [id] }));
			assert.ok(call !== null);
			assert.deepEqual(await writtenNotes(call, map, noFetch), [], tool);
		}
	});
});

describe("the place of a fetched page", () => {
	const page = (id: string) => ({ id });

	test("a row of a database of the map, by its data source", () => {
		assert.deepEqual(placeOf(page(nextId()), { dataSource: map.databases.knowledge.data_source, ids: [map.databases.knowledge.id, map.root.id] }, map), { kind: "row", database: "knowledge" });
	});

	test("a row of a database that the map does not name is a page under the root, or outside it", () => {
		const other = `collection://${nextId()}`;
		assert.deepEqual(placeOf(page(nextId()), { dataSource: other, ids: [nextId(), map.root.id] }, map), { kind: "page" });
		assert.deepEqual(placeOf(page(nextId()), { dataSource: other, ids: [nextId()] }, map), { kind: "outside" });
	});

	test("a page of the setup under the root", () => {
		assert.deepEqual(placeOf(page(map.pages.home.id), { dataSource: undefined, ids: [map.root.id] }, map), { kind: "scaffold" });
	});
});

describe("a fetch reply as a note page", () => {
	test("a row has its properties, its data source, and each page and database above it", () => {
		const id = nextId();
		const page = parseNotePage(reply(fetchedPage({ id, title: "A Row", properties: { Name: "A Row", Tags: ["a"] }, content: "Body", rowOf: map.databases.work, under: [map.root] })));
		assert.deepEqual(page.properties, { Name: "A Row", Tags: ["a"] });
		assert.deepEqual(page.ancestors, { dataSource: map.databases.work.data_source, ids: [map.databases.work.id, map.root.id] });
		assert.equal(page.content.trim(), "Body");
	});

	test("a page under a page has no data source, and its parent is the first ancestor", () => {
		const page = parseNotePage(reply(fetchedPage({ id: nextId(), title: "Draft", properties: { title: "Draft" }, content: "", under: [map.root] })));
		assert.deepEqual(page.ancestors, { dataSource: undefined, ids: [map.root.id] });
	});

	test("properties that are not JSON are an error at this boundary", () => {
		const text = fetchedPage({ id: nextId(), title: "Bad", properties: {}, content: "", under: [map.root] }).replace("{}", "{not json");
		assert.throws(() => parseNotePage(reply(text)), /the properties of a page/);
	});
});

describe("fetched content in the form that a write sends", () => {
	test("a break in a paragraph is a line break, and an escaped character has no backslash", () => {
		assert.equal(writtenForm("one<br />two<br>three \\[\\[A\\]\\] \\^id \\| x"), "one\ntwo\nthree [[A]] ^id | x");
	});
});

describe("the select values of a write", () => {
	const selects = ["Quarter", "Tags", "Status"];

	test("each page of a create call gives its values, each one time", () => {
		const call = created({ pages: [{ properties: { Quarter: "Q1-2027", Tags: ["a", "b"], Name: "x" } }, { properties: { Quarter: "Q1-2027", Tags: '["b","c"]', Status: "" } }] }, [{ id: nextId() }, { id: nextId() }]);
		assert.deepEqual(selectValues(call, selects), { Quarter: ["Q1-2027"], Tags: ["a", "b", "c"] });
	});

	test("an update call gives the values of its properties", () => {
		const call = notionCall(payload("notion-update-page", undefined), host({ page_id: nextId(), command: "update_properties", properties: { Quarter: "Q2-2027" } }));
		assert.ok(call !== null);
		assert.deepEqual(selectValues(call, selects), { Quarter: ["Q2-2027"] });
	});
});
