/**
 * Process tests of validate-write.ts for a Notion write: the hook runs as
 * `settings.json` runs it, with a payload on stdin. Its Notion calls go to
 * the stand-in runtime of `_fake-notion.ts`. The findings of each row are
 * in write-check.test.ts, and the proof on the real workspace is the
 * parity run.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NOTION_MAP_FILE } from "../lib/notion-map.ts";
import { OUTBOX_DIR, outboxCommand } from "../lib/notion-write.ts";
import { fakeMap, fakeNotion, fakeUrl, fetchedPage, type FakeCall, type FakeReplies } from "./_fake-notion.ts";
import { runScript, rmTemp, type RunResult } from "./_helpers.ts";

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "../validate-write.ts");

const MANIFEST = {
	open_loop_sections: ["action items"],
	frontmatter_required: { global: ["date", "description", "tags"], "work-note": ["date", "status", "quarter"] },
};
const { map, nextId } = fakeMap();
const LINK = `<mention url="${fakeUrl(nextId())}">Patterns</mention>`;
const GLOBAL = { "date:Date:start": "2026-01-05", Description: "A note", Tags: ["work-note"] };
const WORK = { parent: { data_source_id: map.databases.work.data_source }, allow_async: false };
const OK = JSON.stringify({ result: "ok" });
const LOOSE_ACTIVE = ["Billing Export Pipeline", "Search Ranking", "Login Latency", "Checkout Flow"];
const VIEW = JSON.stringify({ results: LOOSE_ACTIVE.map((Name) => ({ Name, url: fakeUrl(nextId()) })), has_more: false });

let TMP = "";
before(() => {
	TMP = mkdtempSync(join(tmpdir(), "validate-write-test-"));
});
after(() => {
	rmTemp(TMP);
});

type Context = { readonly additionalContext: string; readonly hookEventName: string; readonly policyResults?: readonly Record<string, unknown>[] };

interface Run extends RunResult {
	readonly context: Context | null;
	readonly calls: FakeCall[];
	readonly outboxExists: boolean;
}

interface WriteOptions {
	readonly tool?: string;
	readonly replies?: FakeReplies;
	/** The fields of the payload that replace the fields of a done write. */
	readonly payload?: Record<string, unknown>;
	readonly manifest?: unknown;
	readonly withoutMap?: true;
}

/** Run the hook for one Notion write with `args` in its outbox file. Each run has its own project directory. */
function write(args: unknown, stdout: unknown, options: WriteOptions = {}): Run {
	const project = mkdtempSync(join(TMP, "project-"));
	writeFileSync(join(project, "vault-manifest.json"), JSON.stringify(options.manifest ?? MANIFEST));
	if (!options.withoutMap) writeFileSync(join(project, NOTION_MAP_FILE), JSON.stringify(map));
	const outbox = `${OUTBOX_DIR}/note.json`;
	mkdirSync(join(project, OUTBOX_DIR), { recursive: true });
	writeFileSync(join(project, outbox), JSON.stringify(args));
	const fake = fakeNotion(join(project, "tools"), options.replies ?? { "notion-update-page": OK, "notion-query-data-sources": VIEW });
	const payload = {
		hook_event_name: "PostToolUse",
		cwd: project,
		tool_name: "Bash",
		tool_input: { command: outboxCommand(options.tool ?? "notion-create-pages", outbox) },
		tool_response: { stdout: typeof stdout === "string" ? stdout : JSON.stringify(stdout), stderr: "", interrupted: false },
		...options.payload,
	};
	const result = runScript(SCRIPT, payload, { CLAUDE_PROJECT_DIR: project, ...fake.env });
	return {
		...result,
		context: result.stdout === "" ? null : (JSON.parse(result.stdout) as { hookSpecificOutput: Context }).hookSpecificOutput,
		calls: fake.calls(),
		outboxExists: existsSync(join(project, outbox)),
	};
}

const made = (...ids: string[]) => ({ pages: ids.map((id) => ({ id, url: `${fakeUrl(id)}?pvs=204` })) });
const workNote = (properties: Record<string, unknown>, content = `See ${LINK}.`) => ({ properties: { ...GLOBAL, Type: "Work note", Status: "completed", Quarter: "Q1-2026", ...properties }, content });
const create = (page: unknown, options: WriteOptions = {}, id = nextId()): Run => write({ ...WORK, pages: [page] }, made(id), options);
const updates = (run: Run): FakeCall[] => run.calls.filter(({ tool }) => tool === "notion-update-page");

