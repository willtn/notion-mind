/**
 * Integration tests for the Stop/SessionEnd hook entry point.
 * Locks the once-per-session Stop report, the always-on SessionEnd report,
 * re-entry flag semantics (`stop_hook_active` or `stopHookActive`), and the
 * JSON output envelope.
 *
 * Why Stop dedupes instead of moving to SessionEnd (#252): Stop fires after
 * every response on Claude Code, so an unconditional report repeats
 * unchanged drift on every turn. SessionEnd cannot carry it there instead —
 * Claude Code discards a SessionEnd hook's `systemMessage`.
 * So Stop reports once per session and again only when the report changes;
 * any other event reports every time.
 *
 * The envelope matters more than it looks. Session-boundary stdout is
 * JSON-or-nothing: Claude Code files plain text in the debug log —
 * silently, which is why plain text survived here so long. These tests parse stdout rather than regex-matching
 * it, so a regression back to plain text fails instead of passing on a
 * substring that appears inside the JSON either way.
 *
 * Each run reads a stand-in for Notion (`fakeWorkspace`), and no run reaches
 * the real workspace. A finding here is a row of the view "Hygiene:
 * oversized". The parity run on the real workspace is the live proof.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { HOOK_OUTPUT_MAX_CHARS } from "../lib/hook-io.ts";
import { takeHandoff } from "../lib/stop-handoff.ts";
import { AGENT_PREFACE, FEEDBACK_PREFACE, FEEDBACK_TRAILER, MOD_PREFACE, SUMMARY_TRAILER } from "../lib/stop-report.ts";
import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { fakeWorkspace, type FakeWorkspace } from "./_fake-notion.ts";
import { runScript as spawnHook, rmTemp } from "./_helpers.ts";

const SCRIPT = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../stop-checklist.ts",
);
const CLASSIFY = resolve(dirname(fileURLToPath(import.meta.url)), "../classify-message.ts");

let TMP_DIR = "";
let stateCounter = 0;
let handoffCounter = 0;
/** The workspace of a run that names none: no row in any view. */
let CLEAN: FakeWorkspace;

before(() => {
	TMP_DIR = mkdtempSync(join(tmpdir(), "stop-checklist-"));
	CLEAN = fakeWorkspace(join(TMP_DIR, "clean"));
});

after(() => {
	rmTemp(TMP_DIR);
});

/** A fresh, isolated dedupe-state path, so no test sees another's history. */
function freshState(): string {
	stateCounter += 1;
	return join(TMP_DIR, `checklist-state-${stateCounter}.json`);
}

/**
 * Run the hook with isolated dedupe state. Pass the same
 * `state` path to several calls to simulate one machine across turns.
 */
function run(
	stdin: string | object | null,
	opts: {
		readonly state?: string;
		readonly vault?: FakeWorkspace;
		readonly handoffDir?: string;
		readonly keep?: boolean;
		readonly env?: Readonly<Record<string, string>>;
	} = {},
) {
	handoffCounter += 1;
	const handoffDir = opts.handoffDir ?? join(TMP_DIR, `handoff-${handoffCounter}`);
	const result = spawnHook(SCRIPT, stdin, {
		STOP_CHECKLIST_STATE: opts.state ?? freshState(),
		STOP_HANDOFF_DIR: handoffDir,
		...(opts.vault ?? CLEAN).env,
		...opts.env,
	});
	// What the agent receives: the report Stop saved for the next prompt.
	const sid = typeof stdin === "object" && stdin !== null ? (stdin as { session_id?: unknown }).session_id : undefined;
	const handed = typeof sid === "string" && sid && opts.keep !== true ? takeHandoff(handoffDir, sid) : null;
	return { ...result, handed };
}

