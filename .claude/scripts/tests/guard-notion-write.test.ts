/**
 * Subprocess tests for guard-notion-write.ts: what Claude Code gets on stdout
 * for a PreToolUse payload.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OUTBOX_DIR, outboxCommand } from "../lib/notion-write.ts";
import { runScript, rmTemp } from "./_helpers.ts";
import { CAPTURED_POST_TOOL_USE, CAPTURED_PRE_TOOL_USE } from "./notion-write-payloads.ts";

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "../guard-notion-write.ts");
const CREATE = outboxCommand("notion-create-pages", `${OUTBOX_DIR}/note.json`);
const UPDATE = `mcporter call notion.notion-update-page --args '{"page_id":"<page-id>","command":"update_properties","properties":{"title":"A title"}}'`;

let project = "";
let elsewhere = "";

before(() => {
	project = realpathSync(mkdtempSync(join(tmpdir(), "guard-notion-write-")));
	elsewhere = mkdtempSync(join(tmpdir(), "guard-notion-write-elsewhere-"));
	mkdirSync(join(project, OUTBOX_DIR), { recursive: true });
	writeFileSync(join(project, OUTBOX_DIR, "note.json"), JSON.stringify({ allow_async: false, pages: [{ properties: { title: "A page" } }] }));
	writeFileSync(join(project, OUTBOX_DIR, "async.json"), JSON.stringify({ pages: [{ properties: { title: "A page" } }] }));
	writeFileSync(join(project, OUTBOX_DIR, "query.json"), JSON.stringify({ query: "north star" }));
});

after(() => {
	rmTemp(project);
	rmTemp(elsewhere);
});

const bash = (command: string, cwd: string = project): object => ({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, cwd });

/** The denial reason on stdout. The hook must exit 0, because Claude Code reads the JSON of a zero exit only. */
function denialOf(stdin: string | object | null, script: string = SCRIPT, env?: Readonly<Record<string, string>>): string {
	const run = runScript(script, stdin, env);
	assert.deepEqual({ code: run.code, stderr: run.stderr }, { code: 0, stderr: "" });
	const output = (JSON.parse(run.stdout) as { hookSpecificOutput: Record<string, unknown> }).hookSpecificOutput;
	assert.deepEqual(Object.keys(output), ["hookEventName", "permissionDecision", "permissionDecisionReason"]);
	assert.equal(output["hookEventName"], "PreToolUse");
	assert.equal(output["permissionDecision"], "deny");
	return String(output["permissionDecisionReason"]);
}

function assertSilent(stdin: string | object | null, env?: Readonly<Record<string, string>>): void {
	const run = runScript(SCRIPT, stdin, env);
	assert.deepEqual({ code: run.code, stdout: run.stdout, stderr: run.stderr }, { code: 0, stdout: "", stderr: "" });
}

describe("guard-notion-write, denials", () => {
	test("the captured PreToolUse payload is denied with the outbox form", () => {
		const reason = denialOf(CAPTURED_PRE_TOOL_USE);
		assert.ok(reason.includes(`mcporter call notion.notion-create-pages --args "$(cat ${OUTBOX_DIR}/<name>.json)"`), reason);
	});

	test("the command of the captured PostToolUse payload gets the same denial", () => {
		assert.equal(denialOf(CAPTURED_POST_TOOL_USE), denialOf(CAPTURED_PRE_TOOL_USE));
	});

	test("notion-create-pages without allow_async false is denied", () => {
		assert.match(denialOf(bash(outboxCommand("notion-create-pages", `${OUTBOX_DIR}/async.json`))), /"allow_async": false/);
	});

	test("an outbox file that is absent from the working directory of the payload is denied", () => {
		assert.match(denialOf(bash(CREATE, elsewhere)), /cannot read the outbox file/);
	});

	const BYPASSES: ReadonlyArray<readonly [string, string]> = [
		["a write that a here-document with no quotes runs", `cat <<EOF\n$(${UPDATE})\nEOF`],
		["a write in a here-document for a shell", `bash <<EOF\n${UPDATE}\nEOF`],
		["a write in a here-string for a shell", `bash <<< "${UPDATE}"`],
		["a write in a pipe to a shell", `echo "${UPDATE}" | sh`],
		["a write through xargs", `echo notion.notion-update-page | xargs -I{} mcporter call {} --args '{}'`],
		["a write with an ANSI-C quote", `mcporter call $'notion.notion-update-page' --args '{}'`],
		["a write with a flag value that looks like a subcommand", `mcporter --config auth call notion.notion-update-page --args '{}'`],
		["a write through the cli.js of a package", `node /usr/local/lib/node_modules/mcporter/dist/cli.js call notion.notion-update-page --args '{}'`],
		["a write through npx with a version", `npx -y mcporter@0.17.1 call notion.notion-update-page --args '{}'`],
		["a write with a variable for the tool", `T=notion-update-page; mcporter call notion.$T --args '{}'`],
		["a write with a variable for the executable", `m=mcporter; $m call notion.notion-update-page --args '{}'`],
	];
	for (const [label, command] of BYPASSES) {
		test(`${label} is denied with the two forms`, () => {
			const reason = denialOf(bash(command));
			assert.ok(reason.includes(`mcporter call notion.<tool> --args "$(cat ${OUTBOX_DIR}/<name>.json)"`), reason);
			assert.ok(reason.includes("mcporter call notion.<read tool> --args '<JSON object>' --output json"), reason);
		});
	}
});

