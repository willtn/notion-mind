/**
 * The user's one-line-per-section summary of a Stop report (lib/stop-report.ts),
 * and the preface the agent reads with the full report.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { AGENT_PREFACE, MOD_PREFACE, modPreface, SUMMARY_TRAILER, stopSummary } from "../lib/stop-report.ts";

const CHECKLIST = "Wrap-up checklist: archive · indexes";

describe("stopSummary", () => {
	test("the checklist line, one Hygiene line of claims, then where the detail went", () => {
		assert.deepEqual(stopSummary(CHECKLIST, ["2 notes done", "1 note too big"]).split("\n"), [
			CHECKLIST,
			"Hygiene: 2 notes done · 1 note too big",
			SUMMARY_TRAILER,
		]);
	});

	test("a clean vault is the checklist line and the trailer", () => {
		assert.deepEqual(stopSummary(CHECKLIST, []).split("\n"), [CHECKLIST, SUMMARY_TRAILER]);
	});

	test("the trailer is the caller's to set", () => {
		assert.ok(stopSummary(CHECKLIST, [], "elsewhere.").endsWith("\nelsewhere."));
	});
});

describe("AGENT_PREFACE", () => {
	test("tells the agent the report arrived with the user's message, which comes first", () => {
		assert.match(AGENT_PREFACE, /^Stop hook report, handed over with this message: /);
		assert.match(AGENT_PREFACE, /Deal with the user's message first/);
		assert.match(AGENT_PREFACE, /The user saw only a one-line summary of each section/);
	});
});

describe("modPreface", () => {
	test("MOD_PREFACE keeps this template's literal framing", () => {
		assert.equal(
			MOD_PREFACE,
			"Stop hook report, handed over with this message: when one of your earlier responses this session ended, these findings were new or changed since the last report. The user saw one line naming them under that response. Deal with this message first (it may be the user's, or a vault notice from the obsidian-mind plugin), then decide what the report calls for: act on what bears on the current work, ask the user when something needs their call, or leave it unmentioned if nothing needs doing. Never move or delete notes without asking, and do not recite the report back.",
		);
	});

	test("modPreface names the mod, and nothing else differs", () => {
		const preface = modPreface("x");
		assert.match(preface, /a vault notice from the x plugin/);
		assert.equal(preface.replace("the x plugin", "the obsidian-mind plugin"), MOD_PREFACE);
	});
});
