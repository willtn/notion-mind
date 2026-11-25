/**
 * Compares two runs of the hooks and prints each difference with its row
 * ID. The exit code is 1 when a difference exists.
 *
 * With no option, the original hooks run two times on the Markdown form,
 * which shows that the harness is stable. With `--notion`, the second run
 * is the hooks of this repository on the Notion form, for one hook.
 *
 * Usage: node --experimental-strip-types parity/run-parity.ts [--notion --hook <name> [--now <instant>] [--map <path>]]
 */

import { comparePasses, formatDifference } from "./compare.ts";
import { FIXTURE } from "./fixture.ts";
import { passOf } from "./findings.ts";
import { markdownForm } from "./markdown-form.ts";
import { notionRun } from "./notion-run.ts";
import { REFERENCE_COMMIT, runScenarios, withReferenceWorktree, type ScenarioRun } from "./runner.ts";
import type { HookName } from "./spec.ts";

const { run: notion, rest } = await notionRun(process.argv.slice(2));
if (rest.length > 0) throw new Error(`Unknown option: ${rest.join(" ")}. Read the header of run-parity.ts for the options.`);

const spec = notion?.spec ?? FIXTURE;
const now = notion?.now ?? new Date();
const [original, port] = withReferenceWorktree(({ scriptsDir, workDir }) => {
	const markdown = markdownForm(spec, { scriptsDir, now });
	return [runScenarios(spec, workDir, markdown), runScenarios(spec, workDir, notion === null ? markdown : notion.form(notion.scriptsDir))] as const;
});
const comparison = comparePasses(passOf(original, spec), passOf(port, spec), spec);

const sorted = (values: readonly number[]): number[] => [...values].sort((a, b) => a - b);
function wallTimes(runs: readonly ScenarioRun[]): string {
	const byHook = new Map<HookName, number[]>();
	for (const { scenario, runs: steps } of runs) {
		steps.forEach((step, i) => {
			const hook = scenario.steps[i]!.hook;
			byHook.set(hook, [...(byHook.get(hook) ?? []), step.wallMs]);
		});
	}
	return [...byHook]
		.map(([hook, times]) => {
			const ordered = sorted(times);
			return `${hook} ${Math.round(ordered[Math.floor(ordered.length / 2)] ?? 0)} (min ${Math.round(ordered[0] ?? 0)}, max ${Math.round(ordered.at(-1) ?? 0)}, ${ordered.length} runs)`;
		})
		.join(", ");
}

const findings = [...passOf(original, spec).values()].reduce((n, list) => n + list.length, 0);
console.log(
	notion === null
		? `original: the hooks at ${REFERENCE_COMMIT} on the Markdown form. port: a second run of the same hooks.`
		: `original: the hooks at ${REFERENCE_COMMIT} on the Markdown form. port: the hooks of this repository on the Notion form, for the scenarios of ${notion.hook}.`,
);
console.log(`scenarios ${spec.scenarios.length}, hook runs ${original.reduce((n, run) => n + run.runs.length, 0)}, findings ${findings}`);
console.log(`median wall time of one run in ms, original: ${wallTimes(original)}`);
if (notion !== null) console.log(`median wall time of one run in ms, port: ${wallTimes(port)}`);
console.log(`not applicable ${comparison.notApplicable.length}, tolerated ${comparison.tolerated.length}, differences ${comparison.differences.length}`);
for (const difference of comparison.tolerated) console.log(`tolerated: ${formatDifference(difference)}`);
for (const difference of comparison.differences) console.log(formatDifference(difference));
if (notion !== null) console.log(await notion.restore());
process.exit(comparison.differences.length === 0 ? 0 : 1);
