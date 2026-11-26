/**
 * The ported Stop hook gives the findings of the Stop hook at the reference
 * commit, for each scenario that runs it. The port runs on the Notion form
 * with the stand-in runtime of `_offline-notion-form.ts`.
 * `parity/run-parity.ts --notion --hook stop-checklist` is the same
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

const STOPS: FixtureSpec = { ...FIXTURE, scenarios: FIXTURE.scenarios.filter(({ steps }) => steps.some((step) => step.hook === "stop-checklist")) };
const MUTATIONS = portMutations("stop-checklist");

/** The mutations of the port that a run on the Notion form cannot see, each with the reason in `port-mutations.ts` or in `mutations.ts`. */
const NOT_SEEN = ["T20", "T22", "K03", "E2", "N22", "N23", "E6", "Q06", "A12", "A04", "A06"];

describe("the ported Stop hook against the Stop hook at the reference commit", { skip }, () => {
	let comparison: Comparison;
	let calls: FakeCall[];
	let results: readonly MutationResult[];

	before(() => {
		const now = new Date();
		withReferenceWorktree(({ scriptsDir, workDir }) => {
			const notion = offlineNotion(STOPS, workDir, now);
			const original = passOf(runScenarios(STOPS, workDir, markdownForm(STOPS, { scriptsDir, now })), STOPS);
			comparison = comparePasses(original, passOf(runScenarios(STOPS, workDir, notion.form(SCRIPTS)), STOPS), STOPS);
			calls = notion.calls();
		});
		results = withReferenceWorktree(({ workDir }) => {
			const notion = offlineNotion(STOPS, workDir, now);
			return runMutations(MUTATIONS, { scriptsDir: SCRIPTS, form: (scriptsDir) => notion.form(scriptsDir) });
		});
	});

	test("each Stop scenario gives the same findings and the same instruction text in both forms", () => {
		assert.deepEqual(comparison.differences.map(formatDifference), []);
		assert.deepEqual(comparison.tolerated.map(formatDifference), []);
	});

	test("the only findings that the comparison leaves out are the HY-01 findings of the original, which Notion cannot hold", () => {
		assert.ok(comparison.notApplicable.length > 0);
		assert.deepEqual([...new Set(comparison.notApplicable.map(({ form, finding }) => `${form} ${finding.row}`))], ["original HY-01"]);
	});

	test("the port makes only view queries, 10 for each Stop that scans", () => {
		assert.deepEqual([...new Set(calls.map(({ tool }) => tool))], ["notion-query-data-sources"]);
		const scans = STOPS.scenarios.flatMap(({ steps }) => steps).filter(({ hook, input }) => {
			if (hook !== "stop-checklist" || input.kind !== "payload") return false;
			const { om_mod: mod, stop_hook_active: active, stopHookActive: camel } = input.fields;
			return mod !== "standdown" && active !== true && camel !== true;
		});
		assert.equal(calls.length, scans.length * 10);
	});

	for (const [index, mutation] of MUTATIONS.entries()) {
		test(`${mutation.id} in the port: ${mutation.change}`, () => {
			const { rows, lines } = results[index]!;
			assert.deepEqual(rows, [...mutation.rows].sort(), lines.join("\n"));
		});
	}

	test("each mutation of a Stop scenario and each mutation of the hygiene scan is in the table of the port", () => {
		const ids = new Set(MUTATIONS.map(({ id }) => id));
		const ofStop = new Set(STOPS.scenarios.map(({ id }) => id));
		const expected = REFERENCE_MUTATIONS.filter(
			({ scenarios, edits, rows }) =>
				scenarios.some((id) => ofStop.has(id)) || (scenarios.join() === "session-start" && edits.every(({ file }) => file === "lib/active-hygiene.ts") && rows.every((row) => row.startsWith("HY"))),
		)
			.map(({ id }) => id)
			// The fixture has no README row of the inbox, and the port has no such row at all.
			.filter((id) => id !== "A08" && id !== "A09");
		assert.deepEqual(expected.filter((id) => !ids.has(id)), []);
		assert.ok(MUTATIONS.length >= 40, `${MUTATIONS.length} mutations`);
	});

	test("the mutations that the Notion form cannot see are a known list, and each one has its reason", () => {
		assert.deepEqual(MUTATIONS.filter(({ notSeen }) => notSeen !== undefined).map(({ id }) => id).sort(), [...NOT_SEEN].sort());
	});
});