describe("validate-write: a note with no finding", () => {
	test("a row with each required property and a link prints nothing, sets the derived properties in one call, and deletes the outbox file", () => {
		const id = nextId();
		const run = create(workNote({ Name: "Clean Note" }, `- [ ] One task\n\nSee ${LINK}.`), {}, id);
		assert.deepEqual([run.code, run.stdout, run.stderr], [0, "", ""]);
		assert.equal(run.calls.length, 1);
		const { page_id: page, command, properties } = updates(run)[0]!.args as { page_id: string; command: string; properties: Record<string, unknown> };
		assert.deepEqual([page, command], [id, "update_properties"]);
		assert.equal(properties["Open tasks"], 1);
		assert.equal(properties["Open loops"], 0);
		assert.equal(typeof properties["Bytes"], "number");
		assert.equal(properties["date:Changed:start"], properties["date:Hook stamp:start"]);
		assert.ok(Math.abs(Date.parse(String(properties["date:Hook stamp:start"])) - Date.now()) < 60_000);
		assert.equal(run.outboxExists, false);
	});
});

describe("validate-write: the findings of a Notion write", () => {
	test("a row with empty required properties gets one warning block with one line for each property (VW-08, VW-09, VW-13)", () => {
		const run = create({ properties: { Name: "Sparse", Type: "Work note", "date:Date:start": "2026-01-05" }, content: `See ${LINK}.` });
		assert.equal(
			run.context?.additionalContext,
			[
				"Workspace hygiene warnings for `Sparse`:",
				"  - The property `Description` is empty (~150 chars required by vault convention)",
				"  - The property `Tags` is empty",
				"  - The property `Status` is empty (required by vault-manifest.json frontmatter_required)",
				"  - The property `Quarter` is empty (required by vault-manifest.json frontmatter_required)",
				"Fix these before moving on.",
			].join("\n"),
		);
		assert.equal(run.outboxExists, false);
	});

	test("the typed fields come from the manifest of the project (VW-09)", () => {
		const manifest = { frontmatter_required: { "work-note": ["owner"] } };
		const run = create(workNote({ Name: "Owned" }), { manifest });
		assert.match(run.context?.additionalContext ?? "", /The property `Owner` is empty \(required by vault-manifest\.json frontmatter_required\)/);
	});

	test("a page under the root page gets the finding that it is not a row, and no update call (VW-07)", () => {
		const run = write({ parent: { page_id: map.root.id }, allow_async: false, pages: [{ properties: { title: "Draft" }, content: `See ${LINK}.` }] }, made(nextId()));
		assert.equal(run.context?.additionalContext, "Workspace hygiene warnings for `Draft`:\n  - The page is not a row of a note database\nFix these before moving on.");
		assert.deepEqual(run.calls, []);
		assert.equal(run.outboxExists, false);
	});

	test("a long row with no link gets the link finding, and a short one does not (VW-10)", () => {
		const long = create(workNote({ Name: "Long" }, "A sentence with no link in it. ".repeat(20)));
		assert.match(long.context?.additionalContext ?? "", /No mentions or relations found/);
		assert.equal(create(workNote({ Name: "Short" }, "Short.")).stdout, "");
	});

	test("a ticket ID in a link gets the finding and the policy result of the page (VW-12)", () => {
		const id = nextId();
		const run = create(workNote({ Name: "Tickets" }, `See [[PROJ-123]] and ${LINK}.`), {}, id);
		assert.match(run.context?.additionalContext ?? "", /1 ticket-ID wikilink\(s\)/);
		assert.deepEqual(run.context?.policyResults, [{ policy_id: "phantom-edge", path: fakeUrl(id), classification: "ticket-id-wikilink", action: "warn" }]);
	});

	test("a loose active row that joins a topic cluster reads the view one time and gets the hint (VW-15)", () => {
		const run = create(workNote({ Name: "Billing Retry Design", Status: "active" }));
		assert.match(run.context?.additionalContext ?? "", /^🗂️ {2}This note joins 1 active row\(s\) with no `Project` sharing "billing": Billing Export Pipeline, Billing Retry Design\./);
		const queries = run.calls.filter(({ tool }) => tool === "notion-query-data-sources");
		assert.deepEqual(queries.map(({ args }) => args), [{ data: { mode: "view", view_url: map.databases.work.views["Hygiene: loose active"], page_size: 100 } }]);
	});

	test("a row that is not loose and active makes no query of the view", () => {
		for (const properties of [{ Status: "completed" }, { Status: "active", Project: "Billing" }]) {
			const run = create(workNote({ Name: "Billing Retry Design", ...properties }));
			assert.deepEqual(run.calls.map(({ tool }) => tool), ["notion-update-page"], JSON.stringify(properties));
		}
	});

	test("two notes of one call give one envelope, one update for each row, and equal blocks one time (VW-16)", () => {
		const ids = [nextId(), nextId()];
		const pages = [workNote({ Name: "Billing Retry Design", Status: "active" }), workNote({ Name: "Billing Export Pipeline", Status: "active", Description: "" })];
		const run = write({ ...WORK, pages }, made(...ids));
		const blocks = (run.context?.additionalContext ?? "").split("\n\n");
		assert.equal(blocks.filter((block) => block.startsWith("🗂️")).length, 1);
		assert.equal(blocks.filter((block) => block.startsWith("Workspace hygiene warnings for `Billing Export Pipeline`")).length, 1);
		assert.deepEqual(updates(run).map(({ args }) => args["page_id"]).sort(), [...ids].sort());
		assert.deepEqual((run.context?.policyResults ?? []).map(({ path }) => path).sort(), ids.map(fakeUrl).sort());
	});

	test("the envelope names the event of the payload, and PostToolUse when the payload names none (VW-17)", () => {
		const sparse = { properties: { Name: "Sparse", Type: "Work note" }, content: "x" };
		assert.equal(create(sparse, { payload: { hook_event_name: "CustomEvent" } }).context?.hookEventName, "CustomEvent");
		assert.equal(create(sparse, { payload: { hook_event_name: undefined } }).context?.hookEventName, "PostToolUse");
	});
});

