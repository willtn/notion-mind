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
import { oldSessionLogName, type StepRun } from "../parity/runner.ts";
import type { Finding, FixtureSpec, HookEnvironment, Scenario, Step } from "../parity/spec.ts";
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
	return whole(step, stdout, run).map(({ row, note, detail }) => ({ row, note, detail }));
}

type Run = { readonly exitCode?: number; readonly stderr?: string; readonly envFileAdded?: string; readonly sessionLogs?: readonly string[] };

const stepRunOf = (stdout: string, run: Run = {}): StepRun => ({
	stdout,
	stderr: run.stderr ?? "",
	exitCode: run.exitCode ?? 0,
	wallMs: 0,
	sessionLogs: (run.sessionLogs ?? []).map((name) => ({ name, sha256: "" })),
	envFileAdded: run.envFileAdded ?? "",
});

/** Each finding of one run, with each field. */
function whole(step: Step, stdout: string, run: Run = {}, scenario: Partial<Scenario> = {}, environment: HookEnvironment = ENVIRONMENT): Finding[] {
	const full: Scenario = { id: "test", rows: [], steps: [step], expect: [], ...scenario };
	return findingsOf({ scenario: full, environment, home: "/home", runs: [stepRunOf(stdout, run)] }, SPEC);
}

const context = (event: string, text: string): string =>
	JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } });

const payload = (hook: Step["hook"]): Step => ({ hook, input: { kind: "payload", fields: {} } });
const write: Step = { hook: "validate-write", input: { kind: "write", notes: ["Known"] } };

