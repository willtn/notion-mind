/**
 * The ported write check gives the findings of the write check at the
 * reference commit, for each scenario that writes a note. The port runs on
 * the Notion form with the stand-in runtime of `_offline-notion-form.ts`.
 * `parity/run-parity.ts --notion` is the same comparison on the real
 * workspace.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseOpenLoopConfig } from "../lib/active-hygiene.ts";
import { noteMarkdown } from "../lib/notion-note.ts";
import { parseCommand } from "../lib/notion-write.ts";
import { writtenNotes } from "../lib/notion-written.ts";
import { comparePasses, formatDifference, type Comparison } from "../parity/compare.ts";
import { passOf } from "../parity/findings.ts";
import { FIXTURE } from "../parity/fixture.ts";
import { markdownForm, renderNote } from "../parity/markdown-form.ts";
import { runMutations, type MutationResult } from "../parity/mutations.ts";
import { createArguments } from "../parity/notion-form.ts";
import { targetOf } from "../parity/notion-pages.ts";
import { portMutations } from "../parity/port-mutations.ts";
import { REFERENCE_COMMIT, referenceCommitExists, runScenarios, withReferenceWorktree } from "../parity/runner.ts";
import type { FixtureNote, FixtureSpec } from "../parity/spec.ts";
import type { FakeCall } from "./_fake-notion.ts";
import { rmTemp } from "./_helpers.ts";
import { offlineNotion } from "./_offline-notion-form.ts";

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), "..");
const skip = referenceCommitExists() ? false : `this clone does not hold the reference commit ${REFERENCE_COMMIT}`;

describe("the note that the hook reads against the Markdown file of the same note", () => {
	const dir = mkdtempSync(join(tmpdir(), "write-check-measure-"));
	after(() => rmTemp(dir));
	const { map, pages, form } = offlineNotion(FIXTURE, dir, new Date());
	const context = { now: new Date(), openLoopSections: parseOpenLoopConfig(FIXTURE.repoFiles.find((file) => file.path === "vault-manifest.json")?.content ?? null).sectionRe, pages };

	async function written(note: FixtureNote): Promise<string> {
		const page = pages.get(note.title);
		const call = { tool: "notion-create-pages", args: createArguments([note], map, context), outbox: "", outcome: "done" as const, reply: { pages: [{ id: page?.id, url: page?.url }] }, error: "" };
		const [made] = await writtenNotes(call, map, async () => {
			throw new Error("a create call needs no fetch");
		});
		assert.ok(made !== undefined);
		return noteMarkdown(made);
	}

	test("each note that a write can hold has the text of its file, byte for byte, so each limit is the same limit in both forms", async () => {
		// A relation holds a page ID where the file has a name, and a key with no property has no place in a row.
		const cannotMatch = (note: FixtureNote): boolean => note.fields.person !== undefined || note.otherKeys !== undefined;
		const notes = FIXTURE.notes.filter((note) => targetOf(note).kind !== "scaffold");
		const different: string[] = [];
		for (const note of notes) if ((await written(note)) !== renderNote(note)) different.push(note.title);
		assert.deepEqual(different, notes.filter(cannotMatch).map(({ title }) => title));
		assert.ok(notes.length - different.length >= 50, `${notes.length - different.length} of ${notes.length} notes`);
	});

	test("a note that cannot have the same text differs only by the line of that field", async () => {
		const note = FIXTURE.notes.find(({ title }) => title === "Undated Plan");
		assert.ok(note !== undefined);
		assert.equal(await written(note), renderNote(note).replace("update: 2026-01-05\n", ""));
	});

	test("the port reads the command of a write payload as a write on each OS", () => {
		const note = FIXTURE.notes.find(({ title }) => title === "Runbook");
		assert.ok(note !== undefined);
		const environment = form(SCRIPTS)(join(dir, "form"));
		const { command } = environment.writePayload([note])["tool_input"] as { readonly command: string };
		const parsed = parseCommand(command, { readOutbox: (outbox) => readFileSync(resolve(environment.projectDir, outbox), "utf-8"), runtimePaths: [] });
		assert.equal(parsed.kind, "write", command);
	});
});

const WRITES: FixtureSpec = { ...FIXTURE, scenarios: FIXTURE.scenarios.filter(({ steps }) => steps.some((step) => step.hook === "validate-write")) };
const MUTATIONS = portMutations("validate-write");

describe("the ported write check against the write check at the reference commit", { skip }, () => {
	let comparison: Comparison;
	let calls: FakeCall[];
	let results: readonly MutationResult[];

	before(() => {
		const now = new Date();
		withReferenceWorktree(({ scriptsDir, workDir }) => {
			const notion = offlineNotion(WRITES, workDir, now);
			const original = passOf(runScenarios(WRITES, workDir, markdownForm(WRITES, { scriptsDir, now })), WRITES);
			comparison = comparePasses(original, passOf(runScenarios(WRITES, workDir, notion.form(SCRIPTS)), WRITES), WRITES);
			calls = notion.calls();
		});
		results = withReferenceWorktree(({ workDir }) => {
			const notion = offlineNotion(WRITES, workDir, now);
			return runMutations(MUTATIONS, { scriptsDir: SCRIPTS, form: (scriptsDir) => notion.form(scriptsDir) });
		});
	});

	test("each write scenario gives the same findings and the same instruction text in both forms", () => {
		assert.deepEqual(comparison.differences.map(formatDifference), []);
		assert.deepEqual(comparison.tolerated.map(formatDifference), []);
	});

	test("the port makes no other Notion call than the query of the loose active view and one update for each written row", () => {
		const tools = new Set(calls.map(({ tool }) => tool));
		assert.deepEqual([...tools].sort(), ["notion-query-data-sources", "notion-update-page"]);
		const rows = WRITES.scenarios.flatMap(({ steps }) => steps.flatMap((step) => (step.input.kind === "write" ? step.input.notes : []))).filter((title) => title !== "Loose Draft");
		assert.equal(calls.filter(({ tool }) => tool === "notion-update-page").length, rows.length);
	});

	for (const [index, mutation] of MUTATIONS.entries()) {
		test(`${mutation.id} in the port: ${mutation.change}`, () => {
			const { rows, lines } = results[index]!;
			assert.deepEqual(rows, [...mutation.rows].sort(), lines.join("\n"));
		});
	}

	test("each mutation of a write scenario is in the table of the port", () => {
		assert.ok(MUTATIONS.length >= 21, `${MUTATIONS.length} mutations`);
		assert.deepEqual(MUTATIONS.filter(({ notSeen }) => notSeen !== undefined).map(({ id }) => id), []);
	});
});