/** The full report of a run: the handed-over report after its preface, or the systemMessage where nothing was handed over. */
function reportOf(r: { readonly stdout: string; readonly handed: string | null }): string {
	if (r.handed === null) return shownOf(r.stdout);
	assert.ok(r.handed.startsWith(`${AGENT_PREFACE}\n\n`), `handed report lacks the preface: ${r.handed.slice(0, 80)}`);
	return r.handed.slice(AGENT_PREFACE.length + 2);
}

/** Parse stdout as the hook envelope, failing loudly if it isn't JSON. */
function envelopeOf(stdout: string): Record<string, unknown> {
	try {
		return JSON.parse(stdout) as Record<string, unknown>;
	} catch {
		return assert.fail(
			`stop-checklist must write a JSON envelope to stdout — got:\n  ${stdout}`,
		);
	}
}

/** What the user sees: the systemMessage, failing loudly if absent. */
function shownOf(stdout: string): string {
	const envelope = envelopeOf(stdout);
	const message = envelope["systemMessage"];
	assert.equal(
		typeof message,
		"string",
		`expected a string systemMessage — got: ${stdout}`,
	);
	return message as string;
}

const OVERSIZED_VIEW = "Hygiene: oversized";
const oversized = new Map<FakeWorkspace, Map<string, number>>();

/** A workspace with these oversized notes of 26,000 bytes in the Knowledge database (none = clean). */
function vault(name: string, ...notes: string[]): FakeWorkspace {
	const root = fakeWorkspace(join(TMP_DIR, name));
	oversized.set(root, new Map());
	for (const note of notes) oversize(root, note);
	return root;
}

/** Give `note` this size, which is one hygiene finding from 25,000 bytes. `null` removes the note. */
function oversize(root: FakeWorkspace, note: string, bytes: number | null = 26_000): void {
	const rows = oversized.get(root) ?? new Map<string, number>();
	if (bytes === null) rows.delete(note);
	else rows.set(note, bytes);
	root.setRows("knowledge", OVERSIZED_VIEW, [...rows].map(([Name, Bytes]) => ({ Name, Bytes, Type: "Reference" })));
}

// JSON.stringify drops an undefined session_id, so stop() is a Stop with none.
const stop = (session_id?: string) => ({ session_id, hook_event_name: "Stop", stop_hook_active: false });

