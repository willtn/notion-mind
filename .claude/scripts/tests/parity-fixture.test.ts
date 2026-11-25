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
import type { ExpectedFinding, FixtureNote } from "../parity/spec.ts";

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

	test("each row that part (d) compares has an expected finding in a scenario that names the row", () => {
		const whole = (finding: ExpectedFinding): string => JSON.stringify({ step: 0, note: null, detail: null, count: null, ...finding });
		const proven = (row: RowId): boolean =>
			FIXTURE.scenarios.some((scenario) => {
				if (!scenario.rows.includes(row)) return false;
				const standIn = scenario.provenBy?.[row];
				return scenario.expect.some((finding) => finding.row === row || (standIn !== undefined && whole(finding) === whole(standIn)));
			});
		const compared = (Object.keys(ROWS) as RowId[]).filter((row) => ROWS[row].rule !== "not-applicable");
		assert.deepEqual(compared.filter((row) => !proven(row)), []);
	});

	test("each repository file that a step removes is a file of the spec", () => {
		const files = new Set(FIXTURE.repoFiles.map((file) => file.path));
		const unknown = FIXTURE.scenarios.flatMap((scenario) =>
			scenario.steps.flatMap((step) => (step.removeRepoFile !== undefined && !files.has(step.removeRepoFile) ? [step.removeRepoFile] : [])),
		);
		assert.deepEqual(unknown, []);
	});

	test("each written note is a fixture note", () => {
		const titles = new Set(FIXTURE.notes.map((n) => n.title));
		const unknown = FIXTURE.scenarios.flatMap((scenario) =>
			scenario.steps.flatMap((step) => (step.input.kind === "write" ? step.input.notes.filter((title) => !titles.has(title)) : [])),
		);
		assert.deepEqual(unknown, []);
	});

	const bytesOf = (title: string): number => Buffer.byteLength(renderNote(note(title)));
	const inFolder = (folder: string): number => FIXTURE.notes.filter((n) => markdownPath(n).startsWith(`${folder}/`)).length;
	const aged = (type: FixtureNote["type"], days: number): string[] =>
		FIXTURE.notes.filter((n) => n.type === type && n.changedDaysAgo === days).map((n) => n.title);

	test("a note is exactly at the 25,000-byte limit, and a note is one byte below it", () => {
		assert.equal(bytesOf("Size Limit Note"), 25_000);
		assert.equal(bytesOf("Below Size Limit Note"), 24_999);
	});

	test("a note with no link is one character above the 300-character limit, and a note is exactly at it", () => {
		for (const [title, length] of [["No Links", 301], ["Short No Links", 300]] as const) {
			const text = renderNote(note(title));
			assert.equal(text.length, length);
			assert.equal(text.includes("[["), false);
		}
	});

	test("`AGENTS.md` is exactly at the 23,000-byte flag", () => {
		assert.equal(Buffer.byteLength(FIXTURE.repoFiles.find((file) => file.path === "AGENTS.md")!.content), 23_000);
	});

	test("an inbox note is exactly at the 7-day limit, and a note is one day below it", () => {
		assert.deepEqual(aged("Inbox item", 7), ["Offsite Export"]);
		assert.deepEqual(aged("Inbox item", 6), ["Fresh Standup Export"]);
	});

	test("a note with open items is exactly at the 14-day limit, and a note is one day below it", () => {
		assert.deepEqual(aged("1:1", 14), ["Ada Park 2026-02-07"]);
		assert.deepEqual(aged("Inbox item", 13), ["Retro Export"]);
	});

	test("one group has 12 notes and one group has 13 notes, on the two sides of the collapse limit", () => {
		assert.equal(inFolder("work/meetings"), 12);
		assert.equal(inFolder("reference"), 13);
		assert.equal(FIXTURE.notes.filter((n) => n.type === "Inbox item").length, 12);
		assert.equal(FIXTURE.notes.filter((n) => n.type === "Reference").length, 13);
	});

	test("11 notes are past the size limit, one more than a hygiene list shows, and only one has the smallest size in KB", () => {
		const sizes = FIXTURE.notes
			.filter((n) => !n.title.includes("Archive") && Buffer.byteLength(renderNote(n)) >= 25_000)
			.map((n) => Math.round(Buffer.byteLength(renderNote(n)) / 1000))
			.sort((a, b) => a - b);
		assert.equal(sizes.length, 11);
		assert.ok(sizes[0]! < sizes[1]!, "the note that the list does not show must not depend on the order of the files");
	});

	test("10 loose notes are active, the number that the Active Work section keeps", () => {
		assert.equal(FIXTURE.notes.filter((n) => markdownPath(n).startsWith("work/active/") && markdownPath(n).split("/").length === 3).length, 10);
	});

	test("11 tasks are open in the loose active notes and in Home, one more than the Open Tasks section keeps, and Home holds the last one", () => {
		const open = (n: FixtureNote): number => n.body.split("\n").filter((line) => line.startsWith("- [ ]")).length;
		const loose = FIXTURE.notes.filter((n) => markdownPath(n).startsWith("work/active/") && markdownPath(n).split("/").length === 3);
		assert.equal(loose.reduce((sum, n) => sum + open(n), 0), 9);
		assert.equal(open(note("Home")), 2);
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

	test("a note with no field has no frontmatter, and a page outside the databases is a file of the root", () => {
		assert.equal(readFileSync(join(dir, "Loose Draft.md"), "utf-8"), note("Loose Draft").body);
	});

	test("the notes of one folder are the notes of one type, so a folder is a group of the Notion listing", () => {
		const folderOf = (n: FixtureNote): string => markdownPath(n).split("/").slice(0, -1).join("/");
		const mixed = [...new Set(FIXTURE.notes.map(folderOf))].filter((folder) => {
			const types = new Set(FIXTURE.notes.filter((n) => folderOf(n) === folder).map((n) => n.type));
			// The root holds the pages outside the databases. `brain/` holds the North Star page beside the brain topics.
			return types.size > 1 && folder !== "" && folder !== "brain";
		});
		assert.deepEqual(mixed, []);
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
		const payload = environment.writePayload([note("Runbook")]) as { tool_name: string; tool_input: { file_path: string } };
		assert.equal(payload.tool_name, "Write");
		assert.equal(payload.tool_input.file_path, join(dir, "reference/Runbook.md"));
	});

	test("a write payload of two notes names the file of each note in one call", () => {
		const payload = environment.writePayload([note("Billing Export Pipeline"), note("Billing Retry Design")]) as { tool_input: { command: string } };
		assert.deepEqual(
			payload.tool_input.command.split("\n").filter((line) => line.includes(" File: ")),
			["*** Update File: work/active/Billing Export Pipeline.md", "*** Update File: work/active/Billing Retry Design.md"],
		);
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
