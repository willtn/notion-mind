#!/usr/bin/env node
/**
 * Conversation-boundary hook: the wrap-up checklist plus the hygiene
 * findings of the Notion workspace (lib/hygiene-scan.ts).
 *
 * Claude Code calls it on Stop, which fires after EVERY response, not at the
 * end of the session. An unconditional report there repeats unchanged drift on
 * every turn, and a warning that never changes is one users learn to ignore
 * (#155). So on Stop the report is shown once per session and again only when
 * its text changes; otherwise the hook emits the empty envelope.
 *
 * Claude Code is deliberately NOT wired to SessionEnd: it discards a
 * SessionEnd hook's systemMessage. Moving the report there would turn "every
 * turn" into "never".
 *
 * Who reads it: a Stop hook's systemMessage reaches the user and never the
 * agent, so the drift the agent is best placed to fix never reached it
 * (#256). On a Stop whose findings changed, the user gets a
 * one-line-per-section summary as the `systemMessage`, and the full report is
 * saved for the session's next prompt, where classify-message hands it to the
 * agent (why that channel: lib/stop-handoff.ts). If the report cannot be
 * saved, it goes out as Stop feedback instead: visible, but not lost
 * (lib/hook-io.ts). An event that is not Stop, and a Stop without a
 * session_id, have no next prompt to ride: the user gets the full report.
 *
 * Output is JSON, never plain text: Claude Code otherwise files non-exempt
 * stdout in the debug log. Both `systemMessage` and the handed-over report are
 * held under Claude Code's hook output cap (lib/hook-io.ts).
 * The documented event name is the only branch. A field spelled two ways is
 * read under both, so it means the same thing whoever sent it (the re-entry
 * flag below).
 *
 * Under the template's Claude Code mod (#264, lib/om-mod.ts) the mod presents
 * the report itself: it runs this script with `om_mod: "report"` to get the
 * report as data, and flags the Stop it passes down with
 * `om_mod: "standdown"`, on which this hook writes the empty envelope and
 * does nothing else. Without the mod, nothing sends the flag.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	readStdinJson,
	writeSilentHookOutput,
	writeStopFeedback,
	writeStopReportData,
	writeSystemMessage,
} from "./lib/hook-io.ts";
import { readOmMod } from "./lib/om-mod.ts";
import { envPath } from "./lib/env-path.ts";
import { HANDOFF_DIR, pruneHandoffs, writeHandoff } from "./lib/stop-handoff.ts";
import { AGENT_PREFACE, FEEDBACK_PREFACE, FEEDBACK_TRAILER, MOD_PREFACE, stopSummary } from "./lib/stop-report.ts";
import { parseOpenLoopConfig } from "./lib/active-hygiene.ts";
import { formatHygiene, HYGIENE_VOLATILE_FIELDS, hygieneClaims, hygieneNotRead, scanHygiene, type HygieneReport } from "./lib/hygiene-scan.ts";
import { claimChanged } from "./lib/hint-state.ts";
import { notionMapPath, readNotionMap, type NotionMap } from "./lib/notion-map.ts";
import { reportKey } from "./lib/report-key.ts";
import { resolveProjectDir } from "./lib/project-dir.ts";
import { lazyNotion, NOTION_BUDGET_MS } from "./lib/write-hook.ts";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
// The last report each session was shown (lib/hint-state.ts, the same
// self-pruning, fail-open store as the classifier's hint dedupe, #107).
// STOP_CHECKLIST_STATE routes it to a tmp path for tests.
const STATE_PATH = envPath(process.env, "STOP_CHECKLIST_STATE", join(SCRIPT_DIR, ".checklist-state.json"));

type HookInput = {
	readonly hook_event_name?: unknown;
	readonly session_id?: unknown;
	readonly stop_hook_active?: unknown;
	readonly stopHookActive?: unknown;
};

const input = await readStdinJson<HookInput>();
// The mod presents this Stop (lib/om-mod.ts): the empty envelope, no state,
// no handoff.
const omMod = readOmMod(input);
if (omMod === "standdown") {
	writeSilentHookOutput();
	process.exit(0);
}
// Re-entry (the Stop after a turn some Stop hook forced, or a secondary
// agent's): say nothing, which keeps a forced turn from looping,
// but still emit the empty envelope rather than zero bytes — see
// writeSilentHookOutput for why "sometimes silent, sometimes JSON" is the
// weaker contract.
// The mod's `report` run is not a re-entry: the mod decides when to ask.
// The flag counts under either spelling, whichever agent sent it: Grok's Stop
// carries only `stopHookActive` (#323).
if ((input?.stop_hook_active === true || input?.stopHookActive === true) && omMod !== "report") {
	writeSilentHookOutput();
	process.exit(0);
}

// Each item as the full report says it and as the user's summary says it.
const CHECKLIST_ITEMS: readonly (readonly [full: string, short: string])[] = [
	["Archive completed projects? (`Status` active -> completed or archived)", "archive completed work"],
	["Update indexes? (Home, North Star, People & Context)", "update indexes"],
	["New notes linked? (orphans are bugs)", "link new notes"],
	["Ask the agent to run om-vault-audit if many notes were created/modified", "om-vault-audit if many notes changed"],
	["To act on any drift, ask the agent to run om-tidy", "ask the agent to run om-tidy for drift"],
];
const checklist = ["Wrap-up checklist:", ...CHECKLIST_ITEMS.map(([full]) => `- ${full}`)].join("\n");
const CHECKLIST_SUMMARY = `Wrap-up checklist: ${CHECKLIST_ITEMS.map(([, short]) => short).join(" · ")}`;

// Concrete drift findings beat a generic checklist (#98/#103/#106): the
// same scan SessionStart runs, so the session closes against the same
// facts it opened with. Silent when clean.
const vaultRoot = resolveProjectDir(process.cwd());
let manifestJson: string | null = null;
try {
	manifestJson = readFileSync(join(vaultRoot, "vault-manifest.json"), {
		encoding: "utf-8",
	});
} catch {
	/* missing manifest → default open-loop config */
}