describe("stop-checklist", () => {
	test("re-entry on strict boolean true emits the empty envelope", () => {
		const { stdout, code } = run({ stop_hook_active: true });
		assert.equal(code, 0);
		// `{}` rather than zero bytes: stdout is JSON-or-nothing here and
		// "nothing" is only documented by omission. The object carries no
		// field, so nothing renders on any agent.
		assert.deepEqual(envelopeOf(stdout), {});
	});

	test("re-entry writes its envelope before exiting", () => {
		// Regression guard for a platform-specific truncation: stdout is a
		// pipe, pipe writes are async on Windows, and this path writes and
		// then immediately calls process.exit(). A non-sync write here
		// arrives empty on Windows and passes everywhere else.
		const { stdout } = run({ stop_hook_active: true });
		assert.equal(stdout, "{}");
	});

	test("the first Stop of a session reports the checklist and findings", () => {
		const root = vault("first-stop", "Done");
		const message = reportOf(run(stop("s-first"), { vault: root }));
		assert.match(message, /Wrap-up checklist:/);
		assert.match(message, /^ {3}- Done \(26KB\)$/m);
	});

	test("a later Stop with an unchanged report is silent (#252)", () => {
		const root = vault("unchanged", "Done");
		const state = freshState();
		const first = run(stop("s-same"), { vault: root, state });
		const second = run(stop("s-same"), { vault: root, state });
		const third = run(stop("s-same"), { vault: root, state });
		assert.match(reportOf(first), /^ {3}- Done \(26KB\)$/m);
		assert.deepEqual(envelopeOf(second.stdout), {});
		assert.deepEqual(envelopeOf(third.stdout), {});
	});

	test("a Stop whose findings changed reports again", () => {
		const root = vault("changed", "Done");
		const state = freshState();
		run(stop("s-change"), { vault: root, state });
		oversize(root, "Also Done");
		const message = reportOf(run(stop("s-change"), { vault: root, state }));
		assert.match(message, /^ {3}- Also Done \(26KB\)$/m);
	});

	test("a report that returns to an earlier one is shown again (A → B → A)", () => {
		// Drift fixed, then reintroduced: the last report shown was the clean
		// one, so the returning finding is a change and must reach the user.
		const root = vault("revert", "Done");
		const state = freshState();
		const a1 = run(stop("s-revert"), { vault: root, state });
		oversize(root, "Done", null);
		const b = run(stop("s-revert"), { vault: root, state });
		oversize(root, "Done");
		const a2 = run(stop("s-revert"), { vault: root, state });
		assert.match(reportOf(a1), /^ {3}- Done \(26KB\)$/m);
		assert.doesNotMatch(reportOf(b), /Workspace Hygiene/);
		assert.match(reportOf(a2), /^ {3}- Done \(26KB\)$/m);
	});

	test("a note growing past the threshold does not re-show the report", () => {
		// The message carries "(31KB)"-style sizes and day ages; those move
		// with no new drift, so they are left out of the comparison. A note
		// the agent keeps appending to must not bring back the per-turn repeat.
		const root = vault("growing", "Log");
		const state = freshState();
		const first = run(stop("s-grow"), { vault: root, state });
		oversize(root, "Log", 40_000);
		const second = run(stop("s-grow"), { vault: root, state });
		assert.match(reportOf(first), /- Log \(26KB\)/);
		assert.deepEqual(envelopeOf(second.stdout), {});
	});

	test("two oversized notes trading places by size does not re-show the report", () => {
		// The scan lists oversized notes largest first. Growing the smaller one
		// past the larger reorders the list; the findings are the same notes.
		const root = vault("two-growing", "B");
		oversize(root, "A", 30_000);
		const state = freshState();
		const first = run(stop("s-two-grow"), { vault: root, state });
		oversize(root, "B", 34_000);
		const second = run(stop("s-two-grow"), { vault: root, state });
		assert.match(reportOf(first), /- A \(30KB\)\n {3}- B \(26KB\)/);
		assert.deepEqual(envelopeOf(second.stdout), {});
	});

	test("a changed Stop shows the user a summary and saves the full report for the next prompt (#256)", () => {
		// Every Stop output that reaches the model is printed in full for the
		// user: a block reason as a "Stop hook error", Stop additionalContext as
		// "Stop hook feedback". So Stop shows a summary, and the next prompt's
		// UserPromptSubmit, which the user never sees, hands the report over.
		const root = vault("block", "Done");
		const result = run(stop("s-block"), { vault: root });
		const envelope = envelopeOf(result.stdout);
		assert.deepEqual(Object.keys(envelope), ["systemMessage"], "no decision, no additionalContext: both are printed in full");
		const summary = String(envelope["systemMessage"]);
		assert.match(summary, /^Wrap-up checklist: archive completed work/);
		assert.match(summary, /^Hygiene: 1 note\(s\) past the 25KB organization threshold$/m);
		assert.doesNotMatch(summary, /- Done \(26KB\)/, "the user sees the summary, not the listing");
		assert.match(summary, /The full report reaches the agent with your next message\.$/);
		assert.match(result.handed ?? "", /^Stop hook report, handed over with this message: .*ask the user when something needs their call/);
		assert.match(result.handed ?? "", /^ {3}- Done \(26KB\)$/m);
	});

	test("a report that cannot be saved goes out as Stop feedback, framed for a turn with no user message", () => {
		// A regular file where the directory should be: mkdir fails, so the
		// next prompt would have nothing to hand over.
		const root = vault("block-unsaved", "Done");
		const blocked = join(TMP_DIR, "handoff-is-a-file");
		writeFileSync(blocked, "");
		const result = run(stop("s-unsaved"), { vault: root, handoffDir: blocked });
		const envelope = envelopeOf(result.stdout);
		// Both readers are told what is true here: the report went to the agent
		// now, in a turn with no user message, and the user sees it in full.
		const summary = String(envelope["systemMessage"]);
		assert.match(summary, /^Hygiene: 1 note\(s\) past the 25KB/m);
		assert.ok(summary.endsWith(FEEDBACK_TRAILER), summary);
		assert.ok(!summary.includes(SUMMARY_TRAILER), "it does not wait for the next message");
		const output = envelope["hookSpecificOutput"] as Record<string, unknown>;
		assert.equal(output["hookEventName"], "Stop");
		const context = String(output["additionalContext"]);
		assert.ok(context.startsWith(FEEDBACK_PREFACE), context.slice(0, 120));
		assert.doesNotMatch(context, /handed over with this message/);
		assert.match(context, /^ {3}- Done \(26KB\)$/m);
	});

	test("a saved report prunes the week-old ones a session never collected", () => {
		const root = vault("block-prune", "Done");
		const dir = join(TMP_DIR, "handoff-prune");
		mkdirSync(dir, { recursive: true });
		const stale = join(dir, "abandoned.txt");
		writeFileSync(stale, "an old report");
		const eightDaysAgo = (Date.now() - 8 * 24 * 60 * 60 * 1000) / 1000;
		utimesSync(stale, eightDaysAgo, eightDaysAgo);
		run(stop("s-prune"), { vault: root, handoffDir: dir });
		assert.equal(existsSync(stale), false);
	});

	test("an unchanged Stop saves nothing for the next prompt", () => {
		const root = vault("block-quiet-2", "Done");
		const state = freshState();
		run(stop("s-quiet-2"), { vault: root, state });
		const second = run(stop("s-quiet-2"), { vault: root, state });
		assert.deepEqual(envelopeOf(second.stdout), {});
		assert.equal(second.handed, null);
	});

	test("a re-entered Stop is silent and saves nothing", () => {
		// Fresh state, so the change check would report: only the
		// stop_hook_active exit keeps a forced turn's Stop silent.
		const root = vault("block-reentry", "Done");
		const reentry = run({ session_id: "s-block-reentry", hook_event_name: "Stop", stop_hook_active: true }, { vault: root });
		assert.deepEqual(envelopeOf(reentry.stdout), {});
		assert.equal(reentry.handed, null);
	});

	test("a long hygiene list is capped, so the report stays under the hook output cap (#254)", () => {
		// Four hundred long names made a report several times the cap before
		// hygiene lists were capped; the headline keeps the full count.
		const names = Array.from({ length: 400 }, (_, i) => `An oversized note with a deliberately long descriptive title ${i}`);
		const root = vault("block-huge", ...names);
		// The report is saved whole and cut only where it is delivered, beside the
		// routing hints, so measure it there: a prompt that raises every hint at once.
		const dir = join(TMP_DIR, "handoff-huge");
		const stopRun = run(stop("s-block-huge"), { vault: root, handoffDir: dir, keep: true });
		assert.ok(stopRun.stdout.length <= HOOK_OUTPUT_MAX_CHARS, `Stop stdout is ${stopRun.stdout.length} chars`);
		const prompt =
			"We decided on the new architecture after the outage incident. In my 1:1 with my manager we agreed we shipped it, a big win, and the project milestone is done.";
		const delivered = spawnHook(CLASSIFY, { session_id: "s-block-huge", hook_event_name: "UserPromptSubmit", prompt }, {
			STOP_HANDOFF_DIR: dir,
			CLASSIFY_HINT_STATE: join(TMP_DIR, "hints-huge.json"),
		});
		assert.ok(delivered.stdout.length <= HOOK_OUTPUT_MAX_CHARS, `UserPromptSubmit stdout is ${delivered.stdout.length} chars`);
		const context = String((envelopeOf(delivered.stdout)["hookSpecificOutput"] as Record<string, unknown>)["additionalContext"]);
		assert.ok((context.match(/^- /gm) ?? []).length >= 5, "the prompt raised most of the routing hints");
		assert.match(context, /⚠️ {2}400 note\(s\) past the 25KB organization threshold/);
		assert.match(context, /^ {3}- … and 390 more$/m);
		assert.doesNotMatch(context, /truncated to fit/);
	});

	test("SessionEnd and a Stop without a session_id show the full report and save nothing", () => {
		// Neither has a next prompt in this session for the report to ride.
		const root = vault("block-never", "Done");
		for (const payload of [stop(), { session_id: "s-end", hook_event_name: "SessionEnd" }]) {
			const result = run(payload, { vault: root });
			const envelope = envelopeOf(result.stdout);
			assert.deepEqual(Object.keys(envelope), ["systemMessage"]);
			assert.match(String(envelope["systemMessage"]), /^ {3}- Done \(26KB\)$/m);
			assert.equal(result.handed, null);
		}
	});

	test("a new session reports again even when nothing changed", () => {
		const root = vault("new-session", "Done");
		const state = freshState();
		run(stop("s-one"), { vault: root, state });
		const other = run(stop("s-two"), { vault: root, state });
		assert.match(reportOf(other), /^ {3}- Done \(26KB\)$/m);
	});

	test("a clean vault still gets the checklist once, then silence", () => {
		const root = vault("clean-vault");
		const state = freshState();
		const first = run(stop("s-clean"), { vault: root, state });
		const second = run(stop("s-clean"), { vault: root, state });
		assert.match(reportOf(first), /Wrap-up checklist:/);
		assert.doesNotMatch(reportOf(first), /Workspace Hygiene/);
		assert.deepEqual(envelopeOf(second.stdout), {});
	});

	test("a Stop without a session_id fails open and reports every time", () => {
		// Same rule as the classifier's hint dedupe (#107): no key to
		// remember by means today's behaviour, never silence.
		const state = freshState();
		const first = run(stop(), { state });
		const second = run(stop(), { state });
		assert.match(reportOf(first), /Wrap-up checklist:/);
		assert.match(reportOf(second), /Wrap-up checklist:/);
	});

	test("an unreadable dedupe state fails open", () => {
		const state = freshState();
		writeFileSync(state, "not json{{");
		const { stdout } = run(stop("s-corrupt"), { state });
		assert.match(shownOf(stdout), /Wrap-up checklist:/);
	});

	// The disagreeing pairs pin "either spelling", which a `??` between the two
	// keys would break.
	for (const payload of [
		{ stopHookActive: true },
		{ stop_hook_active: false, stopHookActive: true },
		{ stop_hook_active: true, stopHookActive: false },
	]) {
		test(`either boolean re-entry flag suppresses reporting: ${JSON.stringify(payload)}`, () => {
			const root = vault("camel-reentry", "Done");
			const result = run({ ...stop("s-camel-reentry"), ...payload }, { vault: root });
			assert.deepEqual(envelopeOf(result.stdout), {});
			assert.equal(result.handed, null);
		});
	}

	for (const payload of [{ stop_hook_active: "true" }, { stopHookActive: "true" }]) {
		test(`a string re-entry flag is not re-entry: ${JSON.stringify(payload)}`, () => {
			const { stdout } = run({ ...stop("s-string"), ...payload });
			assert.match(shownOf(stdout), /Wrap-up checklist:/);
		});
	}

	test("SessionEnd reports every time — it is the last chance, not a turn", () => {
		const root = vault("session-end", "Done");
		const state = freshState();
		const payload = { session_id: "s-end", hook_event_name: "SessionEnd" };
		const first = run(payload, { vault: root, state });
		const second = run(payload, { vault: root, state });
		assert.match(reportOf(first), /^ {3}- Done \(26KB\)$/m);
		assert.match(reportOf(second), /^ {3}- Done \(26KB\)$/m);
	});

	test("SessionEnd after a deduped Stop still reports", () => {
		const root = vault("stop-then-end", "Done");
		const state = freshState();
		run(stop("s-mixed"), { vault: root, state });
		const end = run({ session_id: "s-mixed", hook_event_name: "SessionEnd" }, { vault: root, state });
		assert.match(reportOf(end), /^ {3}- Done \(26KB\)$/m);
	});

	test("the checklist hands drift to om-tidy", () => {
		const message = reportOf(run(stop("s-handoff")));
		assert.match(message, /ask the agent to run om-tidy/i);
	});

	test("malformed input emits a valid default", () => {
		const { stdout, code } = run("garbage{{");
		assert.equal(code, 0);
		assert.match(shownOf(stdout), /Wrap-up checklist:/);
	});

	test("empty stdin emits a valid default", () => {
		const { stdout, code } = run(null);
		assert.equal(code, 0);
		assert.match(shownOf(stdout), /Wrap-up checklist:/);
	});

	test("does not terminate the message with a stray newline", () => {
		// systemMessage is rendered by the agent's UI, not written to a
		// stream — a trailing newline is padding in all three.
		const message = reportOf(run({}));
		assert.equal(message, message.trimEnd());
	});

	// The script reads a Stop and a SessionEnd payload. Payloads mirror the
	// documented schema. Each runs against fresh state, so the first report of
	// each is the one compared.
	const AGENT_PAYLOADS: ReadonlyArray<{
		readonly label: string;
		readonly payload: Record<string, unknown>;
	}> = [
		{
			label: "Claude Code Stop",
			payload: {
				session_id: "s1",
				transcript_path: "/tmp/t.json",
				cwd: ".",
				permission_mode: "default",
				hook_event_name: "Stop",
				last_assistant_message: "done",
				stop_hook_active: false,
			},
		},
		{
			label: "SessionEnd",
			payload: {
				session_id: "s1",
				transcript_path: "/tmp/t.json",
				cwd: ".",
				hook_event_name: "SessionEnd",
				timestamp: "2026-08-03T12:00:00Z",
				reason: "exit",
			},
		},
	];

	// A Stop shows the user a summary and hands the full report over with the
	// next prompt; SessionEnd shows the full report. The full report
	// itself must not vary by event.
	const rendered = new Set<string>();
	for (const { label, payload } of AGENT_PAYLOADS) {
		test(`${label} receives the same full report`, () => {
			const result = run(payload);
			assert.equal(result.code, 0);
			const message = reportOf(result);
			assert.match(message, /Wrap-up checklist:/);
			rendered.add(message);
		});
	}

	test("the full report does not vary by event", () => {
		assert.equal(
			rendered.size,
			1,
			`every event must get the same full report — got ${rendered.size} variants`,
		);
	});
});

