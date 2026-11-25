/**
 * Hook output that the normalizer does not know must stay visible as a
 * finding, so new text in one form shows as a difference.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { findingsOf } from "../parity/findings.ts";
import type { Finding, FixtureSpec, HookEnvironment, Step } from "../parity/spec.ts";

const SPEC: FixtureSpec = { notes: [], repoFiles: [], scenarios: [] };

const ENVIRONMENT: HookEnvironment = {
	scriptsDir: "",
	projectDir: "",
	env: {},
	sessionLogDir: "",
	writePayload: () => ({}),
	noteOf: (reference) => (reference === "Known.md" ? "Known" : null),
	notesIn: () => [],
};

function findings(step: Step, stdout: string, exitCode = 0): Pick<Finding, "row" | "note" | "detail">[] {
	const scenario = { id: "test", rows: [], steps: [step], expect: [] };
	const run = { stdout, stderr: "", exitCode, wallMs: 0, sessionLogs: [] };
	return findingsOf({ scenario, environment: ENVIRONMENT, runs: [run] }, SPEC).map(({ row, note, detail }) => ({ row, note, detail }));
}

const context = (event: string, text: string): string =>
	JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } });

const payload = (hook: Step["hook"]): Step => ({ hook, input: { kind: "payload", fields: {} } });
const write: Step = { hook: "validate-write", input: { kind: "write", note: "Known" } };

describe("findingsOf on output that no recognizer knows", () => {
	test("a new SessionStart section is an UNMAPPED finding", () => {
		assert.deepEqual(findings(payload("session-start"), context("SessionStart", "## Session Context\n\n### New Section\ntext\n")), [
			{ row: "SS-19", note: null, detail: "additional context" },
			{ row: "UNMAPPED", note: null, detail: "### New Section" },
		]);
	});

	test("a new write warning is an UNMAPPED finding on the written note", () => {
		const text = "Vault hygiene warnings for `Known.md`:\n  - A new warning\nFix these before moving on.";
		assert.deepEqual(findings(write, context("PostToolUse", text)), [
			{ row: "VW-17", note: null, detail: "additional context" },
			{ row: "UNMAPPED", note: "Known", detail: "A new warning" },
		]);
	});

	test("a warning on a file that is not a fixture note keeps the file name", () => {
		const text = "Vault hygiene warnings for `Other.md`:\n  - Missing YAML frontmatter\nFix these before moving on.";
		assert.deepEqual(findings(write, context("PostToolUse", text))[1], { row: "VW-07", note: "not a fixture note: Other.md", detail: null });
	});

	test("a new prompt hint is an UNMAPPED finding", () => {
		const text = "Content classification hints (act on these):\n- NEW SIGNAL detected\n\nRemember: the conventions.";
		assert.deepEqual(findings(payload("classify-message"), context("UserPromptSubmit", text)).at(-1), {
			row: "UNMAPPED",
			note: null,
			detail: "NEW SIGNAL detected",
		});
	});

	test("a new hygiene claim is an UNMAPPED finding", () => {
		const message = "Wrap-up checklist:\n- One item\n\nVault Hygiene (drift detected):\n⚠️  3 note(s) with a new problem:\n   - a.md";
		assert.deepEqual(
			findings(payload("stop-checklist"), JSON.stringify({ systemMessage: message })).filter((f) => f.row === "UNMAPPED"),
			[
				{ row: "UNMAPPED", note: null, detail: "⚠️  3 note(s) with a new problem:" },
				{ row: "UNMAPPED", note: null, detail: "- a.md" },
			],
		);
	});

	test("a new block after a known write block is an UNMAPPED finding", () => {
		const known = "Vault hygiene warnings for `Known.md`:\n  - Missing YAML frontmatter\nFix these before moving on.";
		assert.deepEqual(findings(write, context("PostToolUse", `${known}\n\nA new block about the note.`)), [
			{ row: "VW-17", note: null, detail: "additional context" },
			{ row: "VW-07", note: "Known", detail: null },
			{ row: "UNMAPPED", note: null, detail: "A new block about the note." },
		]);
	});

	test("new text after the prompt hints is an UNMAPPED finding", () => {
		const text = "Content classification hints (act on these):\n- DECISION detected\n\nRemember: the conventions.\n\nA new block.";
		assert.deepEqual(findings(payload("classify-message"), context("UserPromptSubmit", text)).at(-1), {
			row: "UNMAPPED",
			note: null,
			detail: "A new block.",
		});
	});

	test("a new line in a Stop summary is an UNMAPPED finding", () => {
		const message = "Wrap-up checklist: archive completed work\nA new line.\nThe full report reaches the agent with your next message.";
		assert.deepEqual(findings(payload("stop-checklist"), JSON.stringify({ systemMessage: message })), [
			{ row: "ST-09", note: null, detail: "system message" },
			{ row: "UNMAPPED", note: null, detail: "A new line." },
		]);
	});

	test("a size meter that reports a cut section stays in a finding, and a plain meter does not", () => {
		const cut = "_context injected: 9.4kB / 9.0kB budget — degraded: Vault File Listing_";
		const plain = "_context injected: 3.6kB / 9.0kB budget_";
		const session = (meter: string): string => context("SessionStart", `## Session Context\n\n### Date\n2026-01-05 (Monday)\n\n${meter}\n`);
		assert.deepEqual(findings(payload("session-start"), session(plain)), [
			{ row: "SS-19", note: null, detail: "additional context" },
			{ row: "SS-10", note: null, detail: "date line" },
		]);
		assert.equal(findings(payload("session-start"), session(cut)).at(-1)?.detail?.includes("degraded"), true);
	});

	test("output that is not JSON shows in the channel finding", () => {
		assert.deepEqual(findings(payload("classify-message"), "Error: boom"), [{ row: "UP-14", note: null, detail: "unparsed output" }]);
	});

	test("an exit code that is not 0 shows in the channel finding", () => {
		assert.deepEqual(findings(payload("pre-compact"), "", 1)[0], { row: "PC-01", note: null, detail: "silent (exit 1)" });
	});
});