describe("guard-notion-write, no output", () => {
	test("a write in the outbox form passes", () => assertSilent(bash(CREATE)));
	test("a read with inline arguments passes", () => assertSilent(bash(`mcporter call notion.notion-fetch --args '{"id":"abc"}' --output json`)));
	test("a read with no arguments passes", () => assertSilent(bash("mcporter call notion.notion-get-self")));
	test("a read with arguments from an outbox file passes", () => assertSilent(bash(outboxCommand("notion-search", `${OUTBOX_DIR}/query.json`))));
	test("a command that does not name Notion passes", () => assertSilent(bash("npm test")));
	test("a tool other than Bash passes", () => assertSilent({ ...CAPTURED_PRE_TOOL_USE, tool_name: "Write" }));
	test("the tool list of the Notion server passes", () => assertSilent(bash("mcporter list notion --schema")));
	test("the tool list of the Notion server as JSON passes", () => assertSilent(bash("mcporter list notion --schema --output json")));
	test("the sign-in of the Notion server passes", () => assertSilent(bash("mcporter auth notion")));
});

describe("guard-notion-write, a command that names mcporter and not Notion", () => {
	const OTHER_SERVER: ReadonlyArray<readonly [string, string]> = [
		["a call to Slack", "mcporter call slack.post_message --args '{}'"],
		["a call to Jira", "mcporter call jira.search_issues"],
		["a call to Grafana with no JSON", "mcporter call grafana.query_prometheus expr:up"],
		["a search for mcporter", "rg mcporter"],
		["a commit message that names mcporter", `git commit -m "fix mcporter path"`],
		["the tool list of another server", "mcporter list slack --schema"],
	];
	for (const [label, command] of OTHER_SERVER) test(`${label} passes`, () => assertSilent(bash(command)));

	test("a call to another server with an argument that names Notion is denied", () => {
		assert.match(denialOf(bash(`mcporter call slack.x --args "$(echo notion)"`)), /^Notion command denied\./);
	});
});

describe("guard-notion-write, the runtime folder of mcporter", () => {
	let bin = "";
	let dist = "";
	let command = "";

	before(() => {
		dist = join(project, "store", "pkg-1", "dist");
		bin = join(project, "bin");
		mkdirSync(dist, { recursive: true });
		mkdirSync(bin);
		writeFileSync(join(dist, "cli.js"), "");
		writeFileSync(join(dist, "index.js"), "");
		symlinkSync(join(dist, "cli.js"), join(bin, "mcporter"));
		command = `node ${join(dist, "cli.js")} call --server notion --tool notion-update-page --args '{}'`;
	});

	test("a command that names the runtime folder of the executable on PATH is denied", { skip: process.platform === "win32" && "symlinks need a privilege on Windows" }, () => {
		assert.match(denialOf(bash(command), SCRIPT, { PATH: bin }), /names `mcporter` and Notion, or the runtime folder of `mcporter`/);
	});

	test("a command that names the runtime folder and not Notion is denied", { skip: process.platform === "win32" && "symlinks need a privilege on Windows" }, () => {
		const reason = denialOf(bash(`node -e 'import("${dist}/index.js")'`), SCRIPT, { PATH: bin });
		assert.match(reason, /^Notion command denied\./);
	});

	test("the same command passes on a machine with no mcporter on PATH", () => assertSilent(bash(command), { PATH: elsewhere }));
});

describe("guard-notion-write, an error denies", () => {
	const FAILED = /^The Notion guard failed, so it denied this Bash command: /;

	test("a Bash payload with no command is denied", () => {
		assert.match(denialOf({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: null }), FAILED);
	});

	test("a payload that names no tool is denied", () => {
		assert.match(denialOf({ hook_event_name: "PreToolUse", tool_input: { command: "ls" } }), FAILED);
	});

	test("an empty stdin is denied", () => {
		assert.match(denialOf(null), FAILED);
	});

	test("a stdin that is not JSON is denied", () => {
		assert.match(denialOf("{not json"), FAILED);
	});

	test("a guard that cannot load its modules is denied", () => {
		const alone = join(project, "alone");
		mkdirSync(alone);
		copyFileSync(SCRIPT, join(alone, "guard-notion-write.ts"));
		writeFileSync(join(alone, "package.json"), '{"type":"module"}');
		assert.match(denialOf(bash("npm test"), join(alone, "guard-notion-write.ts")), /^The Notion guard failed, so it denied this Bash command: Cannot find module /);
	});
});