/**
 * Under the template's Claude Code mod (#264, lib/om-mod.ts) the mod presents
 * the Stop report. `standdown` on the Stop it passes down must leave no trace;
 * `report` is the mod's own run and returns the report as data, claiming no
 * state and handing nothing over, because the mod owns both.
 */
describe("stop-checklist — om_mod (a Claude Code mod)", () => {
	const flagged = (session_id: string, om_mod: string) => ({ ...stop(session_id), om_mod });
	test("standdown writes the empty envelope and touches no state and no handoff", () => {
		const root = vault("ommod-standdown", "Done");
		const state = freshState();
		const dir = join(TMP_DIR, "handoff-ommod-standdown");
		const result = run(flagged("s-standdown", "standdown"), { vault: root, state, handoffDir: dir, keep: true });
		assert.equal(result.code, 0);
		assert.equal(result.stdout, "{}");
		assert.equal(existsSync(state), false, "no dedupe state claimed");
		assert.equal(existsSync(dir), false, "no report saved for the next prompt");
	});

	test("the same Stop without the flag does claim state and hand the report over (the checks above can fail)", () => {
		const root = vault("ommod-plain", "Done");
		const state = freshState();
		const result = run(stop("s-plain"), { vault: root, state });
		assert.equal(existsSync(state), true);
		assert.ok(result.handed?.includes("- Done (26KB)"));
	});

	test("report returns the report as data, and claims no state and hands nothing over", () => {
		const root = vault("ommod-report", "Done");
		const state = freshState();
		const dir = join(TMP_DIR, "handoff-ommod-report");
		const result = run(flagged("s-report", "report"), { vault: root, state, handoffDir: dir, keep: true });
		assert.equal(result.code, 0);
		const { report } = envelopeOf(result.stdout) as { report: { key: string; claims: string[]; agentText: string } };
		assert.deepEqual(Object.keys(report).sort(), ["agentText", "claims", "key"], "data only: the mod draws its own line");
		assert.match(report.key, /^[0-9a-f]{16,}$/);
		assert.ok(report.claims.length > 0, "the drift is a claim");
		assert.ok(report.agentText.startsWith(`${MOD_PREFACE}\n\n`), "the mod's report carries the mod's framing, not the settings hook's");
		assert.match(report.agentText, /^ {3}- Done \(26KB\)$/m);
		assert.equal(existsSync(state), false, "the mod decides when the report changed");
		assert.equal(existsSync(dir), false, "the mod hands the report over");
	});

	for (const flag of [{ stop_hook_active: true }, { stopHookActive: true }]) {
		test(`report answers even on a re-entry event: the mod decides when to ask: ${JSON.stringify(flag)}`, () => {
			const root = vault("ommod-reentry", "Done");
			const result = run({ ...flagged("s-reentry", "report"), ...flag }, { vault: root });
			const envelope = envelopeOf(result.stdout) as { report?: { agentText: string } };
			assert.ok(envelope.report, `expected a report, got ${result.stdout}`);
			assert.match(envelope.report.agentText, /^ {3}- Done \(26KB\)$/m);
		});
	}

	test("report's key is the report's identity: stable for the same findings, different when they change", () => {
		const root = vault("ommod-key", "Done");
		const keyOf = () => (envelopeOf(run(flagged("s-key", "report"), { vault: root }).stdout) as { report: { key: string } }).report.key;
		const first = keyOf();
		assert.equal(keyOf(), first);
		oversize(root, "Also Done");
		assert.notEqual(keyOf(), first);
	});

	test("an unknown om_mod value changes nothing: output identical to a Stop with no flag", () => {
		const root = vault("ommod-unknown", "Done");
		const plain = run(stop("s-unknown"), { vault: root });
		const unknown = run(flagged("s-unknown", "silence"), { vault: root });
		assert.equal(unknown.stdout, plain.stdout);
		assert.equal(unknown.handed, plain.handed);
		assert.ok(plain.handed?.includes("- Done (26KB)"));
	});
});

