/**
 * Compares the original hooks with themselves on the Markdown form and
 * prints each difference with its row ID. The exit code is 1 when a
 * difference exists.
 *
 * Usage: node --experimental-strip-types parity/run-parity.ts
 */

import { comparePasses, formatDifference } from "./compare.ts";
import { FIXTURE } from "./fixture.ts";
import { passOf } from "./findings.ts";
import { markdownForm } from "./markdown-form.ts";
import { REFERENCE_COMMIT, runScenarios, withReferenceWorktree, type ScenarioRun } from "./runner.ts";
import type { HookName } from "./spec.ts";

const now = new Date();
const [original, port] = withReferenceWorktree(({ scriptsDir, workDir }) => {
	const form = markdownForm(FIXTURE, { scriptsDir, now });
	return [runScenarios(FIXTURE, workDir, form), runScenarios(FIXTURE, workDir, form)] as const;
});
const comparison = comparePasses(passOf(original, FIXTURE), passOf(port, FIXTURE), FIXTURE);

const median = (values: readonly number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
function wallTimes(runs: readonly ScenarioRun[]): string {
	const byHook = new Map<HookName, number[]>();
	for (const { scenario, runs: steps } of runs) {
		steps.forEach((step, i) => {
			const hook = scenario.steps[i]!.hook;
			byHook.set(hook, [...(byHook.get(hook) ?? []), step.wallMs]);
		});
	}
	return [...byHook].map(([hook, times]) => `${hook} ${Math.round(median(times))}`).join(", ");
}

const findings = [...passOf(original, FIXTURE).values()].reduce((n, list) => n + list.length, 0);
console.log(`original: the hooks at ${REFERENCE_COMMIT} on the Markdown form. port: a second run of the same hooks.`);
console.log(`scenarios ${FIXTURE.scenarios.length}, hook runs ${original.reduce((n, run) => n + run.runs.length, 0)}, findings ${findings}`);
console.log(`median wall time of one run in ms: ${wallTimes(original)}`);
console.log(`not applicable ${comparison.notApplicable.length}, tolerated ${comparison.tolerated.length}, differences ${comparison.differences.length}`);
for (const difference of comparison.tolerated) console.log(`tolerated: ${formatDifference(difference)}`);
for (const difference of comparison.differences) console.log(formatDifference(difference));
process.exit(comparison.differences.length === 0 ? 0 : 1);
