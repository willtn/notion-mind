/**
 * The import run (lib/import-run.ts) on Notion in memory: a first run, a
 * second run with no write, a change of one note, a stop at each write,
 * and the checks that stop a run before its first write. The live import
 * of the fixture vaults in the pull request is the proof on Notion itself.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DIGEST_PROPERTY, SOURCE_PATH_PROPERTY } from "../lib/import-plan.ts";
import { plainText, runImport, sectionEdit, verifyImport, type ImportResult } from "../lib/import-run.ts";
import { parseNote, readVault, type Vault } from "../lib/import-source.ts";
import { NotionError } from "../lib/notion-client.ts";
import { writeImportVaults } from "../parity/import-vaults.ts";
import { autolink, isWrite, memoryNotion, type MemoryCall } from "./_import-notion.ts";
import { rmTemp } from "./_helpers.ts";

const CHANGED = new Date("2026-01-05T10:00:30.000Z");
const ROOT = "obsidian-mind import test";
const note = (fields: string, body: string): string => `---\n${fields}\n---\n\n${body}`;

const FILES: Readonly<Record<string, string>> = {
	"work/active/Billing/Retry Rules.md": note(
		"date: 2026-01-05\ndescription: How retries work\nquarter: Q1-2026\ntags: [work-note]\nteam: Platform",
		"# Retry Rules\n\nSee [[Use Postgres]] and [[Ada Park]], with **care** and `code`.\n\n## Action Items\n\n- [ ] Ship it\n",
	),
	"work/active/Use Postgres.md": note("tags: [decision]\nstatus: accepted", "The decision.\n"),
	"work/incidents/Outage.md": note("tags: [work-note]\nseverity: high\nticket: INC-1\nverbatim: true", "Line one\nline two\n"),
	"org/people/Ada Park.md": note("title: Staff Engineer\nteam: Platform", "# Ada Park\n"),
	"org/teams/Platform.md": note("tags: [team]", "Members.\n"),
	"reference/Runbook.md": note("tags: [reference]", "> [!tip] Restart\n> Run it twice.\n"),
	"brain/North Star.md": note("tags: [brain]", "# North Star\n\n## Current Focus\n\n- Ship [[Retry Rules]]\n"),
	"brain/Memories.md": note("tags: [brain]", "# Memories\n\n## Recent Context\n\n- Moved to Notion\n"),
	"brain/Patterns.md": note("tags: [brain]", "- One pattern\n"),
	"work/Index.md": note("tags: [index]", "# Work Notes\n\n## Open Questions\n\n- Why [[Home]]?\n"),
	"Home.md": "# Home\n",
};
/** Seven rows, one of them the row of the setup that Patterns fills, and two pages of the setup. */
const ROWS = 7;
const PLANNED = ROWS + 2;

const vaultOf = (files: Readonly<Record<string, string>>, changed = CHANGED): Vault => ({
	root: "/vault",
	notes: Object.entries(files).map(([path, raw]) => parseNote(path, raw, changed)),
	otherFiles: [],
	manifest: JSON.stringify({ open_loop_sections: ["action items"] }),
});
const writes = (calls: readonly MemoryCall[], from = 0): MemoryCall[] => calls.slice(from).filter(isWrite);
const counts = (result: ImportResult) => ({ created: result.created, updated: result.updated, unchanged: result.unchanged, failed: result.failed.length });
const run = (notion: ReturnType<typeof memoryNotion>, files = FILES, options: { ledgerPath?: string } = {}) =>
	runImport(notion.client, vaultOf(files), notion.map, { rootTitle: ROOT, log: () => {}, sleep: async () => {}, ledgerTag: ["pr", 11], ...options });

/** The rows and pages that an import leaves, without the times of the writes. */
const snapshot = (notion: ReturnType<typeof memoryNotion>): string[] =>
	[...notion.pages.values()]
		.map((page) => {
			const { "Last edited": _edited, "date:Hook stamp:start": _stamp, ...properties } = page.properties;
			const values = Object.entries(properties).map(([name, value]) => `${name}=${typeof value === "string" ? value.replace(/https:\/\/app\.notion\.com\/p\/[0-9a-f]+/g, (url) => notion.pages.get(url.slice(-32).replace(/^(.{8})(.{4})(.{4})(.{4})/, "$1-$2-$3-$4-"))?.title ?? url) : String(value)}`);
			return `${page.database ?? "page"}/${page.title}: ${values.sort().join("; ")} | ${page.content}`;
		})
		.sort();

