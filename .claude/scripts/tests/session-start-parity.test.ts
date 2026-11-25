/**
 * The ported SessionStart hook gives the findings of the SessionStart hook
 * at the reference commit, for each scenario that runs it. The port runs on
 * the Notion form with the stand-in runtime of `_offline-notion-form.ts`.
 * `parity/run-parity.ts --notion --hook session-start` is the same
 * comparison on the real workspace.
 */

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { comparePasses, formatDifference, type Comparison } from "../parity/compare.ts";
import { passOf } from "../parity/findings.ts";
import { FIXTURE } from "../parity/fixture.ts";
import { markdownForm } from "../parity/markdown-form.ts";
import { MUTATIONS as REFERENCE_MUTATIONS, runMutations, type MutationResult } from "../parity/mutations.ts";
import { portMutations } from "../parity/port-mutations.ts";
import { REFERENCE_COMMIT, referenceCommitExists, runScenarios, withReferenceWorktree } from "../parity/runner.ts";
import type { FixtureSpec } from "../parity/spec.ts";
import type { FakeCall } from "./_fake-notion.ts";
import { offlineNotion } from "./_offline-notion-form.ts";

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), "..");
const skip = referenceCommitExists() ? false : `this clone does not hold the reference commit ${REFERENCE_COMMIT}`;

const STARTS: FixtureSpec = { ...FIXTURE, scenarios: FIXTURE.scenarios.filter(({ steps }) => steps.some((step) => step.hook === "session-start")) };
const MUTATIONS = portMutations("session-start");

/** The mutations of the port that a run on the Notion form cannot see, each with the reason in `port-mutations.ts` or in `mutations.ts`. */
const NOT_SEEN = ["E10", "E2", "N22", "N23", "E6", "Q06", "A12", "N14", "A04", "A06", "A08", "A09"];

/** The Notion calls of one run on the fixture: the 10 of the hygiene scan, 6 database views, the 2 views of the active work, and Home and 6 rows for their tasks. A full context adds the view of the brain topics, the North Star page, and the root page. */
const CALLS = { pointer: 25, full: 28 };

describe("the ported SessionStart hook against the SessionStart hook at the reference commit", { skip }, () => {
	let comparison: Comparison;
	let calls: FakeCall[];
	let results: readonly MutationResult[];

	before(() => {
		const now = new Date();
		withReferenceWorktree(({ scriptsDir, workDir }) => {
			const notion = offlineNotion(STARTS, workDir, now);
			const original = passOf(runScenarios(STARTS, workDir, markdownForm(STARTS, { scriptsDir, now })), STARTS);
			comparison = comparePasses(original, passOf(runScenarios(STARTS, workDir, notion.form(SCRIPTS)), STARTS), STARTS);
			calls = notion.calls();
		});
		results = withReferenceWorktree(({ workDir }) => {
			const notion = offlineNotion(STARTS, workDir, now);
			return runMutations(MUTATIONS, { scriptsDir: SCRIPTS, form: (scriptsDir) => notion.form(scriptsDir) });
		});
	});

	test("each SessionStart scenario gives the same findings and the same instruction text in both forms", () => {
		assert.deepEqual(comparison.differences.map(formatDifference), []);
		assert.deepEqual(comparison.tolerated.map(formatDifference), []);
	});

	test("the comparison leaves out only the rows that part (d) names: the recent changes, HY-01, and the note in a state that Notion cannot hold", () => {
		const left = new Set(comparison.notApplicable.map(({ form, finding }) => `${form} ${finding.row}${finding.note === "Old Pricing Plan" ? " of Old Pricing Plan" : ""}`));
		assert.deepEqual([...left].sort(), ["original HY-01", "original HY-01 of Old Pricing Plan", "original SS-13", "original SS-16 of Old Pricing Plan", "port SS-13", "port SS-16 of Old Pricing Plan"]);
	});

	test("the port only reads: view queries and page fetches, 28 for a full context and 25 for the context after a resume", () => {
		assert.deepEqual([...new Set(calls.map(({ tool }) => tool))].sort(), ["notion-fetch", "notion-query-data-sources"]);
		const runs = STARTS.scenarios.flatMap(({ steps }) => steps).flatMap(({ input }) => {
			const fields = input.kind === "payload" ? input.fields : {};
			if (fields["om_mod"] === "standdown") return [];
			return [fields["source"] === "resume" || fields["source"] === "compact" ? CALLS.pointer : CALLS.full];
		});
		assert.equal(calls.length, runs.reduce((sum, count) => sum + count, 0));
	});

	for (const [index, mutation] of MUTATIONS.entries()) {
		test(`${mutation.id} in the port: ${mutation.change}`, () => {
			const { rows, lines } = results[index]!;
			assert.deepEqual(rows, [...mutation.rows].sort(), lines.join("\n"));
		});
	}

	test("each mutation of a SessionStart scenario is in the table of the port", () => {
		const ids = new Set(MUTATIONS.map(({ id }) => id));
		const ofStart = new Set(STARTS.scenarios.map(({ id }) => id));
		const expected = REFERENCE_MUTATIONS.filter(({ scenarios }) => scenarios.some((id) => ofStart.has(id))).map(({ id }) => id);
		assert.deepEqual(expected.filter((id) => !ids.has(id)), []);
		assert.ok(MUTATIONS.length >= 45, `${MUTATIONS.length} mutations`);
	});

	test("the mutations that the Notion form cannot see are a known list, and each one has its reason", () => {
		assert.deepEqual(MUTATIONS.filter(({ notSeen }) => notSeen !== undefined).map(({ id }) => id).sort(), [...NOT_SEEN].sort());
	});
});
