/**
 * The parity harness on the original hooks: the hooks at the reference
 * commit give the findings that the fixture states, a comparison with a
 * second run has zero differences, and a change on one side shows as the
 * row of that change.
 */

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { comparePasses } from "../parity/compare.ts";
import { passOf, type Pass } from "../parity/findings.ts";
import { FIXTURE } from "../parity/fixture.ts";
import { markdownForm } from "../parity/markdown-form.ts";
import {
	minimalHookEnvironment,
	REFERENCE_COMMIT,
	referenceCommitExists,
	runScenarios,
	withReferenceWorktree,
} from "../parity/runner.ts";
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
	let writeTrace: string;

	before(() => {
		const now = new Date();
		withReferenceWorktree((dirs) => {
			const pass = (spec: FixtureSpec): Pass =>
				passOf(runScenarios(spec, dirs.workDir, markdownForm(spec, { scriptsDir: dirs.scriptsDir, now })), spec);
			workDir = dirs.workDir;
			original = pass(FIXTURE);
			secondRun = pass(FIXTURE);
			changed = pass(withTags);
			const traced = markdownForm(FIXTURE, { scriptsDir: dirs.scriptsDir, now });
			const [write] = runScenarios(
				{ ...FIXTURE, scenarios: FIXTURE.scenarios.filter(({ id }) => id === "write-clean") },
				dirs.workDir,
				(dir) => {
					const environment = traced(dir);
					return { ...environment, env: { ...environment.env, HOOK_DEBUG: "1" } };
				},
			);
			writeTrace = write!.runs.map(({ stderr }) => stderr).join("\n");
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

	test("a write hook run asks for a search index refresh and starts no worker", () => {
		assert.match(writeTrace, /validate-write: refresh requested/);
		assert.match(writeTrace, /validate-write: \S+ not resolvable; skipping/);
		assert.doesNotMatch(writeTrace, /no worker spawned/);
	});
	test("no hook run writes into the directory of the reference hooks", () => {
		assert.equal(writesInReference, "");
	});

	test("the harness leaves no worktree and no temporary directory", () => {
		assert.equal(existsSync(workDir), false);
		assert.equal(git(import.meta.dirname, ["worktree", "list", "--porcelain"]).includes(basename(workDir)), false);
	});
});

describe("the minimal hook environment", { skip: process.platform === "win32" }, () => {
	const polluted = {
		npm_config_prefix: "/not/a/real/prefix",
		NPM_CONFIG_USERCONFIG: "/not/a/real/npmrc",
		PREFIX: "/not/a/real/prefix",
		DESTDIR: "/not/a/real/destdir",
		GITHUB_TOKEN: "not-a-token",
	};

	const inPollutedProcess = <T>(use: () => T): T => {
		const saved = { ...process.env };
		Object.assign(process.env, polluted);
		try {
			return use();
		} finally {
			for (const name of Object.keys(polluted)) delete process.env[name];
			Object.assign(process.env, saved);
		}
	};

	test("a hook sees no variable of the process that runs the harness", () => {
		const dir = mkdtempSync(join(tmpdir(), "om-parity-env-"));
		try {
			const env = inPollutedProcess(() => minimalHookEnvironment(dir));
			assert.deepEqual(Object.keys(env).sort(), ["HOME", "PATH", "USERPROFILE", "XDG_CACHE_HOME"]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("the command path holds links to node and git only, and the home folder is empty", () => {
		const dir = mkdtempSync(join(tmpdir(), "om-parity-env-"));
		try {
			const env = minimalHookEnvironment(dir);
			const commands = readdirSync(env["PATH"]!).sort();
			assert.ok(commands.includes("node"));
			assert.ok(commands.every((name) => name === "node" || name === "git"));
			assert.equal(statSync(join(env["PATH"]!, "node")).isFile(), true);
			assert.deepEqual(readdirSync(env["HOME"]!), []);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
