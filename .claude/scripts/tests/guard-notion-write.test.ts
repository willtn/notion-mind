/**
 * Subprocess tests for guard-notion-write.ts: what Claude Code gets on stdout
 * for a PreToolUse payload.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OUTBOX_DIR, outboxCommand } from "../lib/notion-write.ts";
import { runScript, rmTemp } from "./_helpers.ts";
import { CAPTURED_POST_TOOL_USE, CAPTURED_PRE_TOOL_USE } from "./notion-write-payloads.ts";

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "../guard-notion-write.ts");
const CREATE = outboxCommand("notion-create-pages", `${OUTBOX_DIR}/note.json`);

let project = "";
let elsewhere = "";

before(() => {
	project = mkdtempSync(join(tmpdir(), "guard-notion-write-"));
	elsewhere = mkdtempSync(join(tmpdir(), "guard-notion-write-elsewhere-"));
	mkdirSync(join(project, OUTBOX_DIR), { recursive: true });
	writeFileSync(join(project, OUTBOX_DIR, "note.json"), JSON.stringify({ allow_async: false, pages: [{ properties: { title: "A page" } }] }));
	writeFileSync(join(project, OUTBOX_DIR, "async.json"), JSON.stringify({ pages: [{ properties: { title: "A page" } }] }));
});

after(() => {
	rmTemp(project);
	rmTemp(elsewhere);
});

const bash = (command: string, cwd: string = project): object => ({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, cwd });

/** The denial reason on stdout. The hook must exit 0, because Claude Code reads the JSON of a zero exit only. */
function denialOf(stdin: object): string {
	const run = runScript(SCRIPT, stdin);
	assert.equal(run.code, 0, run.stderr);
	const output = (JSON.parse(run.stdout) as { hookSpecificOutput: Record<string, unknown> }).hookSpecificOutput;
	assert.deepEqual(Object.keys(output), ["hookEventName", "permissionDecision", "permissionDecisionReason"]);
	assert.equal(output["hookEventName"], "PreToolUse");
	assert.equal(output["permissionDecision"], "deny");
	return String(output["permissionDecisionReason"]);
}

function assertSilent(stdin: string | object | null): void {
	const run = runScript(SCRIPT, stdin);
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
});

describe("guard-notion-write, no output", () => {
	test("a write in the outbox form passes", () => assertSilent(bash(CREATE)));
	test("a read call passes", () => assertSilent(bash(`mcporter call notion.notion-fetch --args '{"id":"abc"}'`)));
	test("a command that is not a Notion call passes", () => assertSilent(bash("npm test")));
	test("a tool other than Bash passes", () => assertSilent({ ...CAPTURED_PRE_TOOL_USE, tool_name: "Write" }));
	test("a payload with no command passes", () => assertSilent({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: null }));
	test("an empty stdin passes", () => assertSilent(null));
	test("a stdin that is not JSON passes", () => assertSilent("{not json"));
});