describe("findingsOf on output that no recognizer knows", () => {
	test("a new SessionStart section is an UNMAPPED finding", () => {
		assert.deepEqual(findings(payload("session-start"), context("SessionStart", "## Session Context\n\n### New Section\ntext\n")), [
			{ row: "SS-19", note: null, detail: "additional context, event SessionStart" },
			{ row: "SS-19", note: null, detail: "sections: " },
			{ row: "SS-19", note: null, detail: "session title" },
			{ row: "UNMAPPED", note: null, detail: "### New Section" },
			{ row: "UNMAPPED", note: null, detail: "text" },
		]);
	});

	test("a new write warning is an UNMAPPED finding on the written note", () => {
		const text = "Vault hygiene warnings for `Known.md`:\n  - A new warning\nFix these before moving on.";
		assert.deepEqual(findings(write, context("PostToolUse", text)), [
			{ row: "VW-17", note: null, detail: "additional context, event PostToolUse" },
			{ row: "VW-13", note: "Known", detail: null },
			{ row: "UNMAPPED", note: "Known", detail: "A new warning" },
		]);
	});

	test("a warning on a file that is not a fixture note keeps the file name", () => {
		const text = "Vault hygiene warnings for `Other.md`:\n  - Missing YAML frontmatter\nFix these before moving on.";
		assert.deepEqual(findings(write, context("PostToolUse", text)).slice(1), [
			{ row: "VW-13", note: "not a fixture note: Other.md", detail: null },
			{ row: "VW-07", note: "not a fixture note: Other.md", detail: null },
		]);
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
			{ row: "VW-13", note: "Known", detail: null },
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
			{ row: "ST-03", note: null, detail: "summary item 1" },
			{ row: "UNMAPPED", note: null, detail: "A new line." },
			{ row: "ST-09", note: null, detail: "trailer" },
		]);
	});

	test("a size meter that reports a cut section has a different text from a plain meter, and the size of the context is not in the text", () => {
		const cut = "_context injected: 9.4kB / 9.0kB budget — degraded: Vault File Listing_";
		const plain = "_context injected: 3.6kB / 9.0kB budget_";
		const session = (meter: string): string => context("SessionStart", `## Session Context\n\n### Date\n2026-01-05 (Monday)\n\n${meter}\n`);
		assert.deepEqual(findings(payload("session-start"), session(plain)), [
			{ row: "SS-19", note: null, detail: "additional context, event SessionStart" },
			{ row: "SS-19", note: null, detail: "sections: date" },
			{ row: "SS-19", note: null, detail: "session title" },
			{ row: "SS-19", note: null, detail: "size meter" },
			{ row: "SS-10", note: null, detail: "date line" },
		]);
		const meterText = (meter: string): string | undefined =>
			whole(payload("session-start"), session(meter)).find(({ detail }) => detail === "size meter")?.text;
		assert.equal(meterText(plain), "_context injected: {formText} / 9.0kB budget_");
		assert.equal(meterText(cut), "_context injected: {formText} / 9.0kB budget — degraded: Vault File Listing_");
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
			{ row: "VW-15", note: "Known", detail: "policy topic-cluster, ungrouped-cluster, flag, with the target a/folder/" },
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
			{ row: "ST-03", note: null, detail: "summary item 1" },
			{ row: "ST-03", note: null, detail: "summary item 2" },
			{ row: "HY-09", note: null, detail: "summary claim" },
			{ row: "UNMAPPED", note: null, detail: "A new claim" },
			{ row: "ST-10", note: null, detail: "trailer" },
			{ row: "ST-03", note: null, detail: null },
			{ row: "ST-03", note: null, detail: "item 1" },
			{ row: "ST-04", note: null, detail: null },
			{ row: "HY-10", note: null, detail: "order: HY-09" },
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
		const runs = steps.map((stdout) => stepRunOf(stdout));
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

describe("findingsOf on the instruction text", () => {
	const textsOf = (found: readonly Finding[]): (string | undefined)[] => found.map(({ text }) => text);

	test("the text of a finding has a name in braces for each part that a field of the finding holds", () => {
		const text = "Vault hygiene warnings for `Known.md`:\n  - 2 ticket-ID wikilink(s) (e.g. [[PROJ-…]]) — never wikilinks\nFix these before moving on.";
		assert.deepEqual(textsOf(whole(write, context("PostToolUse", text)).slice(1)), [
			"{hygiene} warnings for `{note}`:\n{items}Fix these before moving on.",
			"{count} ticket-ID wikilink(s) (e.g. [[PROJ-…]]) — never wikilinks",
		]);
	});

	test("an object name of the form is its neutral name in the text, and the longer of two names wins", () => {
		const hidden = "### North Star (current goals)\n_(2 completed items hidden — full history in brain/North Star.md)_\n";
		const [, , finding] = whole(payload("session-start"), context("SessionStart", hidden));
		assert.equal(finding?.text, "_({count} completed items hidden — full history in {North Star})_");
	});

	test("two forms that name one object in two ways give the same text, and a changed instruction gives a different text", () => {
		const names = (wording: Wording, line: string): string | undefined => {
			const stdout = JSON.stringify({ systemMessage: `Wrap-up checklist:\n${line}` });
			return whole(payload("stop-checklist"), stdout, {}, {}, { ...ENVIRONMENT, wording }).find(({ detail }) => detail === "item 1")?.text;
		};
		const markdown = { ...MARKDOWN_WORDING, names: [["work/active/", "{active work}"]] as const };
		const notion = { ...MARKDOWN_WORDING, names: [["the active Work rows", "{active work}"]] as const };
		assert.equal(names(markdown, "- Archive the notes of work/active/"), "- Archive the notes of {active work}");
		assert.equal(names(notion, "- Archive the notes of the active Work rows"), "- Archive the notes of {active work}");
		assert.equal(names(notion, "- Delete the notes of the active Work rows"), "- Delete the notes of {active work}");
	});

	test("a line that is only data has no text", () => {
		const session = context("SessionStart", "### Brain Topics (read on demand)\n- [[Known]] — A topic\n\n### Active Work\nKnown\n");
		const environment = { ...ENVIRONMENT, noteOf: (reference: string) => (reference === "Known" ? "Known" : null) };
		const data = whole(payload("session-start"), session, {}, {}, environment).filter(({ row }) => row === "SS-12" || row === "SS-15");
		assert.deepEqual(data.map(({ row, note, text }) => ({ row, note, text })), [
			{ row: "SS-12", note: "Known", text: undefined },
			{ row: "SS-15", note: "Known", text: undefined },
		]);
	});

	test("the date line is in the text of its finding", () => {
		const session = context("SessionStart", "### Date\n2026-01-05 (Monday)\n");
		assert.equal(whole(payload("session-start"), session).find(({ row }) => row === "SS-10")?.text, "2026-01-05 (Monday)");
	});

	test("the age of an open loop is in the text, and the line number of a wrapped paragraph is not", () => {
		const message = "Wrap-up checklist:\n- One item\n\nVault Hygiene (drift detected):\n⚠️  1 note(s) with open follow-ups untouched 14+ days — close them:\n   - Known.md (21d, 2 open item(s))";
		const loop = whole(payload("stop-checklist"), JSON.stringify({ systemMessage: message })).find(({ row, note }) => row === "HY-04" && note === "Known");
		assert.equal(loop?.text, "{note} (21d, {count} open item(s))");
		const wrapped = "Vault hygiene warnings for `Known.md`:\n  - 2 hard-wrapped paragraph line(s), first at line 11 — write each paragraph as one line\nFix these before moving on.";
		assert.equal(whole(write, context("PostToolUse", wrapped)).at(-1)?.text, "{count} hard-wrapped paragraph line(s), first at line {formText} — write each paragraph as one line");
	});

	test("a path of the run is not in the text", () => {
		const environment = { ...ENVIRONMENT, projectDir: "/project" };
		const message = "Wrap-up checklist:\n- Read /project/AGENTS.md and /home/.claude/rules";
		const item = whole(payload("stop-checklist"), JSON.stringify({ systemMessage: message }), {}, {}, environment).find(({ detail }) => detail === "item 1");
		assert.equal(item?.text, "- Read {project directory}/AGENTS.md and ~/.claude/rules");
	});
});

describe("findingsOf on the parts that have a finding of their own", () => {
	const stop = payload("stop-checklist");

	test("each item of the full checklist and of the summary checklist is a finding with its position", () => {
		const full = whole(stop, JSON.stringify({ systemMessage: "Wrap-up checklist:\n- First\n- Second\nNot an item" }));
		assert.deepEqual(full.slice(1).map(({ row, detail, count, text }) => ({ row, detail, count, text })), [
			{ row: "ST-03", detail: null, count: 2, text: undefined },
			{ row: "ST-03", detail: "item 1", count: null, text: "- First" },
			{ row: "ST-03", detail: "item 2", count: null, text: "- Second" },
			{ row: "UNMAPPED", detail: "Not an item", count: null, text: undefined },
		]);
		const summary = whole(stop, JSON.stringify({ systemMessage: "Wrap-up checklist: first · second" }));
		assert.deepEqual(summary.slice(2).map(({ row, detail, text }) => ({ row, detail, text })), [
			{ row: "ST-03", detail: "summary item 1", text: "first" },
			{ row: "ST-03", detail: "summary item 2", text: "second" },
		]);
	});

	test("the hints finding gives the rows of the hints in their order", () => {
		const hints = (lines: string): string => `Content classification hints (act on these):\n${lines}\n\nRemember: the conventions.`;
		const order = (lines: string): string | null | undefined =>
			findings(payload("classify-message"), context("UserPromptSubmit", hints(lines))).find(({ row }) => row === "UP-12")?.detail;
		assert.equal(order("- DECISION detected\n- WIN detected"), "UP-03, UP-07");
		assert.equal(order("- WIN detected\n- DECISION detected"), "UP-07, UP-03");
	});

	test("the join of the hints and the Stop report is a finding", () => {
		const hints = "Content classification hints (act on these):\n- DECISION detected\n\nRemember: the conventions.";
		const report = "Wrap-up checklist:\n- One item";
		const join = (text: string): Brief[] =>
			findings(payload("classify-message"), context("UserPromptSubmit", text)).filter(({ detail }) => detail?.includes("between the parts"));
		assert.deepEqual(join(`${hints}\n\n${report}`), [{ row: "UP-14", note: null, detail: "a blank line between the parts" }]);
		assert.deepEqual(join(`${hints}\n${report}`), [{ row: "UP-14", note: null, detail: "no blank line between the parts" }]);
		assert.deepEqual(join(hints), []);
		assert.deepEqual(join(report), []);
	});

	test("the SessionStart context gives the order of its sections", () => {
		const session = (sections: readonly string[]): string => context("SessionStart", sections.map((header) => `${header}\n`).join("\n"));
		const order = (sections: readonly string[]): string | null | undefined => findings(payload("session-start"), session(sections))[1]?.detail;
		assert.equal(order(["### Open Tasks", "### Active Work"]), "sections: open tasks, active work");
		assert.equal(order(["### Active Work", "### Open Tasks"]), "sections: active work, open tasks");
	});

	test("the pointer of a resumed session is a finding of the mode row", () => {
		const session = context("SessionStart", "### Context Pointer\n(Re-entry via resume/compact — the first sections are unchanged.)\n");
		assert.deepEqual(findings(payload("session-start"), session).at(-1), { row: "SS-05", note: null, detail: "context pointer" });
	});

	test("the hygiene report gives the order of its claims, with no claim of a row that part (d) does not compare", () => {
		const report = [
			"Wrap-up checklist:",
			"- One item",
			"",
			"Vault Hygiene (drift detected):",
			"⚠️  AGENTS.md is 24KB — keep it small.",
			"⚠️  1 note(s) marked done but still in active/ — archive them:",
			"   - Known.md",
			"⚠️  3 note(s) past the 25KB organization threshold — split them:",
			"   - Known.md (26KB)",
			"   - … and 2 more",
		].join("\n");
		const hygiene = findings(stop, JSON.stringify({ systemMessage: report })).filter(({ row }) => row === "HY-10");
		assert.deepEqual(hygiene, [
			{ row: "HY-10", note: null, detail: "order: HY-09, HY-03" },
			{ row: "HY-10", note: null, detail: "HY-03 more" },
		]);
	});

	test("a write of two notes states how many blocks its envelope has, and a write of one note does not", () => {
		const blocks = "Vault hygiene warnings for `Known.md`:\n  - Missing YAML frontmatter\nFix these before moving on.\n\nA second block.";
		const two: Step = { hook: "validate-write", input: { kind: "write", notes: ["Known", "Other"] } };
		assert.deepEqual(whole(two, context("PostToolUse", blocks)).filter(({ row }) => row === "VW-16").map(({ detail, count }) => ({ detail, count })), [
			{ detail: "blocks", count: 2 },
		]);
		assert.deepEqual(findings(write, context("PostToolUse", blocks)).filter(({ row }) => row === "VW-16"), []);
	});

	test("the target of a policy result is the neutral name of the object", () => {
		const policy = { policy_id: "topic-cluster", path: "Known.md", classification: "ungrouped-cluster", suggested_target: "work/active/<Topic>/", action: "flag" };
		const stdout = JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "", policyResults: [policy] } });
		assert.equal(findings(write, stdout)[1]?.detail, "policy topic-cluster, ungrouped-cluster, flag, with the target {a topic group}");
	});

	test("each line that a run adds to the environment file is a finding, with no path of the run", () => {
		const environment = { ...ENVIRONMENT, projectDir: "/project" };
		const added = whole(payload("session-start"), "", { envFileAdded: "export VAULT_PATH='/project'\n" }, {}, environment);
		assert.deepEqual(added.map(({ row, detail }) => ({ row, detail })), [
			{ row: "SS-19", detail: "silent" },
			{ row: "SS-02", detail: "export VAULT_PATH='{project directory}'" },
		]);
		assert.deepEqual(findings(payload("session-start"), ""), [{ row: "SS-19", note: null, detail: "silent" }]);
	});

	test("the channel row of SessionStart tells a bad payload and a stand-down from a normal start", () => {
		assert.equal(findings({ hook: "session-start", input: { kind: "raw", stdin: "{" } }, "")[0]?.row, "SS-01");
		assert.equal(findings({ hook: "session-start", input: { kind: "payload", fields: { om_mod: "standdown" } } }, "")[0]?.row, "SS-03");
		assert.equal(findings(payload("session-start"), "")[0]?.row, "SS-19");
	});

	test("the re-entry flag of a Stop counts under each of its two spellings", () => {
		const reentry = (fields: Readonly<Record<string, unknown>>): string | undefined =>
			findings({ hook: "stop-checklist", input: { kind: "payload", fields } }, "{}")[0]?.row;
		assert.equal(reentry({ stop_hook_active: true }), "ST-02");
		assert.equal(reentry({ stopHookActive: true }), "ST-02");
		assert.equal(reentry({}), "ST-07");
	});

	test("the old backups that a PreCompact run removed are a finding, and the name of the new copy is not", () => {
		const kept = (indexes: readonly number[]): string[] => ["session_manual_20260105_120000.jsonl", ...indexes.map(oldSessionLogName)];
		const removed = (indexes: readonly number[]): (string | null)[] =>
			whole(payload("pre-compact"), "", { sessionLogs: kept(indexes) }, { oldSessionLogs: 4 })
				.filter(({ row }) => row === "PC-04")
				.map(({ detail }) => detail);
		assert.deepEqual(removed([1, 2, 3]), [null, "old backups removed: 0"]);
		assert.deepEqual(removed([0, 2, 3]), [null, "old backups removed: 1"]);
		assert.deepEqual(removed([0, 1, 2, 3]), [null, "old backups removed: none"]);
		assert.deepEqual(whole(payload("pre-compact"), "", { sessionLogs: kept([]) }).filter(({ row }) => row === "PC-04").map(({ detail }) => detail), [null]);
	});
});

