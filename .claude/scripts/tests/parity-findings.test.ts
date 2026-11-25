/**
 * Each part of the hook output gives a finding, and output that the
 * normalizer does not know stays visible as a finding. So a change in one
 * form shows as a difference.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { findingsOf } from "../parity/findings.ts";
import { MARKDOWN_WORDING } from "../parity/markdown-wording.ts";
import { NOTION_WORDING } from "../parity/notion-wording.ts";
import type { Finding, FixtureSpec, HookEnvironment, Step } from "../parity/spec.ts";
import { capturesOf, TEXTS, type TextKind, type Wording } from "../parity/wording.ts";

const SPEC: FixtureSpec = { notes: [], repoFiles: [], scenarios: [] };

const ENVIRONMENT: HookEnvironment = {
	scriptsDir: "",
	projectDir: "",
	env: {},
	sessionLogDir: "",
	writePayload: () => ({}),
	wording: MARKDOWN_WORDING,
	noteOf: (reference) => (reference === "Known.md" ? "Known" : null),
	notesIn: () => [],
};

type Brief = Pick<Finding, "row" | "note" | "detail">;

function findings(step: Step, stdout: string, run: { readonly exitCode?: number; readonly stderr?: string } = {}): Brief[] {
	const scenario = { id: "test", rows: [], steps: [step], expect: [] };
	const stepRun = { stdout, stderr: run.stderr ?? "", exitCode: run.exitCode ?? 0, wallMs: 0, sessionLogs: [] };
	return findingsOf({ scenario, environment: ENVIRONMENT, home: "/home", runs: [stepRun] }, SPEC).map(({ row, note, detail }) => ({ row, note, detail }));
}

const context = (event: string, text: string): string =>
	JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } });

const payload = (hook: Step["hook"]): Step => ({ hook, input: { kind: "payload", fields: {} } });
const write: Step = { hook: "validate-write", input: { kind: "write", note: "Known" } };

describe("findingsOf on output that no recognizer knows", () => {
	test("a new SessionStart section is an UNMAPPED finding", () => {
		assert.deepEqual(findings(payload("session-start"), context("SessionStart", "## Session Context\n\n### New Section\ntext\n")), [
			{ row: "SS-19", note: null, detail: "additional context, event SessionStart" },
			{ row: "SS-19", note: null, detail: "session title" },
			{ row: "UNMAPPED", note: null, detail: "### New Section" },
			{ row: "UNMAPPED", note: null, detail: "text" },
		]);
	});

	test("a new write warning is an UNMAPPED finding on the written note", () => {
		const text = "Vault hygiene warnings for `Known.md`:\n  - A new warning\nFix these before moving on.";
		assert.deepEqual(findings(write, context("PostToolUse", text)), [
			{ row: "VW-17", note: null, detail: "additional context, event PostToolUse" },
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
			{ row: "VW-17", note: null, detail: "additional context, event PostToolUse" },
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
			{ row: "ST-03", note: null, detail: "summary" },
			{ row: "UNMAPPED", note: null, detail: "A new line." },
			{ row: "ST-09", note: null, detail: "trailer" },
		]);
	});

	test("a size meter that reports a cut section stays in a finding, and a plain meter does not", () => {
		const cut = "_context injected: 9.4kB / 9.0kB budget — degraded: Vault File Listing_";
		const plain = "_context injected: 3.6kB / 9.0kB budget_";
		const session = (meter: string): string => context("SessionStart", `## Session Context\n\n### Date\n2026-01-05 (Monday)\n\n${meter}\n`);
		assert.deepEqual(findings(payload("session-start"), session(plain)), [
			{ row: "SS-19", note: null, detail: "additional context, event SessionStart" },
			{ row: "SS-19", note: null, detail: "session title" },
			{ row: "SS-19", note: null, detail: "size meter" },
			{ row: "SS-10", note: null, detail: "date line" },
		]);
		assert.equal(findings(payload("session-start"), session(cut)).at(-1)?.detail?.includes("degraded"), true);
	});

	test("output that is not JSON shows in the channel finding", () => {
		assert.deepEqual(findings(payload("classify-message"), "Error: boom"), [{ row: "UP-14", note: null, detail: "unparsed output" }]);
	});

	test("an exit code that is not 0 shows in the channel finding", () => {
		assert.deepEqual(findings(payload("pre-compact"), "", { exitCode: 1 })[0], { row: "PC-01", note: null, detail: "silent (exit 1)" });
	});
});

describe("findingsOf on the fields of the output", () => {
	const stop = payload("stop-checklist");
	const report = "Wrap-up checklist:\n- One item\n\nVault Hygiene (drift detected):\n⚠️  AGENTS.md is 24KB — keep it small.";

	test("the channel finding names the event of the envelope", () => {
		assert.deepEqual(findings(payload("classify-message"), context("Bogus", ""))[0], {
			row: "UP-14",
			note: null,
			detail: "additional context, event Bogus",
		});
	});

	test("a field that the hooks do not use is an UNMAPPED finding", () => {
		const stdout = JSON.stringify({ decision: "block", hookSpecificOutput: { permissionDecision: "deny" }, report: { extra: 1 } });
		assert.deepEqual(
			findings(stop, stdout).filter((finding) => finding.row === "UNMAPPED").map((finding) => finding.detail),
			["output field decision", "output field hookSpecificOutput.permissionDecision", "output field report.extra"],
		);
	});

	test("a known field of the wrong type is an UNMAPPED finding", () => {
		assert.deepEqual(findings(stop, JSON.stringify({ systemMessage: 1, report: { claims: "none" } })).slice(1), [
			{ row: "UNMAPPED", note: null, detail: "output field systemMessage" },
			{ row: "UNMAPPED", note: null, detail: "output field report.claims" },
			{ row: "ST-06", note: null, detail: "no key" },
		]);
	});

	test("text on stderr is a finding of the channel row, and no text is not", () => {
		assert.deepEqual(findings(write, "", { stderr: "  a warning\n" }), [
			{ row: "VW-17", note: null, detail: "silent" },
			{ row: "VW-17", note: null, detail: "stderr: a warning" },
		]);
		assert.deepEqual(findings(write, "", { stderr: "\n" }), [{ row: "VW-17", note: null, detail: "silent" }]);
	});

	test("each policy result is a finding with its ID, its class, its action, and its note", () => {
		const policies = [
			{ policy_id: "organization-threshold", path: "Known.md", classification: "oversized-note", action: "flag" },
			{ policy_id: "topic-cluster", path: "Known.md", classification: "ungrouped-cluster", suggested_target: "a/folder/", action: "flag" },
			{ policy_id: "memory-location", path: "/home/.claude/memory/lesson.md", classification: "misplaced-memory", action: "warn" },
			{ policy_id: "new-policy", path: "Known.md", classification: "new", action: "warn", extra: true },
		];
		const stdout = JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "", policyResults: policies } });
		assert.deepEqual(findings(write, stdout).slice(1), [
			{ row: "VW-14", note: "Known", detail: "policy organization-threshold, oversized-note, flag" },
			{ row: "VW-15", note: "Known", detail: "policy topic-cluster, ungrouped-cluster, flag, with a target" },
			{ row: "VW-03", note: null, detail: "policy memory-location, misplaced-memory, warn, at ~/.claude/memory/lesson.md" },
			{ row: "UNMAPPED", note: "Known", detail: "policy new-policy, new, warn, with extra" },
		]);
	});

	test("the summary beside the Stop feedback gives its checklist, its claims, and its trailer", () => {
		const summary = "Wrap-up checklist: one · two\nHygiene: AGENTS.md is 24KB · A new claim\nThe full report went to the agent now, as Stop hook feedback.";
		const stdout = JSON.stringify({ systemMessage: summary, hookSpecificOutput: { hookEventName: "Stop", additionalContext: report } });
		assert.deepEqual(findings(stop, stdout), [
			{ row: "ST-10", note: null, detail: "system message and feedback, event Stop" },
			{ row: "ST-03", note: null, detail: "summary" },
			{ row: "HY-09", note: null, detail: "summary claim" },
			{ row: "UNMAPPED", note: null, detail: "A new claim" },
			{ row: "ST-10", note: null, detail: "trailer" },
			{ row: "ST-03", note: null, detail: null },
			{ row: "ST-04", note: null, detail: null },
			{ row: "HY-09", note: null, detail: "claim" },
		]);
	});

	test("each claim of the report data is a finding", () => {
		const data = (claims: readonly unknown[]): string => JSON.stringify({ report: { key: "0123456789abcdef", claims, agentText: report } });
		const claims = (stdout: string): Brief[] => findings(stop, stdout).filter((finding) => finding.detail?.startsWith("data claim") || finding.row === "UNMAPPED");
		assert.deepEqual(claims(data(["AGENTS.md is 24KB", "CLAUDE.md present beside AGENTS.md", "A new claim", 7])), [
			{ row: "HY-09", note: null, detail: "data claim" },
			{ row: "HY-07", note: null, detail: "data claim CLAUDE.md" },
			{ row: "UNMAPPED", note: null, detail: "A new claim" },
			{ row: "UNMAPPED", note: null, detail: "claim 7" },
		]);
		assert.deepEqual(claims(data([])), []);
	});

	test("the report key finding names the first step of the scenario that gave the same key", () => {
		const data = (key: string): string => JSON.stringify({ report: { key, claims: [], agentText: report } });
		const steps = [data("0123456789abcdef"), data("0123456789abcdef"), data("fedcba9876543210"), data("not a key")];
		const scenario = { id: "test", rows: [], steps: steps.map(() => stop), expect: [] };
		const runs = steps.map((stdout) => ({ stdout, stderr: "", exitCode: 0, wallMs: 0, sessionLogs: [] }));
		const keys = findingsOf({ scenario, environment: ENVIRONMENT, home: "/home", runs }, SPEC).filter((finding) => finding.row === "ST-06");
		assert.deepEqual(keys.map(({ step, detail }) => [step, detail]), [
			[0, "key first given at step 0"],
			[1, "key first given at step 0"],
			[2, "key first given at step 2"],
			[3, "no key"],
		]);
	});

	test("the preface of a Stop report is a finding of the row that sends it", () => {
		const prefaces = {
			"ST-09": "Stop hook report, handed over with this message: when your previous response ended, these findings were new.",
			"ST-08": "Stop hook report, handed over with this message: when one of your earlier responses this session ended.",
			"ST-10": "Stop hook report: your response just ended, and these findings are new.",
		};
		for (const [row, preface] of Object.entries(prefaces)) {
			const stdout = JSON.stringify({ systemMessage: `${preface}\n\n${report}` });
			assert.deepEqual(findings(payload("stop-checklist"), stdout)[1], { row, note: null, detail: "preface" });
		}
	});
});

describe("findingsOf with the wording of the form", () => {
	const session = context("SessionStart", "### Brain Topics (read on demand)\n- [[Known]] — A topic\n");
	const withWording = (wording: Wording): Brief[] => {
		const scenario = { id: "test", rows: [], steps: [payload("session-start")], expect: [] };
		const run = { stdout: session, stderr: "", exitCode: 0, wallMs: 0, sessionLogs: [] };
		const environment = { ...ENVIRONMENT, wording, noteOf: (reference: string) => (reference === "Known" ? "Known" : null) };
		return findingsOf({ scenario, environment, home: "/home", runs: [run] }, SPEC).map(({ row, note, detail }) => ({ row, note, detail }));
	};

	test("the pattern of the form decides what a line is", () => {
		assert.deepEqual(withWording(MARKDOWN_WORDING).at(-1), { row: "SS-12", note: "Known", detail: "A topic" });
	});

	test("a kind with no pattern in the form gives an UNMAPPED finding", () => {
		const { "brain topic": _, ...rest } = MARKDOWN_WORDING;
		assert.deepEqual(withWording(rest).at(-1), { row: "UNMAPPED", note: null, detail: "- [[Known]] — A topic" });
	});

	test("a pattern with no group for a part of its finding is an error, not a finding with less in it", () => {
		assert.throws(() => withWording({ ...MARKDOWN_WORDING, "brain topic": /^- \[\[(?<note>[^\]]+)\]\] — .+$/ }), /"brain topic" has no group "detail"/);
	});
});

describe("the wording tables", () => {
	const tables: Readonly<Record<string, Wording>> = { Markdown: MARKDOWN_WORDING, Notion: NOTION_WORDING };

	for (const [form, wording] of Object.entries(tables)) {
		test(`each pattern of the ${form} wording has the groups of its kind`, () => {
			const missing = (Object.keys(wording) as TextKind[]).flatMap((kind) =>
				capturesOf(kind)
					.filter((capture) => !wording[kind]!.source.includes(`(?<${capture}>`))
					.map((capture) => `${kind}: ${capture}`),
			);
			assert.deepEqual(missing, []);
		});

		test(`no pattern of the ${form} wording keeps a position between two lines`, () => {
			assert.deepEqual((Object.keys(wording) as TextKind[]).filter((kind) => /[gy]/.test(wording[kind]!.flags)), []);
		});
	}

	test("the Markdown wording has a pattern for each kind of text", () => {
		assert.deepEqual((Object.keys(TEXTS) as TextKind[]).filter((kind) => MARKDOWN_WORDING[kind] === undefined), []);
	});
});