describe("validate-write: the pages that get no check (VW-04, VW-05)", () => {
	const long = "A sentence with no link in it. ".repeat(20);

	test("a template row and a thinking note print nothing, and a work note with the same body gets its findings", () => {
		const template = write({ parent: { data_source_id: map.databases.templates.data_source }, allow_async: false, pages: [{ properties: { Name: "Work Note" }, content: long }] }, made(nextId()));
		const thinking = create({ properties: { Name: "A thought", Type: "Thinking" }, content: long });
		assert.deepEqual([template.stdout, thinking.stdout], ["", ""]);
		assert.equal(updates(thinking).length, 1);
		assert.notEqual(create({ properties: { Name: "A note", Type: "Work note" }, content: long }).stdout, "");
	});

	test("a page under a page that the root does not hold prints nothing, and the same page under the root gets the finding", () => {
		const id = nextId();
		const parent = nextId();
		const args = { parent: { page_id: parent }, allow_async: false, pages: [{ properties: { title: "Draft" }, content: long }] };
		const fetched = (under: readonly { id: string; title: string }[]): FakeReplies => ({
			"notion-fetch": { byId: { [id]: fetchedPage({ id, title: "Draft", properties: { title: "Draft" }, content: long, under }) } },
		});
		const outside = write(args, made(id), { replies: fetched([{ id: parent, title: "Private" }]) });
		const inside = write(args, made(id), { replies: fetched([{ id: parent, title: "Drafts" }, { id: map.root.id, title: "root" }]) });
		assert.equal(outside.stdout, "");
		assert.match(inside.context?.additionalContext ?? "", /The page is not a row of a note database/);
		assert.deepEqual([outside.calls.length, inside.calls.length], [1, 1]);
	});

	test("a write tool that writes no note content prints nothing, makes no Notion call, and deletes the outbox file", () => {
		for (const tool of ["notion-delete-pages", "notion-create-view", "notion-update-data-source"]) {
			const run = write({ page_ids: [nextId()] }, {}, { tool });
			assert.deepEqual([run.stdout, run.calls.length, run.outboxExists], ["", 0, false], tool);
		}
	});

	test("a Bash command that is not a Notion write prints nothing and makes no Notion call", () => {
		for (const command of ["ls -la", "mcporter call notion.notion-fetch --args '{\"id\":\"x\"}'", "mcporter call jira.search query:x"]) {
			const run = write({}, {}, { payload: { tool_input: { command } } });
			assert.deepEqual([run.code, run.stdout, run.calls.length, run.outboxExists], [0, "", 0, true], command);
		}
	});
});