describe("runImport", () => {
	test("the first run makes each row, fills the pages of the setup, and adds the columns and the options it needs", async () => {
		const notion = memoryNotion();
		const result = await run(notion);
		assert.deepEqual(counts(result), { created: ROWS - 1, updated: 3, unchanged: 0, failed: 0 });
		const retry = notion.row("Retry Rules");
		assert.equal(retry.properties[SOURCE_PATH_PROPERTY], "work/active/Billing/Retry [Rules.md](http://Rules.md)", "the stored form of a text property (measured)");
		assert.equal(retry.properties["Status"], "active");
		assert.equal(retry.properties["Project"], "Billing");
		assert.equal(retry.properties["Quarter"], "Q1-2026");
		assert.equal(retry.properties["Open tasks"], 1);
		assert.equal(retry.properties["date:Changed:start"], "2026-01-05T10:00:00.000Z");
		assert.equal(retry.properties["Team"], JSON.stringify([notion.urlOf(notion.row("Platform").id)]));
		assert.equal(retry.properties["Decisions"], JSON.stringify([notion.urlOf(notion.row("Use Postgres").id)]));
		assert.equal(retry.properties["Person"], JSON.stringify([notion.urlOf(notion.row("Ada Park").id)]));
		assert.match(String(retry.properties[DIGEST_PROPERTY]), /^sha256:[0-9a-f]{64}$/);
		assert.equal(retry.content, `See <mention url="${notion.urlOf(notion.row("Use Postgres").id)}">Use Postgres</mention> and <mention url="${notion.urlOf(notion.row("Ada Park").id)}">Ada Park</mention>, with <b>care</b> and <code>code</code>.\n\n## Action Items\n\n- [ ] Ship it\n`);
		assert.equal(notion.row("Outage").properties["Verbatim"], "__YES__");
		assert.equal(notion.row("Outage").content, "Line one<br />line two\n");
		assert.equal(notion.row("Runbook").content, '<callout icon="💡" color="green_bg">\nRestart\n\nRun it twice.\n</callout>\n');
		assert.equal(notion.rowsOf("knowledge").filter((page) => page.title === "Patterns").length, 1, "the row of the setup takes the note");
		assert.equal(notion.row("Patterns").properties["Scaffold"], "__YES__");
		assert.equal(notion.columns.work[SOURCE_PATH_PROPERTY]?.type, "text");
		assert.ok(notion.columns.work["Project"]?.options.includes("Billing"));
		assert.ok(notion.columns.knowledge["Tags"]?.options.includes("reference"));
		assert.equal(result.propertiesAdded, 8, "two columns in each of the four databases with a row");
	});

	test("the North Star page takes Memories as its Recent Context, and Home changes only in its Open Questions", async () => {
		const notion = memoryNotion();
		await run(notion);
		const { north_star: northStar, home } = notion.setupPages;
		assert.match(northStar.content, /^## Current Focus\n\n<synced-block url="[^"]+">\n- Ship <mention url="[^"]+">Retry Rules<\/mention>\n<\/synced-block>\n\n## Recent Context\n\n- Moved to Notion\n$/);
		assert.match(home.content, /<synced-block-reference url="[^"]+">\n- Ship <mention url="[^"]+">Retry Rules<\/mention>\n<\/synced-block-reference>/, "the reference shows the new text of the original");
		assert.match(home.content, /## Open Questions\n\n- Why <mention url="[^"]+">Home<\/mention>\?\n\n## Quick Links\n\n- \[North Star\]/);
		assert.match(home.content, /<database url="[^"]+" data-source-url="collection:\/\/[^"]+" inline="true"><\/database>\n$/, "the linked view stays");
	});

	test("an empty bullet at the end of the synced section of North Star makes no write on a second run (measured: Notion drops it)", async () => {
		const notion = memoryNotion();
		const files = { ...FILES, "brain/North Star.md": note("tags: [brain]", "# North Star\n\n## Current Focus\n\n_What now?_\n\n-\n\n## Goals\n\n-\n") };
		await run(notion, files);
		assert.doesNotMatch(notion.setupPages.north_star.content, /<li><\/li>\n<\/ul>\n<\/synced-block>/);
		assert.match(notion.setupPages.north_star.content, /## Goals\n\n<ul>\n<li><\/li>\n<\/ul>/);
		const before = notion.calls.length;
		assert.deepEqual(counts(await run(notion, files)), { created: 0, updated: 0, unchanged: PLANNED, failed: 0 });
		assert.deepEqual(writes(notion.calls, before), []);
	});

	test("a second run makes no write and reports zero new pages", async () => {
		const notion = memoryNotion();
		await run(notion);
		const before = notion.calls.length;
		const second = await run(notion);
		assert.deepEqual(counts(second), { created: 0, updated: 0, unchanged: PLANNED, failed: 0 });
		assert.equal(second.propertiesAdded + second.optionsAdded, 0);
		assert.deepEqual(writes(notion.calls, before), []);
	});

	test("a changed note gets one body write and one property write, and no other page changes", async () => {
		const notion = memoryNotion();
		await run(notion);
		const before = notion.calls.length;
		const result = await run(notion, { ...FILES, "reference/Runbook.md": note("tags: [reference]", "New steps.\n") });
		assert.deepEqual(counts(result), { created: 0, updated: 1, unchanged: PLANNED - 1, failed: 0 });
		const runbook = notion.row("Runbook").id;
		assert.deepEqual(
			writes(notion.calls, before).map((call) => [call.args["page_id"], call.args["command"]]),
			[
				[runbook, "replace_content"],
				[runbook, "update_properties"],
			],
		);
		assert.equal(notion.row("Runbook").content, "New steps.\n");
	});

	test("a run that stops at any write leaves a state that the next run completes, with no second row for a note", async () => {
		const reference = memoryNotion();
		await run(reference);
		const all = writes(reference.calls).length;
		assert.ok(all > 10);
		for (let stop = 0; stop < all; stop++) {
			const notion = memoryNotion();
			notion.failAfter(stop);
			await assert.rejects(run(notion), (error: unknown) => error instanceof NotionError && error.code === "transport", `stop at write ${stop}`);
			notion.heal();
			await run(notion);
			assert.deepEqual(snapshot(notion), snapshot(reference), `stop at write ${stop}`);
			const before = notion.calls.length;
			await run(notion);
			assert.deepEqual(writes(notion.calls, before), [], `a third run after a stop at write ${stop} makes no write`);
		}
	});

	test("a row of an earlier import that the vault no longer has stays, and the run names it", async () => {
		const notion = memoryNotion();
		await run(notion);
		const { "reference/Runbook.md": _runbook, ...rest } = FILES;
		const result = await run(notion, rest);
		assert.deepEqual(result.notInVault.map((row) => row.path), ["reference/Runbook.md"]);
		assert.equal(notion.row("Runbook").content, '<callout icon="💡" color="green_bg">\nRestart\n\nRun it twice.\n</callout>\n');
	});

	test("a page that Notion does not accept fails alone, and the next run writes it", async () => {
		const notion = memoryNotion();
		await run(notion);
		const original = notion.client.call;
		notion.client.call = async (tool, args) => {
			if (tool === "notion-update-page" && args?.["command"] === "replace_content" && String(args["new_str"]).includes("Rejected")) throw new NotionError("tool_error", "notion-update-page: the content is not valid");
			return original(tool, args);
		};
		const edited = { ...FILES, "reference/Runbook.md": note("tags: [reference]", "Rejected.\n"), "org/teams/Platform.md": note("tags: [team]", "New members.\n") };
		const result = await run(notion, edited);
		assert.deepEqual(result.failed.map((failure) => failure.path), ["reference/Runbook.md"]);
		assert.equal(notion.row("Platform").content, "New members.\n");
		notion.client.call = original;
		assert.deepEqual(counts(await run(notion, edited)), { created: 0, updated: 1, unchanged: PLANNED - 1, failed: 0 });
		assert.equal(notion.row("Runbook").content, "Rejected.\n");
	});

	test("the ledger gets one line for each row and column that the run made, and a line for a row that it lacks", async () => {
		const dir = mkdtempSync(join(tmpdir(), "import-ledger-"));
		try {
			const ledgerPath = join(dir, "created.jsonl");
			const notion = memoryNotion();
			await run(notion, FILES, { ledgerPath });
			const lines = (): { kind: string; title: string; pr: number }[] => readFileSync(ledgerPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
			assert.equal(lines().filter((line) => line.kind === "row").length, ROWS - 1);
			assert.equal(lines().filter((line) => line.kind === "property").length, 8);
			assert.ok(lines().every((line) => line.pr === 11));
			const other = mkdtempSync(join(tmpdir(), "import-ledger-"));
			await run(notion, FILES, { ledgerPath: join(other, "created.jsonl") });
			assert.deepEqual(readFileSync(join(other, "created.jsonl"), "utf8").trim().split("\n").length, ROWS - 1, "a ledger that lacks the rows gets them");
			rmTemp(other);
		} finally {
			rmTemp(dir);
		}
	});

	test("the query reads each page of rows", async () => {
		const notion = memoryNotion({ pageSize: 2 });
		await run(notion);
		const before = notion.calls.length;
		assert.equal((await run(notion)).created, 0);
		assert.deepEqual(writes(notion.calls, before), []);
	});

	test("a source path that Notion gives back in a form that the run does not know stops the run, and the next run makes no second row", async () => {
		const notion = memoryNotion({ storeText: (value) => (value.endsWith(".md") ? `${value} ` : value) });
		await assert.rejects(run(notion), /does not give back the source path of \d+ new rows as the run wrote it\. For example, the run wrote "[^"]+" and read "[^"]+ "/);
		const rows = notion.rowsOf("work").length;
		const before = notion.calls.length;
		await assert.rejects(run(notion), /notes have no row with their source path, and a row with their title has a source path that the vault does not hold/);
		assert.equal(notion.rowsOf("work").length, rows);
		assert.deepEqual(writes(notion.calls, before), []);
	});

	test("a note that moved to a new path stops the run when its old row has its title", async () => {
		const notion = memoryNotion();
		await run(notion);
		const { "reference/Runbook.md": runbook, ...rest } = FILES;
		const before = notion.calls.length;
		await assert.rejects(run(notion, { ...rest, "reference/ops/Runbook.md": runbook ?? "" }), /For example, "reference\/ops\/Runbook\.md" and the row "Runbook" with "reference\/Runbook\.md"/);
		assert.deepEqual(writes(notion.calls, before), []);
	});

	test("a run stops before its first write on a map of another root, on another workspace, and on two rows with one source path", async () => {
		const notion = memoryNotion();
		await assert.rejects(runImport(notion.client, vaultOf(FILES), notion.map, { rootTitle: "obsidian-mind", log: () => {} }), /names the root "obsidian-mind import test"/);
		const other = { ...notion.map, workspace_id: "workspace-2" };
		await assert.rejects(runImport(notion.client, vaultOf(FILES), other, { rootTitle: ROOT, log: () => {} }), /different workspace/);
		await run(notion);
		notion.addRow("knowledge", "Runbook copy", { [SOURCE_PATH_PROPERTY]: "reference/Runbook.md" });
		const before = notion.calls.length;
		await assert.rejects(run(notion), /Two rows have the source path "reference\/Runbook.md"/);
		assert.deepEqual(writes(notion.calls, before), []);
	});

	test("verifyImport finds each planned value, body, and place in Notion, and names a difference", async () => {
		const notion = memoryNotion();
		const result = await run(notion);
		const checks = await verifyImport(notion.client, notion.map, result.plan, result.refs);
		assert.deepEqual(checks.filter((check) => !check.same).map((check) => [check.path, check.cells]), []);
		notion.row("Runbook").properties["Description"] = "edited in Notion";
		notion.row("Platform").content = "Other.";
		const after = await verifyImport(notion.client, notion.map, result.plan, result.refs);
		assert.deepEqual(after.find((check) => check.path === "reference/Runbook.md")?.cells.properties, "Description: plan (empty), Notion edited in Notion");
		assert.match(after.find((check) => check.path === "org/teams/Platform.md")?.cells.body ?? "", /^different at line 1: plan "Members\.", Notion "Other\."$/);
	});
});

describe("the fixture vaults of the proof, in memory", () => {
	for (const name of ["fixture", "constructs"] as const) {
		test(`${name}: each page holds its plan, and a second run makes no write`, async () => {
			const dir = mkdtempSync(join(tmpdir(), "import-vaults-"));
			try {
				const vaults = writeImportVaults(dir, new Date("2026-11-26T00:00:00Z"));
				const notion = memoryNotion();
				const options = { rootTitle: ROOT, log: () => {}, sleep: async () => {} };
				const first = await runImport(notion.client, readVault(vaults[name]), notion.map, options);
				assert.deepEqual(first.failed, []);
				assert.ok(first.created > 0);
				const before = notion.calls.length;
				const second = await runImport(notion.client, readVault(vaults[name]), notion.map, options);
				assert.deepEqual(counts(second), { created: 0, updated: 0, unchanged: second.plan.pages.length, failed: 0 });
				assert.deepEqual(writes(notion.calls, before), []);
				const checks = await verifyImport(notion.client, notion.map, second.plan, second.refs);
				assert.deepEqual(checks.filter((check) => !check.same).map((check) => [check.path, check.cells]), []);
			} finally {
				rmTemp(dir);
			}
		});
	}
});

describe("plainText", () => {
	test("gives back each key of the first live import as the run wrote it", () => {
		const measured: [string, string][] = [
			["reference/Runbook Part [3.md](http://3.md)", "reference/Runbook Part 3.md"],
			["reference/[Runbook.md](http://Runbook.md)", "reference/Runbook.md"],
			["Loose [Draft.md](http://Draft.md)", "Loose Draft.md"],
		];
		for (const [stored, written] of measured) assert.equal(plainText(stored), written);
		assert.equal(plainText(autolink("work/1-1/Ada Park 2026-01-10.md")), "work/1-1/Ada Park 2026-01-10.md");
	});

	test("keeps a link whose text is not its address", () => {
		assert.equal(plainText("See [the guide](http://example.com) and [a.md](http://b.md)."), "See [the guide](http://example.com) and [a.md](http://b.md).");
	});
});

describe("sectionEdit", () => {
	const live = "## Current Focus\n\n<synced-block-reference url=\"x\">\n- a\n</synced-block-reference>\n\n## Open Questions\n\nOld.\n\n<database url=\"y\" inline=\"true\"></database>\n";

	test("replaces the lines of the section only, up to the next block of the setup", () => {
		assert.deepEqual(sectionEdit(live, "## Open Questions\n\n- New\n", "Open Questions"), { old_str: "## Open Questions\n\nOld.", new_str: "## Open Questions\n\n- New" });
	});

	test("a section in the forms that Notion stores is the same section (measured on the pages of the setup)", () => {
		const stored = "## Shifts\n\n<i>What changed?</i>\n\n<ul>\n<li></li>\n</ul>\n\n| Date | Shift |\n| --- | --- |\n|  | Created |\n";
		assert.equal(sectionEdit(stored, "## Shifts\n\n_What changed?_\n\n-\n\n| Date | Shift |\n|------|-------|\n|      | Created |\n", "Shifts"), null);
		assert.notEqual(sectionEdit(stored, "## Shifts\n\n_What changed?_\n\n-\n\n| Date | Shift |\n|------|-------|\n|      | Removed |\n", "Shifts"), null);
	});

	test("makes no edit when the page holds the section, or when the vault has no text for it, and appends a missing section", () => {
		assert.equal(sectionEdit(live, "## Open Questions\n\nOld.\n", "Open Questions"), null);
		assert.equal(sectionEdit(live, "", "Open Questions"), null);
		assert.deepEqual(sectionEdit("Text.\n", "## Open Questions\n\n- New\n", "Open Questions"), { append: "## Open Questions\n\n- New\n" });
	});
});