/**
 * The hygiene findings come from Notion view queries (lib/hygiene-scan.ts).
 * These tests pin what the hook does with the scan: it only reads, it reads
 * the watched types from the manifest, and a part that it cannot read is in
 * the report in place of a silent gap.
 */
describe("stop-checklist — the scan of the Notion workspace", () => {
	const daysAgo = (days: number): string => new Date(Date.now() - days * 86_400_000).toISOString();
	const loop = (Name: string, Type: string) => ({ Name, Type, "Open loops": 1, "date:Changed:start": daysAgo(30) });

	test("each Notion call of a Stop is a view query, so the hook changes no page", () => {
		const root = vault("scan-reads", "Done");
		run(stop("s-scan-reads"), { vault: root });
		const calls = root.calls();
		assert.ok(calls.length >= 4, `${calls.length} calls`);
		assert.deepEqual([...new Set(calls.map(({ tool }) => tool))], ["notion-query-data-sources"]);
		assert.ok(calls.every(({ args }) => (args["data"] as { mode?: string }).mode === "view"));
	});

	test("a Stop that stands down or re-enters makes no Notion call", () => {
		const root = vault("scan-quiet", "Done");
		run({ ...stop("s-scan-quiet"), om_mod: "standdown" }, { vault: root });
		run({ ...stop("s-scan-quiet"), stop_hook_active: true }, { vault: root });
		assert.deepEqual(root.calls(), []);
	});

	test("the open loops count for the types that open_loop_types of the manifest names", () => {
		const rows = [loop("Vendor Review", "Work note"), loop("Checkout Outage", "Incident")];
		const byDefault = fakeWorkspace(join(TMP_DIR, "scan-types-default"));
		byDefault.setRows("work", "Hygiene: open loops", rows);
		const report = reportOf(run(stop("s-types-default"), { vault: byDefault }));
		assert.match(report, /1 note\(s\) with open follow-ups untouched 14\+ days/);
		assert.match(report, /- Checkout Outage \(30d, 1 open item\(s\)\)/);
		assert.doesNotMatch(report, /Vendor Review/);

		const workNotes = fakeWorkspace(join(TMP_DIR, "scan-types-manifest"), { open_loop_types: ["Work note"] });
		workNotes.setRows("work", "Hygiene: open loops", rows);
		const other = reportOf(run(stop("s-types-manifest"), { vault: workNotes }));
		assert.match(other, /- Vendor Review \(30d, 1 open item\(s\)\)/);
		assert.doesNotMatch(other, /Checkout Outage/);
	});

	test("a view that Notion does not return is named in the report, and each other finding stays", () => {
		const root = vault("scan-one-fails", "Done");
		root.setRows("work", "Hygiene: inbox pressure", { error: JSON.stringify({ code: "internal_server_error", message: "try again" }) });
		const result = run(stop("s-one-fails"), { vault: root });
		const report = reportOf(result);
		assert.match(report, /^ {3}- Done \(26KB\)$/m);
		assert.match(report, /⚠️ {2}1 part\(s\) of the hygiene scan not read — the findings of each one are not in this report:\n {3}- "Hygiene: inbox pressure" of Work \(.*try again.*\)/);
		assert.match(shownOf(result.stdout), /^Hygiene: 1 note\(s\) past the 25KB organization threshold · 1 part\(s\) of the hygiene scan not read$/m);
	});

	test("the words of a failure are not a part of the report identity, so the same failure does not show again", () => {
		const root = vault("scan-fails-twice");
		const state = freshState();
		root.setRows("work", "Hygiene: inbox pressure", { error: JSON.stringify({ code: "internal_server_error", message: "first words" }) });
		const first = run(stop("s-fails-twice"), { vault: root, state });
		root.setRows("work", "Hygiene: inbox pressure", { error: JSON.stringify({ code: "internal_server_error", message: "other words" }) });
		const second = run(stop("s-fails-twice"), { vault: root, state });
		assert.match(reportOf(first), /first words/);
		assert.deepEqual(envelopeOf(second.stdout), {});
	});

	test("a project with no map file gets the checklist, the findings of the local files, and the name of the file that is missing", () => {
		const root = join(TMP_DIR, "scan-no-map");
		mkdirSync(root, { recursive: true });
		writeFileSync(join(root, "vault-manifest.json"), "{}");
		writeFileSync(join(root, "AGENTS.md"), "x".repeat(23_000));
		const notion = fakeWorkspace(join(TMP_DIR, "scan-no-map-notion"));
		const result = run(stop(), { vault: notion, env: { CLAUDE_PROJECT_DIR: root } });
		assert.equal(result.code, 0);
		const message = shownOf(result.stdout);
		assert.match(message, /^Wrap-up checklist:/);
		assert.match(message, /⚠️ {2}AGENTS\.md is 23KB/);
		assert.match(message, /1 part\(s\) of the hygiene scan not read[^\n]*\n {3}- the Notion map file \(Cannot read the Notion map file/);
		assert.deepEqual(notion.calls(), [], "no Notion call without the map file");
	});
});