describe("findingsOf with the wording of the form", () => {
	const session = context("SessionStart", "### Brain Topics (read on demand)\n- [[Known]] — A topic\n");
	const withWording = (wording: Wording): Brief[] => {
		const environment = { ...ENVIRONMENT, wording, noteOf: (reference: string) => (reference === "Known" ? "Known" : null) };
		return whole(payload("session-start"), session, {}, {}, environment).map(({ row, note, detail }) => ({ row, note, detail }));
	};

	test("the pattern of the form decides what a line is", () => {
		assert.deepEqual(withWording(MARKDOWN_WORDING).at(-1), { row: "SS-12", note: "Known", detail: "A topic" });
	});

	test("a kind with no pattern in the form gives an UNMAPPED finding", () => {
		const { "brain topic": _, ...rest } = MARKDOWN_WORDING.patterns;
		assert.deepEqual(withWording({ ...MARKDOWN_WORDING, patterns: rest }).at(-1), { row: "UNMAPPED", note: null, detail: "- [[Known]] — A topic" });
	});

	test("a pattern with no group for a part of its finding is an error, not a finding with less in it", () => {
		const patterns = { ...MARKDOWN_WORDING.patterns, "brain topic": /^- \[\[(?<note>[^\]]+)\]\] — .+$/ };
		assert.throws(() => withWording({ ...MARKDOWN_WORDING, patterns }), /"brain topic" has no group "detail"/);
	});
});

