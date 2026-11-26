/**
 * The ported prompt hook and PreCompact hook give the findings of the hooks
 * at the reference commit, for each scenario that runs only these two hooks.
 * The port runs on the Notion form with the stand-in runtime of
 * `_offline-notion-form.ts`. A scenario that also runs the Stop hook is
 * here, and it shows that the Stop port and the prompt port work together.
 * `parity/run-parity.ts --notion` is the same comparison on the real
 * workspace.
 */

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { comparePasses, formatDifference, type Comparison } from "../parity/compare.ts";
import { passOf } from "../parity/findings.ts";
import { FIXTURE } from "../parity/fixture.ts";
import { markdownForm } from "../parity/markdown-form.ts";
import { MUTATIONS, runMutations, type MutationResult } from "../parity/mutations.ts";
import { portMutations } from "../parity/port-mutations.ts";
import { REFERENCE_COMMIT, referenceCommitExists, runScenarios, withReferenceWorktree } from "../parity/runner.ts";
import type { FixtureSpec } from "../parity/spec.ts";
import type { FakeCall } from "./_fake-notion.ts";
import { offlineNotion } from "./_offline-notion-form.ts";

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), "..");
const skip = referenceCommitExists() ? false : `this clone does not hold the reference commit ${REFERENCE_COMMIT}`;

const OWN_HOOKS = new Set(["classify-message", "pre-compact"]);
const PORTED_HOOKS = new Set([...OWN_HOOKS, "stop-checklist"]);
const OWN: FixtureSpec = {
	...FIXTURE,
	scenarios: FIXTURE.scenarios.filter(({ steps }) => steps.some((step) => OWN_HOOKS.has(step.hook)) && steps.every((step) => PORTED_HOOKS.has(step.hook))),
};
const TABLE = [...portMutations("classify-message", MUTATIONS, OWN), ...portMutations("pre-compact", MUTATIONS, OWN)];

describe("the ported prompt hook and PreCompact hook against the hooks at the reference commit", { skip }, () => {
	let comparison: Comparison;
	let calls: FakeCall[];
	let results: readonly MutationResult[];

	before(() => {
		const now = new Date();
		withReferenceWorktree(({ scriptsDir, workDir }) => {
			const notion = offlineNotion(OWN, workDir, now);
			const original = passOf(runScenarios(OWN, workDir, markdownForm(OWN, { scriptsDir, now })), OWN);
			comparison = comparePasses(original, passOf(runScenarios(OWN, workDir, notion.form(SCRIPTS)), OWN), OWN);
			calls = notion.calls();
		});
		results = withReferenceWorktree(({ workDir }) => {
			const notion = offlineNotion(OWN, workDir, now);
			return runMutations(TABLE, { scriptsDir: SCRIPTS, form: (scriptsDir) => notion.form(scriptsDir) });
		});
	});

	test("each scenario gives the same findings and the same instruction text in both forms", () => {
		assert.deepEqual(comparison.differences.map(formatDifference), []);
		assert.deepEqual(comparison.tolerated.map(formatDifference), []);
		assert.ok(OWN.scenarios.length >= 11, `${OWN.scenarios.length} scenarios`);
	});

	test("the two hooks make no Notion call, and each Stop that scans makes 10 view queries", () => {
		assert.deepEqual([...new Set(calls.map(({ tool }) => tool))].filter((tool) => tool !== "notion-query-data-sources"), []);
		const scans = OWN.scenarios.flatMap(({ steps }) => steps).filter(({ hook, input }) => {
			if (hook !== "stop-checklist" || input.kind !== "payload") return false;
			const { om_mod: mod, stop_hook_active: active, stopHookActive: camel } = input.fields;
			return mod !== "standdown" && active !== true && camel !== true;
		});
		assert.equal(calls.length, scans.length * 10);
	});

	for (const [index, mutation] of TABLE.entries()) {
		test(`${mutation.id} in the port: ${mutation.change}`, () => {
			const { rows, lines } = results[index]!;
			assert.deepEqual(rows, [...mutation.rows].sort(), lines.join("\n"));
		});
	}

	test("each mutation of these hooks that the harness can see is seen in the port", () => {
		assert.ok(TABLE.length >= 10, `${TABLE.length} mutations`);
		assert.deepEqual(TABLE.filter(({ notSeen }) => notSeen !== undefined).map(({ id }) => id), []);
	});
});
