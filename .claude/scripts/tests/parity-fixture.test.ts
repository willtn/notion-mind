/**
 * The fixture spec keeps the properties that both forms depend on, and the
 * Markdown form writes the vault that the spec describes.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIXTURE } from "../parity/fixture.ts";
import { markdownForm, markdownPath, renderNote } from "../parity/markdown-form.ts";
import { ROWS, type RowId } from "../parity/rows.ts";
import type { FixtureNote } from "../parity/spec.ts";

const note = (title: string): FixtureNote => {
	const found = FIXTURE.notes.find((candidate) => candidate.title === title);
	assert.ok(found, `the fixture has no note "${title}"`);
	return found;
};

describe("fixture spec", () => {
	test("no two notes share a title, because the title is the note identity in a finding", () => {
		const titles = FIXTURE.notes.map((n) => n.title);
		assert.deepEqual(titles.filter((title, i) => titles.indexOf(title) !== i), []);
	});

	test("no field holds an empty value, because Notion has no present-but-empty state", () => {
		const empty = FIXTURE.notes.flatMap((n) =>
			Object.entries(n.fields)
				.filter(([, value]) => value.length === 0 || (Array.isArray(value) && value.includes("")))
				.map(([field]) => `${n.title}: ${field}`),
		);
		assert.deepEqual(empty, []);
	});

	test("each row of the parity table has a scenario", () => {
		const exercised = new Set<RowId>(FIXTURE.scenarios.flatMap((scenario) => scenario.rows));
		assert.deepEqual((Object.keys(ROWS) as RowId[]).filter((row) => !exercised.has(row)), []);
	});

	test("each written note is a fixture note", () => {
		const titles = new Set(FIXTURE.notes.map((n) => n.title));
		const unknown = FIXTURE.scenarios.flatMap((scenario) =>
			scenario.steps.flatMap((step) => (step.input.kind === "write" && !titles.has(step.input.note) ? [step.input.note] : [])),
		);
		assert.deepEqual(unknown, []);
	});

	test("the near-limit note is below the 25,000-byte limit by at most 10 percent", () => {
		const nearLimit = FIXTURE.notes.filter((n) => n.nearSizeLimit);
		assert.equal(nearLimit.length, 1);
		const bytes = Buffer.byteLength(renderNote(nearLimit[0]!));
		assert.ok(bytes < 25_000 && bytes >= 22_500, `${bytes} bytes`);
	});
});

describe("Markdown form", () => {
	const now = new Date("2026-06-15T12:00:00Z");
	const dir = mkdtempSync(join(tmpdir(), "om-parity-form-"));
	const environment = markdownForm(FIXTURE, { scriptsDir: "/scripts", now })(dir);
	test.after(() => rmSync(dir, { recursive: true, force: true }));

	test("the properties of a note give its folder", () => {
		assert.equal(markdownPath(note("Billing Retry Design")), "work/active/Billing Retry Design.md");
		assert.equal(markdownPath(note("Pricing Rollout")), "work/active/Pricing/Pricing Rollout.md");
		assert.equal(markdownPath(note("Legacy Importer")), "work/archive/2025/Legacy Importer.md");
		assert.equal(markdownPath(note("Ada Park 2026-02-07")), "work/1-1/Ada Park 2026-02-07.md");
		assert.equal(markdownPath(note("Home")), "Home.md");
	});

	test("a completed note can stay under work/active/, the state that HY-01 reads", () => {
		assert.equal(markdownPath(note("Old Pricing Plan")), "work/active/Pricing/Old Pricing Plan.md");
	});

	test("a note file holds the fields as frontmatter, then the body", () => {
		const text = readFileSync(join(dir, "org/people/Ada Park.md"), "utf-8");
		assert.equal(
			text,
			"---\ndate: 2026-01-05\ndescription: A staff engineer of the billing team\ntags:\n  - person\ntitle: Staff Engineer\n---\n\n" +
				note("Ada Park").body,
		);
	});

	test("a note with no field has no frontmatter", () => {
		assert.equal(readFileSync(join(dir, "reference/Loose Draft.md"), "utf-8"), note("Loose Draft").body);
	});

	test("the file mtime is the Changed date of the note", () => {
		const mtime = statSync(join(dir, "work/meetings/Planning Export.md")).mtime;
		assert.equal(mtime.toISOString(), "2026-05-25T12:00:00.000Z");
	});

	test("each file of the repository is in the project directory", () => {
		for (const file of FIXTURE.repoFiles) {
			assert.equal(readFileSync(join(dir, file.path), "utf-8"), file.content);
		}
	});

	test("a write payload names the file of the note", () => {
		const payload = environment.writePayload(note("Runbook")) as { tool_name: string; tool_input: { file_path: string } };
		assert.equal(payload.tool_name, "Write");
		assert.equal(payload.tool_input.file_path, join(dir, "reference/Runbook.md"));
	});

	test("a path, a file name, and a title all name the note", () => {
		for (const reference of ["./work/1-1/Ada Park 2026-02-07.md", "work/1-1/Ada Park 2026-02-07.md", "Ada Park 2026-02-07.md", "Ada Park 2026-02-07"]) {
			assert.equal(environment.noteOf(reference), "Ada Park 2026-02-07");
		}
		assert.equal(environment.noteOf("AGENTS.md"), null);
	});

	test("a folder names the notes below it", () => {
		assert.deepEqual([...environment.notesIn("work/archive")].sort(), ["Legacy Importer", "Search Migration"]);
	});
});