/** Without the map file the scan cannot start. The checklist and the findings of the local files still go out. */
async function scan(): Promise<HygieneReport> {
	let map: NotionMap;
	try {
		map = readNotionMap(notionMapPath(vaultRoot));
	} catch (error) {
		return hygieneNotRead(vaultRoot, "the Notion map file", error);
	}
	// The scan sends 9 view queries at one time. With 4 at one time it took 1.4 s, and with all at one time 0.9 to 1.1 s (measured).
	const notion = lazyNotion(NOTION_BUDGET_MS, { concurrency: 9 });
	const found = await scanHygiene({ call: notion.call, map, projectDir: vaultRoot, nowMs: Date.now(), watchedTypes: parseOpenLoopConfig(manifestJson).types });
	await notion.close();
	return found;
}
const report = await scan();
const hygieneLines = formatHygiene(report);

// No trailing newline: this is a message rendered by the agent's UI, not a
// line written to a stream.
const message =
	checklist +
	(hygieneLines.length > 0
		? "\n\nWorkspace Hygiene (drift detected):\n" + hygieneLines.join("\n")
		: "");

// SessionEnd (and any input without a recognisable event, the safe default)
// always reports. Stop reports when the findings differ from the last report
// this session was shown: the first Stop, and any change since, including
// drift that was fixed and then came back. A missing session_id fails open
// to reporting.
const sessionId = input?.session_id;
const isStop = input?.hook_event_name === "Stop";
const hasSession = typeof sessionId === "string" && sessionId !== "";
const key = reportKey({ checklist, report }, HYGIENE_VOLATILE_FIELDS);
const claims = hygieneClaims(report);

if (omMod === "report") {
	// The mod's own run (lib/om-mod.ts): the report as data. The mod draws the
	// line, hands the agent the report and decides when it changed, so no
	// state is claimed and nothing is handed over here. `key` is the report's
	// identity, the same one the Stop dedupe below compares.
	writeStopReportData({ key, claims, agentText: `${MOD_PREFACE}\n\n${message}` });
} else if (isStop && hasSession && !claimChanged(STATE_PATH, sessionId, key)) writeSilentHookOutput();
else if (isStop && hasSession) {
	// The summary now, the full report with the next prompt; Stop feedback if it cannot be saved.
	try {
		pruneHandoffs(HANDOFF_DIR, Date.now());
		writeHandoff(HANDOFF_DIR, sessionId, `${AGENT_PREFACE}\n\n${message}`);
		writeSystemMessage(stopSummary(CHECKLIST_SUMMARY, claims));
	} catch {
		writeStopFeedback(`${FEEDBACK_PREFACE}\n\n${message}`, stopSummary(CHECKLIST_SUMMARY, claims, FEEDBACK_TRAILER));
	}
}
else writeSystemMessage(message);
