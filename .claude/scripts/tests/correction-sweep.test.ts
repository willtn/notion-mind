/**
 * The correction sweep's judgement, pinned.
 *
 * The search half of a sweep is cheap and its failures are visible: a missed
 * page keeps saying something stale until someone reads it. The classification
 * half is neither. Rewriting a page that correctly recorded what was believed at
 * the time destroys a true record, leaves the page reading perfectly fine, and
 * cannot be detected afterwards by anything.
 *
 * So these tests are weighted towards what must NOT be touched.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { isHistoricalNote, classifyCandidate, planSweep, type SweepCandidate } from "../lib/correction-sweep.ts";

const page = (n: number): string => `https://app.notion.com/p/${String(n).padStart(32, "0")}`;
const row = (url: string, title: string, type?: string, status?: unknown): SweepCandidate => ({
	url,
	title,
	...(type === undefined ? {} : { type }),
	...(status === undefined ? {} : { status }),
});

describe("isHistoricalNote", () => {
	test("an archived row is historical whatever it is titled", () => {
		assert.equal(isHistoricalNote({ title: "Search Rollout", type: "Work note", status: "archived" }), true);
	});

	test("a 1:1 is historical", () => {
		// Carried by the type rule, not the date: the title has no date.
		// The date rule is isolated below, because a test that passes
		// for a reason it does not name pins nothing.
		assert.equal(isHistoricalNote({ title: "Dana Ruiz", type: "1:1" }), true);
	});

	test("an inbox item, a thinking note, and an incident are historical", () => {
		for (const type of ["Inbox item", "Thinking", "Incident"]) assert.equal(isHistoricalNote({ title: "Platform Sync", type }), true, type);
	});

	test("an event-log satellite and an archive note are historical", () => {
		for (const type of ["Event-log satellite", "Archive note"]) assert.equal(isHistoricalNote({ title: "Search Log", type }), true, type);
	});

	// The date signal ON ITS OWN: no historical type, no status, nothing but the date.
	test("a date in the title is enough by itself, prefix or suffix", () => {
		// The suffix case is the one that matters. The 1:1 convention is
		// `<Person> YYYY-MM-DD`, so a rule anchored at the start of the title
		// looks correct and silently misses every dated page of another type.
		assert.equal(isHistoricalNote({ title: "Reorg Notes 2026-03-02", type: "Work note", status: "active" }), true);
		assert.equal(isHistoricalNote({ title: "2026-03-02 Platform Sync", type: "Work note", status: "active" }), true);
	});

	test("a deprecated decision is historical on its status alone", () => {
		assert.equal(isHistoricalNote({ title: "Search Rollout", type: "Decision", status: "deprecated" }), true);
	});

	test("a completed work note is historical, because it describes what was done", () => {
		assert.equal(isHistoricalNote({ title: "Search Rollout", type: "Work note", status: "completed" }), true);
	});

	test("a living work note is NOT historical", () => {
		assert.equal(isHistoricalNote({ title: "Search Quality", type: "Work note", status: "active" }), false);
	});

	test("an accepted or proposed decision is NOT historical", () => {
		for (const status of ["accepted", "proposed"]) assert.equal(isHistoricalNote({ title: "Search Rollout", type: "Decision", status }), false, status);
	});

	test("a brain topic and a reference are NOT historical, because corrections land there", () => {
		assert.equal(isHistoricalNote({ title: "Gotchas", type: "Brain topic" }), false);
		assert.equal(isHistoricalNote({ title: "Search Index", type: "Reference" }), false);
	});

	// `Date` is on every row. Reading it as evidence would classify
	// everything as historical and make the sweep a costly no-op.
	test("a Date property alone does not make a row historical", () => {
		const withDate = { title: "Search Quality", type: "Work note", date: "2026-03-02" };
		assert.equal(isHistoricalNote(withDate), false);
	});

	// Exact match, not substring: otherwise a living policy page about
	// archiving is exempted by its own title.
	test("a living row whose title merely contains a keyword is not exempted", () => {
		assert.equal(isHistoricalNote({ title: "Archive policy", type: "Work note", status: "active" }), false);
		assert.equal(isHistoricalNote({ title: "Meetings etiquette", type: "Reference" }), false);
	});

	test("status matching is case and whitespace tolerant", () => {
		assert.equal(isHistoricalNote({ title: "x", status: "  Archived " }), true);
	});

	test("a malformed status is not a licence to edit", () => {
		assert.equal(isHistoricalNote({ title: "x", status: 42 }), false);
		assert.equal(isHistoricalNote({ title: "x" }), false);
	});
});

describe("classifyCandidate", () => {
	const AUTH = page(1);

	test("the designated single source is AUTHORITATIVE", () => {
		assert.equal(classifyCandidate(row(AUTH, "Search Index", "Reference"), AUTH), "AUTHORITATIVE");
	});

	test("the same row in another URL form is the same row", () => {
		const form = `https://www.notion.so/Search-Index-${page(1).slice(-32)}?pvs=4`;
		assert.equal(classifyCandidate(row(form, "Search Index", "Reference"), AUTH), "AUTHORITATIVE");
		assert.equal(classifyCandidate(row(AUTH, "Search Index", "Reference"), form), "AUTHORITATIVE");
	});

	test("a living row asserting the fact is a RESTATEMENT", () => {
		assert.equal(classifyCandidate(row(page(2), "Gotchas", "Brain topic"), AUTH), "RESTATEMENT");
	});

	test("an archived row is HISTORICAL even while the sweep runs", () => {
		assert.equal(classifyCandidate(row(page(3), "Intake", "Work note", "archived"), AUTH), "HISTORICAL");
	});

	// If the single-source page was retired, the correction belongs
	// in whatever replaced it. Rewriting the retired one is the exact damage
	// this module exists to prevent, so HISTORICAL wins.
	test("HISTORICAL beats AUTHORITATIVE when the source page is itself retired", () => {
		const retired = row(AUTH, "Search Index", "Reference", "deprecated");
		assert.equal(classifyCandidate(retired, AUTH), "HISTORICAL");
	});
});

describe("planSweep", () => {
	const AUTH = page(1);
	const candidates = [
		row(AUTH, "Search Index", "Reference"),
		row(page(2), "Gotchas", "Brain topic"),
		row(page(3), "Search Quality", "Work note", "active"),
		row(page(4), "Intake", "Work note", "archived"),
		row(page(5), "Dana Ruiz", "1:1"),
	];
	const urls = (rows: readonly SweepCandidate[]): string[] => rows.map((c) => c.url);

	test("exactly one page is edited and every record is preserved", () => {
		const plan = planSweep(candidates, AUTH);
		assert.equal(plan.apply?.url, AUTH);
		assert.deepEqual(urls(plan.replaceWithLink), [page(2), page(3)]);
		assert.deepEqual(urls(plan.preserve), [page(4), page(5)]);
		assert.deepEqual(plan.blocked, []);
	});

	// A link to a source that nobody corrected spreads the stale claim
	// behind a link, so nothing is edited.
	test("with no authoritative page designated, NOTHING is edited", () => {
		const plan = planSweep(candidates, null);
		assert.equal(plan.apply, null);
		assert.deepEqual(plan.replaceWithLink, []);
		assert.equal(plan.blocked.length, 3, "the would-be edits are reported, not performed");
		assert.equal(plan.preserve.length, 2, "records are still preserved and still reported");
	});

	test("an authoritative URL that matched nothing blocks the pass too", () => {
		const plan = planSweep([row(page(2), "Gotchas", "Brain topic")], page(9));
		assert.equal(plan.apply, null);
		assert.deepEqual(urls(plan.blocked), [page(2)]);
	});

	test("a sweep over only records edits nothing and loses nothing", () => {
		const plan = planSweep([row(page(4), "Intake", "Work note", "archived")], AUTH);
		assert.equal(plan.apply, null);
		assert.deepEqual(urls(plan.preserve), [page(4)]);
	});
});