describe("the wording tables", () => {
	const tables: Readonly<Record<string, Wording>> = { Markdown: MARKDOWN_WORDING, Notion: NOTION_WORDING };

	for (const [form, wording] of Object.entries(tables)) {
		test(`each pattern of the ${form} wording has the groups of its kind`, () => {
			const missing = (Object.keys(wording.patterns) as TextKind[]).flatMap((kind) =>
				capturesOf(kind)
					.filter((capture) => !wording.patterns[kind]!.source.includes(`(?<${capture}>`))
					.map((capture) => `${kind}: ${capture}`),
			);
			assert.deepEqual(missing, []);
		});

		test(`no pattern of the ${form} wording keeps a position between two lines`, () => {
			assert.deepEqual((Object.keys(wording.patterns) as TextKind[]).filter((kind) => /[gy]/.test(wording.patterns[kind]!.flags)), []);
		});

		test(`each object name of the ${form} wording is text, has a neutral name in braces, and occurs one time`, () => {
			const names = wording.names.map(([name]) => name);
			assert.deepEqual(names.filter((name, index) => name === "" || names.indexOf(name) !== index), []);
			assert.deepEqual(wording.names.filter(([, neutral]) => !/\{[^{}]+\}/.test(neutral)), []);
		});
	}

	test("the Markdown wording has a pattern for each kind of text", () => {
		assert.deepEqual((Object.keys(TEXTS) as TextKind[]).filter((kind) => MARKDOWN_WORDING.patterns[kind] === undefined), []);
	});
});
