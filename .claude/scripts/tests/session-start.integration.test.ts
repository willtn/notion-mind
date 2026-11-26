/**
 * Subprocess integration test for the SessionStart hook.
 *
 * Spawns the hook exactly the way the agent's settings.json would:
 * `node --disable-warning=ExperimentalWarning --experimental-strip-types
 * session-start.ts`, with the stand-in runtime of `_fake-notion.ts` in the
 * place of Notion. Locks the contracts the unit-level tests can't reach:
 *
 *  - Exit code 0 and one envelope, also with no map file and with a Notion
 *    read that fails.
 *  - stderr is silent — proves the warning-suppression flag is wired
 *    correctly on this hook.
 *  - stdout contains every required section header, in order, so a
 *    regression that drops a section is caught.
 *  - Each section shows the rows and the pages that the workspace holds.
 *  - The budget, the hook output cap, and the `om_mod` modes.
 *
 * The parity run on the real workspace is the live proof.
 */

import { test, describe, after, before } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { HOOK_OUTPUT_MAX_CHARS } from "../lib/hook-io.ts";
import { INJECTION_CEILING_BYTES, METER_HEADROOM } from "../lib/session-start.ts";
import { fakeUrl, readableWorkspace, rootContent, type FakeWorkspace } from "./_fake-notion.ts";
import { hookContext, runScript as spawnHook, rmTemp } from "./_helpers.ts";

/** The hook-path ceiling as the meter prints it, regex-escaped (derived: the envelope takes its share, #340). */
const CEILING_KB = (INJECTION_CEILING_BYTES / 1000).toFixed(1).replace(".", "\\.");

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(SCRIPT_DIR, "../session-start.ts");

let TMP_DIR = "";
let MINIMAL: FakeWorkspace;

before(() => {
	TMP_DIR = mkdtempSync(join(tmpdir(), "session-start-integration-"));
	MINIMAL = readableWorkspace(join(TMP_DIR, "minimal"));
});

// `rmTemp` retries — Node's documented Windows guard against transient
// `EBUSY` / `EPERM` on rmdir while a handle is still held — and then gives up
// quietly. The retries alone were not enough: #235 lost a green suite to an
// `EPERM` thrown out of this hook after the assertions had already passed.
after(() => rmTemp(TMP_DIR));

/** A new workspace in its own directory under `TMP_DIR`. */
let serial = 0;
const workspace = (manifest: Readonly<Record<string, unknown>> = {}): FakeWorkspace => readableWorkspace(join(TMP_DIR, `workspace-${serial++}`), manifest);

/**
 * A hook-path run (#340): its stdout is one JSON envelope, so `stdout` here is
 * the context it carried and `raw` what was printed. The cap applies to `raw`.
 */
const hookPath = (stdin: string | object, env: Record<string, string>) => {
	const r = spawnHook(SCRIPT, stdin, env);
	return { ...r, raw: r.stdout, stdout: hookContext(r.stdout) };
};
const runHook = () => hookPath("", MINIMAL.env);

const REQUIRED_SECTIONS = [
	"### Date",
	"### North Star (current goals)",
	"### Brain Topics (read on demand)",
	"### Recent Changes (last 48h)",
	"### Open Tasks",
	"### Active Work",
	"### Workspace Listing",
];

const lastLine = (stdout: string) => stdout.split("\n").filter((l) => l.trim() !== "").pop() ?? "";
const sectionOf = (stdout: string, header: string): string => stdout.split(`${header}\n`)[1]?.split("\n### ")[0] ?? "";
/** The listing is the last section of a clean workspace, so the meter line comes after it. */
const listingOf = (stdout: string): string => sectionOf(stdout, "### Workspace Listing").split("\n_context injected")[0] ?? "";

/** Rows of one database for its "Recently changed" view, which the listing and the recent changes read. */
const rows = (count: number, name: (index: number) => string, fields: Readonly<Record<string, unknown>> = {}): Record<string, unknown>[] =>
	Array.from({ length: count }, (_, index) => ({ Name: name(index), ...fields }));

