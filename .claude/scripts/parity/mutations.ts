/**
 * Changes of the reference hooks that the harness must see. Each mutation
 * edits a copy of the hooks at `fae7be4` in one place. The harness compares
 * the reference hooks with the copy and must report the rows that the
 * mutation names. A mutation with zero differences is a hole in the harness.
 */

import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { comparePasses, formatDifference } from "./compare.ts";
import { passOf, type Pass } from "./findings.ts";
import { FIXTURE } from "./fixture.ts";
import { markdownForm } from "./markdown-form.ts";
import { runScenarios, withReferenceWorktree } from "./runner.ts";
import type { Finding, FixtureSpec } from "./spec.ts";

type Edit = { readonly file: string; readonly find: string; readonly replace: string };

export type Mutation = {
	readonly id: string;
	readonly change: string;
	readonly edits: readonly Edit[];
	/** The scenarios that the mutation changes. Only these run. */
	readonly scenarios: readonly string[];
	/** Each row that the comparison must report, and no other row. */
	readonly rows: readonly Finding["row"][];
};

const SUMMARY_CLAIM_ROWS = ["HY-02", "HY-03", "HY-04", "HY-05", "HY-07", "HY-09"] as const;

export const MUTATIONS: readonly Mutation[] = [
	{
		id: "X1",
		change: "The summary beside the Stop feedback (ST-10) has no hygiene claims",
		edits: [
			{
				file: "stop-checklist.ts",
				find: "stopSummary(CHECKLIST_SUMMARY, claims, FEEDBACK_TRAILER)",
				replace: "stopSummary(CHECKLIST_SUMMARY, [], FEEDBACK_TRAILER)",
			},
		],
		scenarios: ["stop-handoff-blocked"],
		rows: SUMMARY_CLAIM_ROWS,
	},
	{
		id: "X5",
		change: "The report data (ST-08) has no claims",
		edits: [
			{
				file: "stop-checklist.ts",
				find: "writeStopReportData({ key, claims, agentText:",
				replace: "writeStopReportData({ key, claims: [], agentText:",
			},
		],
		scenarios: ["stop-report-data"],
		rows: SUMMARY_CLAIM_ROWS,
	},
	{
		id: "X10",
		change: "The report key (ST-06) is a constant",
		edits: [
			{
				file: "stop-checklist.ts",
				find: "const key = reportKey({ checklist, report }, HYGIENE_VOLATILE_FIELDS);",
				replace: 'const key = "0123456789abcdef";',
			},
		],
		scenarios: ["stop-after-report-change", "stop-report-data-after-change"],
		rows: ["HY-02", "HY-03", "HY-04", "HY-05", "HY-09", "ST-03", "ST-06", "ST-07", "ST-09"],
	},
	{
		id: "X6",
		change: 'Each envelope names the event "Bogus"',
		edits: [
			{
				file: "lib/hook-io.ts",
				find: "{ hookEventName, additionalContext, policyResults: policies } : { hookEventName, additionalContext }",
				replace: '{ hookEventName: "Bogus", additionalContext, policyResults: policies } : { hookEventName: "Bogus", additionalContext }',
			},
			{
				file: "lib/hook-io.ts",
				find: 'hookSpecificOutput: { hookEventName: "Stop", additionalContext: context }',
				replace: 'hookSpecificOutput: { hookEventName: "Bogus", additionalContext: context }',
			},
		],
		scenarios: ["session-start", "write-oversized", "prompt-decision-reversal", "stop-handoff-blocked"],
		rows: ["SS-19", "ST-10", "UP-14", "VW-17"],
	},
	{
		id: "X3",
		change: "The policy of an oversized note (VW-14) has a different ID",
		edits: [{ file: "validate-write.ts", find: 'policy_id: "organization-threshold"', replace: 'policy_id: "organization-limit"' }],
		scenarios: ["write-oversized"],
		rows: ["UNMAPPED", "VW-14"],
	},
	{
		id: "X4",
		change: "The policy of a ticket link (VW-12) has a different ID",
		edits: [{ file: "validate-write.ts", find: 'policy_id: "phantom-edge"', replace: 'policy_id: "phantom-link"' }],
		scenarios: ["write-ticket-links"],
		rows: ["UNMAPPED", "VW-12"],
	},
	{
		id: "VW8",
		change: "The write hook prints text on stderr",
		edits: [
			{
				file: "validate-write.ts",
				find: "const blocks = [...new Set(findings.flatMap((f) => f.blocks))];",
				replace: 'console.error("extra text");\nconst blocks = [...new Set(findings.flatMap((f) => f.blocks))];',
			},
		],
		scenarios: ["write-clean"],
		rows: ["VW-17"],
	},
	{
		id: "R2-1",
		change: "The hand-over summary (ST-09) ends with the trailer of the Stop feedback",
		edits: [
			{
				file: "stop-checklist.ts",
				find: "writeSystemMessage(stopSummary(CHECKLIST_SUMMARY, claims));",
				replace: "writeSystemMessage(stopSummary(CHECKLIST_SUMMARY, claims, FEEDBACK_TRAILER));",
			},
		],
		scenarios: ["stop-twice"],
		rows: ["ST-09", "ST-10"],
	},
	{
		id: "R2-2",
		change: 'The system message envelope has a field `decision: "block"`',
		edits: [
			{
				file: "lib/hook-io.ts",
				find: "JSON.stringify({ systemMessage: fitEncoded(message, HOOK_OUTPUT_MAX_CHARS - overhead) })",
				replace: 'JSON.stringify({ decision: "block", systemMessage: fitEncoded(message, HOOK_OUTPUT_MAX_CHARS - overhead) })',
			},
		],
		scenarios: ["stop-twice"],
		rows: ["UNMAPPED"],
	},
];

export type MutationResult = {
	readonly mutation: Mutation;
	/** The rows of the differences, sorted, each one time. */
	readonly rows: readonly Finding["row"][];
	/** One line for each difference. */
	readonly lines: readonly string[];
};

function mutatedCopy(scriptsDir: string, dir: string, mutation: Mutation): string {
	cpSync(scriptsDir, dir, { recursive: true, filter: (source) => !["tests", "node_modules"].includes(basename(source)) });
	for (const { file, find, replace } of mutation.edits) {
		const path = join(dir, file);
		const source = readFileSync(path, "utf-8");
		if (source.split(find).length !== 2) throw new Error(`mutation ${mutation.id}: the text to change must occur one time in ${file}`);
		writeFileSync(path, source.replace(find, () => replace));
	}
	return dir;
}

/** Compare the reference hooks with a mutated copy, for each mutation, on the scenarios that the mutation names. */
export function runMutations(mutations: readonly Mutation[] = MUTATIONS): MutationResult[] {
	const now = new Date();
	return withReferenceWorktree(({ scriptsDir, workDir }) => {
		const pass = (spec: FixtureSpec, hooks: string): Pass =>
			passOf(runScenarios(spec, workDir, markdownForm(spec, { scriptsDir: hooks, now })), spec);
		return mutations.map((mutation, index): MutationResult => {
			const spec = { ...FIXTURE, scenarios: FIXTURE.scenarios.filter(({ id }) => mutation.scenarios.includes(id)) };
			const mutated = mutatedCopy(scriptsDir, join(workDir, `mutated-${index}`), mutation);
			const { differences } = comparePasses(pass(spec, scriptsDir), pass(spec, mutated), spec);
			return {
				mutation,
				rows: [...new Set(differences.map(({ row }) => row))].sort(),
				lines: differences.map(formatDifference),
			};
		});
	});
}