describe("validate-write: a partial update", () => {
	const id = nextId();
	const row = (content: string, properties: Record<string, unknown> = {}): FakeReplies => ({
		"notion-update-page": OK,
		"notion-fetch": {
			byId: { [id]: fetchedPage({ id, title: "Stored Note", properties: { Name: "Stored Note", Type: "Work note", ...GLOBAL, Status: "completed", Quarter: "Q1-2026", ...properties }, content, rowOf: map.databases.work, under: [map.root] }) },
		},
	});

	test("the page is fetched one time, and the findings are for the stored note and not for the part in the call", () => {
		const run = write({ page_id: id, command: "update_content", content_updates: [{ old_str: "a", new_str: "b" }] }, OK, { tool: "notion-update-page", replies: row("A paragraph that<br />continues here.\n\nSee \\[\\[OPS-9\\]\\].", { Quarter: "" }) });
		const context = run.context?.additionalContext ?? "";
		assert.match(context, /^Workspace hygiene warnings for `Stored Note`:/);
		assert.match(context, /The property `Quarter` is empty/);
		assert.match(context, /1 hard-wrapped paragraph line\(s\)/);
		assert.match(context, /1 ticket-ID wikilink\(s\)/);
		assert.deepEqual(run.calls.map(({ tool }) => tool), ["notion-fetch", "notion-update-page"]);
		assert.equal(run.outboxExists, false);
	});

	test("a change of a property of a person moves `Changed`, and a write of only derived properties does not", () => {
		const changed = (properties: Record<string, unknown>): boolean => {
			const run = write({ page_id: id, command: "update_properties", properties }, OK, { tool: "notion-update-page", replies: row(`See ${LINK}.`) });
			return "date:Changed:start" in (updates(run)[0]!.args["properties"] as Record<string, unknown>);
		};
		assert.equal(changed({ Status: "archived" }), true);
		assert.equal(changed({ Bytes: 12 }), false);
	});
});