describe("session-start — the hook path prints one JSON envelope (#340)", () => {
	// Claude Code takes context from hookSpecificOutput.additionalContext.
	test("stdout is exactly one SessionStart envelope, whose additionalContext carries the context and the meter", () => {
		const { raw, code } = runHook();
		assert.equal(code, 0);
		const parsed = JSON.parse(raw) as { hookSpecificOutput?: { hookEventName?: string; additionalContext?: string } };
		assert.deepEqual(Object.keys(parsed), ["hookSpecificOutput"]);
		assert.equal(parsed.hookSpecificOutput?.hookEventName, "SessionStart");
		const context = parsed.hookSpecificOutput?.additionalContext ?? "";
		assert.ok(context.includes("### Date"), "the context is inside the envelope");
		assert.match(lastLine(context), /^_context injected: /, "the meter closes the context");
	});

	test("an empty folder, with no map file and no manifest, still gets one well-formed envelope, and each part says that the hook did not read it", () => {
		const dir = mkdtempSync(join(tmpdir(), "session-start-empty-"));
		try {
			const { stdout, stderr, code } = hookPath({ source: "startup" }, { CLAUDE_PROJECT_DIR: dir });
			assert.equal(code, 0);
			assert.equal(stderr, "");
			assert.match(lastLine(stdout), /^_context injected: /);
			for (const header of REQUIRED_SECTIONS.slice(1)) assert.equal(sectionOf(stdout, header).trim(), "(not read: the hook cannot use the Notion map file)", header);
			assert.match(sectionOf(stdout, "### Workspace Hygiene (drift detected)"), /the Notion map file \(Cannot read the Notion map file/, "the cause is in the context one time");
		} finally {
			// rmTemp: a Windows handle can outlive the hook by a moment (#235).
			rmTemp(dir);
		}
	});

	test("deliver stays plain text: the mod writes it into an instruction file", () => {
		const { stdout, code } = spawnHook(SCRIPT, { source: "startup", om_mod: "deliver" }, MINIMAL.env);
		assert.equal(code, 0);
		assert.ok(stdout.startsWith("## Session Context"), "plain Markdown, not JSON");
		assert.throws(() => JSON.parse(stdout));
	});
});

describe("session-start — silence contract and structure", () => {
	test("exits 0 with empty stderr on a minimal workspace", () => {
		const { code, stderr } = runHook();
		assert.equal(code, 0);
		assert.equal(
			stderr,
			"",
			"hook must be silent on stderr — the --disable-warning=ExperimentalWarning flag in _helpers.ts is the regression guard for this contract",
		);
	});

	test("stdout contains every required section header in order", () => {
		const { stdout } = runHook();
		let cursor = 0;
		for (const header of REQUIRED_SECTIONS) {
			const idx = stdout.indexOf(header, cursor);
			assert.notEqual(
				idx,
				-1,
				`section "${header}" missing or out of order in hook output`,
			);
			cursor = idx + header.length;
		}
	});

	test("a workspace with no row and no task gives the empty text of each section, and no hygiene section", () => {
		const { stdout } = runHook();
		assert.equal(sectionOf(stdout, "### Brain Topics (read on demand)").trim(), "(none)");
		assert.equal(sectionOf(stdout, "### Recent Changes (last 48h)").trim(), "(no recent changes)");
		assert.equal(sectionOf(stdout, "### Open Tasks").trim(), "(no open tasks)");
		assert.equal(sectionOf(stdout, "### Active Work").trim(), "(none)");
		assert.ok(!stdout.includes("Hygiene"), "a clean workspace has no hygiene section");
	});

	test("the North Star section has the goals from Current Focus on, without the lines of the synced block and without a completed goal", () => {
		const ws = workspace();
		const content = [
			"An introduction.",
			"",
			"## Current Focus",
			"",
			'<synced-block url="https://app.notion.com/p/0#1">',
			"- Ship the billing export.",
			"- <s>Close the search migration.</s>",
			"  - A detail of the closed goal.",
			"</synced-block>",
			"",
			"## Shifts Log",
			"",
			"- An old shift.",
			"",
			"## Longer Term",
			"",
			"- Grow the platform team.",
		].join("\n");
		ws.setPage(ws.map.pages.north_star.id, "North Star", content);
		const star = sectionOf(hookPath({ source: "startup" }, ws.env).stdout, "### North Star (current goals)");
		assert.deepEqual(
			star.split("\n").filter((line) => line.trim() !== ""),
			["## Current Focus", "_(1 completed item hidden — full history in the North Star page)_", "- Ship the billing export.", "## Longer Term", "- Grow the platform team."],
		);
	});

	test("a brain topic row is in the brain index with its description, and in the listing with its group", () => {
		const ws = workspace();
		const topic = { Name: "Patterns", Type: "Brain topic", Description: "The patterns that repeat", "Has content": "__YES__" };
		const stub = { Name: "Gotchas", Type: "Brain topic", "Has content": "__NO__" };
		ws.setRows("knowledge", "Brain index", [topic, stub, { Name: "Memories", Type: "Brain topic", Description: "The index" }]);
		ws.setRows("knowledge", "Recently changed", [topic, stub]);
		const { stdout } = hookPath({ source: "startup" }, ws.env);
		assert.equal(sectionOf(stdout, "### Brain Topics (read on demand)").trim(), "- Gotchas — (no description) (empty)\n- Patterns — The patterns that repeat");
		assert.match(listingOf(stdout), /^Knowledge \/ Brain topic \/ Patterns$/m);
	});

	test("the active work has the titles of the loose active view, and the recent changes have the rows of the last 48 hours", () => {
		const ws = workspace();
		const hoursAgo = (hours: number): string => new Date(Date.now() - hours * 3_600_000).toISOString();
		ws.setRows("work", "Hygiene: loose active", [{ Name: "Billing Retry Design" }, { Name: "Audit Trail Schema" }]);
		ws.setRows("work", "Recently changed", [
			{ Name: "Audit Trail Schema", Type: "Work note", "date:Changed:start": hoursAgo(1) },
			{ Name: "Billing Retry Design", Type: "Work note", "date:Changed:start": hoursAgo(72) },
		]);
		ws.setRows("people", "Recently changed", [{ Name: "Ada Park", "date:Changed:start": hoursAgo(30) }]);
		const { stdout } = hookPath({ source: "startup" }, ws.env);
		assert.equal(sectionOf(stdout, "### Active Work").trim(), "Audit Trail Schema\nBilling Retry Design");
		assert.equal(sectionOf(stdout, "### Recent Changes (last 48h)").trim(), "Audit Trail Schema\nAda Park");
	});

	test("a part that Notion does not give says so in its section, and each other section stays", () => {
		const ws = workspace();
		ws.setRows("knowledge", "Brain index", { error: JSON.stringify({ code: "internal_error", message: "the view did not load" }) });
		ws.setRows("work", "Hygiene: loose active", [{ Name: "Audit Trail Schema" }]);
		const { stdout, stderr, code } = hookPath({ source: "startup" }, ws.env);
		assert.equal(code, 0);
		assert.equal(stderr, "");
		assert.match(sectionOf(stdout, "### Brain Topics (read on demand)"), /^\(not read: .*the view did not load/);
		assert.equal(sectionOf(stdout, "### Active Work").trim(), "Audit Trail Schema");
		assert.match(sectionOf(stdout, "### North Star (current goals)"), /- placeholder/);
	});

	test("the hook only reads: each call is a view query or a page fetch", () => {
		const ws = workspace();
		hookPath({ source: "startup" }, ws.env);
		assert.deepEqual([...new Set(ws.calls().map(({ tool }) => tool))].sort(), ["notion-fetch", "notion-query-data-sources"]);
	});
});

describe("session-start — openTasks aggregation", () => {
	test("emits a task under the title of its row, then the tasks of Home, and no checked task", () => {
		const ws = workspace();
		const id = "00000000-0000-4000-8000-00000000aaaa";
		ws.setRows("work", "Open tasks", [{ Name: "Project X", url: fakeUrl(id), "Open tasks": 1 }]);
		ws.setPage(id, "Project X", "## Tasks\n- [ ] do the thing\n- [x] already done\n");
		ws.setPage(ws.map.pages.home.id, "Home", "- [ ] plan the offsite\n");
		const { stdout, stderr, code } = hookPath({ source: "startup" }, ws.env);
		assert.equal(code, 0);
		assert.equal(stderr, "");
		assert.equal(sectionOf(stdout, "### Open Tasks").trim(), "Project X\n- [ ] do the thing\n\nHome\n- [ ] plan the offsite");
	});

	test("a task that Home only shows from the North Star page is not a task of Home", () => {
		const ws = workspace();
		ws.setPage(ws.map.pages.home.id, "Home", '## Current Focus\n\n<synced-block-reference url="https://app.notion.com/p/0#1">\n- [ ] a goal of the North Star\n</synced-block-reference>\n\n- [ ] plan the offsite\n');
		assert.equal(sectionOf(hookPath({ source: "startup" }, ws.env).stdout, "### Open Tasks").trim(), "Home\n- [ ] plan the offsite");
	});
});

/**
 * The eager layer must stay bounded as a workspace grows. These run against
 * a SEPARATE larger workspace so the fixtures above stay minimal.
 */
describe("session-start — listing collapse and injection budget", () => {
	let BIG: FakeWorkspace;
	let manifestPath = "";

	before(() => {
		BIG = workspace();
		manifestPath = join(BIG.root, "vault-manifest.json");
		// 40 rows of one kind — well past the default threshold.
		BIG.setRows("people", "Recently changed", rows(40, (i) => `Person ${String(i).padStart(2, "0")}`));
		// 3 rows — comfortably under it.
		BIG.setRows("teams", "Recently changed", rows(3, (i) => `Team ${i}`));
	});

	const withManifest = <T>(manifest: Readonly<Record<string, unknown>>, run: () => T): T => {
		writeFileSync(manifestPath, JSON.stringify(manifest));
		try {
			return run();
		} finally {
			writeFileSync(manifestPath, "{}");
		}
	};
	const runBig = () => hookPath("", BIG.env);

	test("a group over the threshold collapses; one under it stays expanded", () => {
		const { stdout, code, stderr } = runBig();
		assert.equal(code, 0);
		assert.equal(stderr, "");
		const listing = listingOf(stdout);
		assert.match(listing, /^People — 40 notes \(listing collapsed/m, "a group of 40 rows must fold to one count line");
		assert.doesNotMatch(listing, /Person 07/, "collapsed groups enumerate nothing");
		assert.match(listing, /^Teams \/ Team 1$/m, "a group of 3 rows stays expanded");
	});

	test("the listing has the note pages under the root page, and not the pages of the setup that hold no note text", () => {
		const ws = workspace();
		const draft = { url: fakeUrl("00000000-0000-4000-8000-00000000bbbb"), title: "Loose Draft" };
		ws.setPage(ws.map.root.id, ws.map.root.title, rootContent([...Object.values(ws.map.pages), draft]));
		assert.equal(listingOf(hookPath("", ws.env).stdout).trim(), "Home\nLoose Draft\nNorth Star");
	});

	test("no manifest budget → the hook output ceiling is the budget (#254)", () => {
		assert.match(lastLine(runBig().stdout), new RegExp(`^_context injected: \\d+\\.\\dkB / ${CEILING_KB}kB budget(?: — collapsed: [^_]+)?_$`));
	});

	test("a tight manifest budget degrades sections and NAMES them in the meter", () => {
		withManifest({ eager_layer_budget_bytes: 400 }, () => {
			const { stdout, code, stderr } = runBig();
			assert.equal(code, 0);
			assert.equal(stderr, "", "the budget must never break the silence contract");

			const last = lastLine(stdout);
			assert.match(
				last,
				/^_context injected: \d+\.\dkB \/ 0\.4kB budget — collapsed: .+_$/,
				`meter must report the ceiling and name what it dropped, got: ${last}`,
			);
			// The listing is the first thing surrendered.
			assert.match(last, /collapsed: Workspace Listing/);
			assert.match(listingOf(stdout), /Over budget/, "dropped body is a pointer, not silence");
			// Degrading is never truncation: the header survives so the session
			// knows the section exists and can go get it.
			assert.ok(stdout.includes("### Workspace Listing"));
			assert.ok(stdout.includes("### Date"), "load-bearing sections are untouched");
		});
	});

	test("a budget under the ceiling collapses nothing it does not need to and reports itself", () => {
		withManifest({ eager_layer_budget_bytes: 9_000 }, () => {
			assert.match(lastLine(runBig().stdout), /^_context injected: \d+\.\dkB \/ 9\.0kB budget_$/);
		});
	});

	test("a budget above the hook output cap is clamped, and the meter says so (#254)", () => {
		withManifest({ eager_layer_budget_bytes: 80_000 }, () => {
			assert.match(
				lastLine(runBig().stdout),
				new RegExp(`^_context injected: \\d+\\.\\dkB / ${CEILING_KB}kB budget \\(80\\.0kB configured, held under the hook output cap\\)(?: — collapsed: [^_]+)?_$`),
			);
		});
	});

	test("manifest threshold overrides the default", () => {
		withManifest({ listing_collapse_threshold: 2 }, () => {
			assert.match(listingOf(runBig().stdout), /^Teams — 3 notes \(listing collapsed/m, "a threshold of 2 must fold the group of 3 rows that the default kept");
		});
	});

	test("the watched types of the hygiene scan come from the manifest", () => {
		const ws = workspace();
		const old = new Date(Date.now() - 30 * 86_400_000).toISOString();
		ws.setRows("work", "Hygiene: open loops", [{ Name: "Vendor Review", Type: "Work note", "Open loops": 2, "date:Changed:start": old }]);
		assert.ok(!hookPath("", ws.env).stdout.includes("Vendor Review"), "a work note is not a watched type by default");
		writeFileSync(join(ws.root, "vault-manifest.json"), JSON.stringify({ open_loop_types: ["Work note"] }));
		assert.match(sectionOf(hookPath("", ws.env).stdout, "### Workspace Hygiene (drift detected)"), /Vendor Review \(30d, 2 open item\(s\)\)/);
	});
});

/**
 * Claude Code caps a hook's plain stdout at 10,000 characters; past it, the
 * session gets a file path and the first 2,000 characters (#254). The output
 * must fit whole, with the meter as its last line, whatever the workspace holds.
 */

/**
 * 240 rows in 24 groups, each under the listing-collapse threshold, so
 * nothing folds by count and the listing alone passes the hook cap. This is
 * the shape that reproduced #254.
 */
function largeWorkspace(manifest: Record<string, unknown> = {}): FakeWorkspace {
	const ws = workspace(manifest);
	const types = ["Brain topic", "Reference", "Domain note", "Event-log satellite"];
	const databases = [
		["knowledge", types],
		["perf_docs", ["PR evidence", "Review brief", "Review artifact", "Brag quarter"]],
		["work", ["Work note", "Decision", "Incident", "1:1"]],
	] as const;
	for (const [database, kinds] of databases) {
		ws.setRows(
			database,
			"Recently changed",
			kinds.flatMap((Type) => rows(10, (i) => `Example ${Type} note ${i} with a long title for the listing`, { Type, Status: "active" })),
		);
	}
	for (const database of ["people", "teams", "competencies"] as const) ws.setRows(database, "Recently changed", rows(10, (i) => `Example ${database} note ${i} with a long title for the listing`));
	for (const database of ["people", "teams", "competencies"] as const) ws.setRows(database, "Hygiene: oversized", []);
	return ws;
}

describe("session-start — the hook output cap", () => {
	const CAP = HOOK_OUTPUT_MAX_CHARS;

	test("an ordinary workspace of 150 rows in small groups fits, the listing degrading first", () => {
		const ws = largeWorkspace({ eager_layer_budget_bytes: 80_000 });
		const { stdout, raw, code, stderr } = hookPath("", ws.env);
		assert.equal(code, 0);
		assert.equal(stderr, "");
		assert.ok(raw.length <= CAP, `stdout is ${raw.length} characters`);
		assert.match(lastLine(stdout), /^_context injected: .* — collapsed: Workspace Listing_$/);
	});

	test("sections that never degrade cannot carry the output past the cap: it is cut, and the meter says so", () => {
		// Open tasks never degrade. Ten long ones are over the cap on their own,
		// with every degradable section already a pointer.
		const ws = workspace();
		const tasks = Array.from({ length: 10 }, (_, i) => `- [ ] task ${i} ${"x".repeat(1_500)}`).join("\n");
		ws.setPage(ws.map.pages.home.id, "Home", `${tasks}\n`);
		const { stdout, raw, code, stderr } = hookPath("", ws.env);
		assert.equal(code, 0);
		assert.equal(stderr, "");
		assert.ok(stdout.includes("task 0 "), "the fixture's tasks reached the output");
		assert.ok(raw.length <= CAP, `stdout is ${raw.length} characters`);
		assert.ok(stdout.includes("… (truncated to fit the hook output cap)"), "the cut is marked where it happened");
		assert.match(lastLine(stdout), /^_context injected: .* — truncated to fit the hook output cap_$/);
	});

	test("deliver holds sections that never degrade to its own budget, in bytes: cut, and the meter says so", () => {
		// Three bytes per character, so the output is under the budget in
		// characters and over it in bytes: a character count would pass it.
		const ws = workspace({ eager_layer_instruction_budget_bytes: 12_000 });
		const tasks = Array.from({ length: 10 }, (_, i) => `- [ ] task ${i} ${"界".repeat(500)}`).join("\n");
		ws.setPage(ws.map.pages.home.id, "Home", `${tasks}\n`);
		const { stdout, code, stderr } = spawnHook(SCRIPT, { source: "startup", om_mod: "deliver" }, ws.env);
		assert.equal(code, 0);
		assert.equal(stderr, "");
		assert.ok(stdout.includes("task 0 "), "the fixture's tasks reached the output");
		const bytes = Buffer.byteLength(stdout, "utf-8");
		assert.ok(bytes <= 12_000 + METER_HEADROOM, `stdout is ${bytes} bytes`);
		// Cut on a line boundary, so up to one task line (about 1.5 KB) short of the limit.
		assert.ok(bytes > 12_000 + METER_HEADROOM - 1_600, `the budget was used, not undercut: ${bytes} bytes`);
		assert.ok(!stdout.includes("�"), "no character was split");
		assert.ok(stdout.includes("… (truncated to fit the instruction budget)"), "the cut is marked where it happened");
		assert.match(lastLine(stdout), /^_context injected: .* \/ 12\.0kB budget( — collapsed: .*)? — truncated to fit the instruction budget_$/);
	});
});

/**
 * A Claude Code mod that delivers the eager layer itself passes `om_mod` on
 * the event (#264, lib/om-mod.ts). `standdown` must leave no trace at all;
 * `deliver` is the mod's own run, whose output becomes an instruction file:
 * always the full layer, held to its own budget, never cut to the hook cap.
 */
describe("session-start — om_mod (a Claude Code mod)", () => {
	test("standdown prints nothing and calls no Notion tool, yet still exports VAULT_PATH: only a hook process gets CLAUDE_ENV_FILE", () => {
		const ws = workspace();
		const envFile = join(TMP_DIR, "env-standdown.sh");
		writeFileSync(envFile, "");
		const { stdout, stderr, code } = spawnHook(SCRIPT, { source: "startup", om_mod: "standdown" }, { ...ws.env, CLAUDE_ENV_FILE: envFile });
		assert.equal(code, 0);
		assert.equal(stderr, "");
		assert.equal(stdout, "", "the mod delivers this event; the hook must add nothing");
		assert.deepEqual(ws.calls(), []);
		assert.match(readFileSync(envFile, "utf-8"), /VAULT_PATH/, "the mod's run cannot write the env file, so this run must");
	});

	test("without the flag the same run does write VAULT_PATH (the standdown check above can fail)", () => {
		const envFile = join(TMP_DIR, "env-plain.sh");
		writeFileSync(envFile, "");
		const { stdout } = hookPath({ source: "startup" }, { ...MINIMAL.env, CLAUDE_ENV_FILE: envFile });
		assert.ok(stdout.includes("### Date"));
		assert.match(readFileSync(envFile, "utf-8"), /VAULT_PATH/);
	});

	test("deliver is not cut to the hook-output cap: the layer arrives whole, against its own budget", () => {
		// Different values, so reading the wrong field cannot pass.
		const ws = largeWorkspace({ eager_layer_budget_bytes: 9_000, eager_layer_instruction_budget_bytes: 80_000 });
		const delivered = spawnHook(SCRIPT, { source: "startup", om_mod: "deliver" }, ws.env);
		assert.equal(delivered.code, 0);
		assert.equal(delivered.stderr, "");
		assert.ok(delivered.stdout.length > HOOK_OUTPUT_MAX_CHARS, `delivered ${delivered.stdout.length} characters`);
		assert.match(lastLine(delivered.stdout), /^_context injected: \d+\.\dkB \/ 80\.0kB budget_$/, "nothing collapsed, nothing clamped, meter last");
		assert.ok(delivered.stdout.includes("Work / Work note / Example Work note note 9 with a long title for the listing"), "the last listing entry is there");

		// The same workspace as hook output stays under the cap (#254), listing degraded.
		const hooked = hookPath({ source: "startup" }, ws.env);
		assert.ok(hooked.raw.length <= HOOK_OUTPUT_MAX_CHARS);
		assert.match(lastLine(hooked.stdout), /collapsed: Workspace Listing/);
	});

	test("deliver without a configured instruction budget uses the default", () => {
		const { stdout } = spawnHook(SCRIPT, { source: "startup", om_mod: "deliver" }, largeWorkspace().env);
		assert.match(lastLine(stdout), /\/ 20\.0kB budget/);
	});

	test("deliver is the full layer even on compact: an instruction file has no pointer mode", () => {
		const delivered = spawnHook(SCRIPT, { source: "compact", om_mod: "deliver" }, MINIMAL.env).stdout;
		assert.ok(delivered.includes("### Workspace Listing"));
		assert.ok(!delivered.includes("### Context Pointer"));
		const hooked = hookPath({ source: "compact" }, MINIMAL.env).stdout;
		assert.ok(hooked.includes("### Context Pointer"), "without the flag compact stays pointer mode");
	});

	test("the context after a resume or a compaction reads no North Star page, no brain index, and no root page", () => {
		for (const source of ["resume", "compact"]) {
			const ws = workspace();
			const { stdout } = hookPath({ source }, ws.env);
			assert.ok(stdout.includes("### Context Pointer") && !stdout.includes("### North Star"), source);
			const read = ws.calls().map(({ tool, args }) => (tool === "notion-fetch" ? String(args["id"]) : String((args["data"] as { view_url?: string }).view_url)));
			for (const part of [ws.map.pages.north_star.id, ws.map.root.id, ws.map.databases.knowledge.views["Brain index"]]) assert.ok(!read.includes(String(part)), `${source} read ${part}`);
			assert.ok(read.includes(ws.map.pages.home.id), "the tasks of Home are in each context");
		}
	});

	test("an unknown om_mod value changes nothing: output identical to a run with no flag", () => {
		const plain = hookPath({ source: "startup" }, MINIMAL.env);
		const unknown = hookPath({ source: "startup", om_mod: "silence" }, MINIMAL.env);
		assert.equal(unknown.code, 0);
		assert.equal(unknown.stdout, plain.stdout);
		assert.ok(plain.stdout.includes("### Date"));
	});

	test("standdown exits before every other side effect: it never reaches the project directory", () => {
		// Every side effect but the VAULT_PATH export (the reads) comes after the chdir into the project directory. A
		// missing directory makes that chdir throw, so only a run that left
		// before it exits clean.
		const missing = join(TMP_DIR, "no-such-vault");
		const plain = spawnHook(SCRIPT, { source: "startup" }, { CLAUDE_PROJECT_DIR: missing });
		assert.notEqual(plain.code, 0, "without the flag the run reaches the chdir and fails");
		const stood = spawnHook(SCRIPT, { source: "startup", om_mod: "standdown" }, { CLAUDE_PROJECT_DIR: missing });
		assert.equal(stood.code, 0);
		assert.equal(stood.stdout, "");
		assert.equal(stood.stderr, "");
	});
});
