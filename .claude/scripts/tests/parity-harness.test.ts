/**
 * The parity harness on the original hooks: the hooks at the reference
 * commit give the findings that the fixture states, a comparison with a
 * second run has zero differences, and a change on one side shows as the
 * row of that change.
 */

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, dirname } from "node:path";
import { comparePasses } from "../parity/compare.ts";
import { passOf, type Pass } from "../parity/findings.ts";
import { FIXTURE } from "../parity/fixture.ts";
import { markdownForm } from "../parity/markdown-form.ts";
import { REFERENCE_COMMIT, referenceCommitExists, runScenarios, withReferenceWorktree } from "../parity/runner.ts";
import type { Finding, FixtureSpec } from "../parity/spec.ts";

const git = (cwd: string, args: readonly string[]): string =>
	spawnSync("git", ["-C", cwd, ...args], { encoding: "utf-8", windowsHide: true }).stdout;

const withTags: FixtureSpec = {
	...FIXTURE,
	notes: FIXTURE.notes.map((note) =>
		note.title === "Missing Fields" ? { ...note, fields: { ...note.fields, tags: ["reference"] } } : note,
	),
};

const sorted = (findings: readonly Finding[]): string[] =>
	findings.map(({ row, step, note, detail, count, sizeKb }) => JSON.stringify({ row, step, note, detail, count, sizeKb })).sort();

const skip = referenceCommitExists() ? false : `this clone does not hold the reference commit ${REFERENCE_COMMIT}`;

describe("the parity harness on the original hooks", { skip }, () => {
	let original: Pass;
	let secondRun: Pass;
	let changed: Pass;
	let workDir: string;
	let writesInReference: string;

	before(() => {
		const now = new Date();
		withReferenceWorktree((dirs) => {
			const pass = (spec: FixtureSpec): Pass =>
				passOf(runScenarios(spec, dirs.workDir, markdownForm(spec, { scriptsDir: dirs.scriptsDir, now })), spec);
			workDir = dirs.workDir;
			original = pass(FIXTURE);
			secondRun = pass(FIXTURE);
			changed = pass(withTags);
			writesInReference = git(dirname(dirs.scriptsDir), ["status", "--porcelain", "--ignored"]);
		});
	});

	for (const scenario of FIXTURE.scenarios) {
		test(`${scenario.id} gives the findings that part (d) states for the fixture`, () => {
			const expected = scenario.expect.map((finding): Finding => ({ step: 0, note: null, detail: null, count: null, ...finding }));
			assert.deepEqual(sorted(original.get(scenario.id) ?? []), sorted(expected));
		});
	}

	test("the original hooks compared with a second run have zero differences", () => {
		const { differences, tolerated } = comparePasses(original, secondRun, FIXTURE);
		assert.deepEqual(differences, []);
		assert.deepEqual(tolerated, []);
	});

	test("the rows that part (d) marks not applicable stay out of the comparison", () => {
		const rows = new Set(comparePasses(original, secondRun, FIXTURE).notApplicable.map(({ finding }) => finding.row));
		assert.deepEqual([...rows].sort(), ["HY-01", "SS-13"]);
	});

	test("a note that gets its tags on one side gives exactly the VW-08 row of the tags", () => {
		const { differences } = comparePasses(original, changed, FIXTURE);
		assert.deepEqual(
			differences.map(({ row, scenario, kind, original: finding }) => ({ row, scenario, kind, note: finding?.note, detail: finding?.detail })),
			[{ row: "VW-08", scenario: "write-missing-global-fields", kind: "only in the original", note: "Missing Fields", detail: "tags" }],
		);
	});

	test("no hook run writes into the directory of the reference hooks", () => {
		assert.equal(writesInReference, "");
	});

	test("the harness leaves no worktree and no temporary directory", () => {
		assert.equal(existsSync(workDir), false);
		assert.equal(git(import.meta.dirname, ["worktree", "list", "--porcelain"]).includes(basename(workDir)), false);
	});
});