describe("validate-write: a failed step", () => {
	test("a failed update of the derived properties adds a warning that names the note, keeps the findings, and deletes the outbox file", () => {
		const run = create({ properties: { Name: "Sparse", Type: "Work note" }, content: "x" }, { replies: { "notion-update-page": { error: JSON.stringify({ code: "validation_error", message: "bad property" }) } } });
		const context = run.context?.additionalContext ?? "";
		assert.match(context, /^Workspace hygiene warnings for `Sparse`:/);
		assert.match(context, /The derived properties of `Sparse` are not set \(.*bad property.*\)/);
		assert.equal(run.outboxExists, false);
	});

	test("a project with no map file says that the check did not run", () => {
		const run = create(workNote({ Name: "Clean" }), { withoutMap: true });
		assert.match(run.context?.additionalContext ?? "", /The write check did not run for notion-create-pages \(Cannot read the Notion map file/);
		assert.deepEqual(run.calls, []);
	});

	test("a failed cluster query costs only the cluster finding", () => {
		const run = create({ properties: { Name: "Billing Retry Design", Type: "Work note", Status: "active" }, content: "x" }, { replies: { "notion-update-page": OK } });
		const context = run.context?.additionalContext ?? "";
		assert.match(context, /The property `Quarter` is empty/);
		assert.doesNotMatch(context, /This note joins/);
		assert.equal(updates(run).length, 1);
	});
});

describe("validate-write: a failed write (PostToolUseFailure)", () => {
	const failed = { hook_event_name: "PostToolUseFailure", tool_response: undefined, error: "Exit code 1" };
	const select = (type: string, names: readonly string[]) => ({ type, options: names.map((name) => ({ name, color: "default" })) });
	const database = (options: readonly string[]): string =>
		[
			`<database url="${map.databases.work.url}">`,
			"The title of this Database is: Work",
			`<data-source url="${map.databases.work.data_source}">`,
			"<data-source-state>",
			JSON.stringify({
				schema: {
					Quarter: select("select", options),
					Tags: select("multi_select", ["work-note"]),
					Type: select("select", ["Work note"]),
					Status: select("select", ["completed"]),
				},
			}),
			"</data-source-state>",
			"</data-source>",
			"</database>",
		].join("\n");
	const replies = (options: readonly string[]): FakeReplies => ({ "notion-fetch": { byId: { [map.databases.work.id]: database(options) } }, "notion-update-data-source": OK });

	test("a select value that the schema lacks is added, the hook says to run the command again, and the outbox file stays", () => {
		const run = create(workNote({ Name: "New Quarter", Quarter: "Q1-2027" }), { payload: failed, replies: replies(["Q1-2026"]) });
		assert.equal(run.context?.hookEventName, "PostToolUseFailure");
		assert.equal(run.context?.additionalContext, "The database `Work` now has 1 new select option(s) that this write needs. Run the same command again.");
		const [update] = run.calls.filter(({ tool }) => tool === "notion-update-data-source");
		assert.equal(update?.args["data_source_id"], map.databases.work.data_source);
		assert.match(String(update?.args["statements"]), /ALTER COLUMN "Quarter" SET .*Q1-2027/);
		assert.equal(run.outboxExists, true);
	});

	test("a failed write whose select values are all in the schema prints nothing, changes no schema, and leaves the outbox file", () => {
		const run = create(workNote({ Name: "Known Quarter", Quarter: "Q1-2026" }), { payload: failed, replies: replies(["Q1-2026"]) });
		assert.deepEqual([run.stdout, run.calls.map(({ tool }) => tool), run.outboxExists], ["", ["notion-fetch"], true]);
	});

	test("a failed write to a page that is not a row makes no Notion call", () => {
		const run = write({ parent: { page_id: map.root.id }, pages: [{ properties: { title: "Draft" } }] }, {}, { payload: failed });
		assert.deepEqual([run.stdout, run.calls.length, run.outboxExists], ["", 0, true]);
	});
});

describe("validate-write: performance", () => {
	test("a note of 1 MB gets its findings in under 500 ms", () => {
		const page = workNote({ Name: "Large" }, `${"word ".repeat(200_000)}\n\nSee ${LINK}.`);
		const started = performance.now();
		const run = create(page);
		const elapsed = performance.now() - started;
		assert.match(run.context?.additionalContext ?? "", /^📐 `Large` is now \d+KB/);
		assert.ok(elapsed < 500, `validate-write took ${elapsed.toFixed(0)} ms`);
	});
});

describe("validate-write: robustness to bad input", () => {
	const silent = (stdin: string | object | null): void => {
		const result = runScript(SCRIPT, stdin, { CLAUDE_PROJECT_DIR: TMP });
		assert.deepEqual([result.code, result.stdout], [0, ""], JSON.stringify(stdin));
	};

	test("null tool_input", () => silent({ tool_name: "Bash", tool_input: null }));
	test("non-string command", () => silent({ tool_name: "Bash", tool_input: { command: 123 } }));
	test("invalid JSON", () => silent("not json"));
	test("empty object", () => silent({}));
	test("empty stdin", () => silent(null));

	test("an outbox file that is gone prints nothing and makes no Notion call", () => {
		const run = write({}, made(nextId()), { payload: { tool_input: { command: outboxCommand("notion-create-pages", `${OUTBOX_DIR}/gone.json`) } } });
		assert.deepEqual([run.code, run.stdout, run.calls.length], [0, "", 0]);
	});

	test("an outbox file that is not a JSON object prints nothing", () => {
		assert.deepEqual([write("text", made(nextId())).stdout, write([1], made(nextId())).stdout], ["", ""]);
	});

	test("a reply with fewer pages than the call says that the check did not run, so no note gets a wrong ID", () => {
		const run = write({ ...WORK, pages: [workNote({ Name: "One" }), workNote({ Name: "Two" })] }, made(nextId()));
		assert.match(run.context?.additionalContext ?? "", /The write check did not run for notion-create-pages \(The reply of notion-create-pages names 1 pages for 2 pages/);
		assert.deepEqual(run.calls, []);
	});
});
