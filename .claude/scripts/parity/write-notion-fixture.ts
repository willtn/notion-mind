/**
 * Write the fixture set into the Notion fixture root, and print what the
 * run changed. With `--verify`, also print the rows of each hook view and
 * the properties of some notes beside the values of the spec. The exit code
 * is 1 when a value differs.
 *
 *     node --experimental-strip-types parity/write-notion-fixture.ts
 *     node --experimental-strip-types parity/write-notion-fixture.ts --now 2026-03-04T10:00:00Z --verify
 *
 * Options:
 *   --map <path>        The map file of the fixture root. Default notion-map.fixtures.json in the repository root.
 *   --now <instant>     The instant that the note ages count from. Default the time of the run.
 *   --ledger <path>     Append one JSON line for each page that the run makes or moves to Trash. Default NOTION_LEDGER.
 *   --ledger-tag <k=v>  Add one field to each ledger line. Default NOTION_LEDGER_TAG. A run moves to Trash only
 *                       a page that has a ledger line with this field, so with no ledger and tag no page goes.
 *   --verify            Check each hook view and each note against the spec.
 */

import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseOpenLoopConfig } from "../lib/active-hygiene.ts";
import { createNotionClient, NotionError } from "../lib/notion-client.ts";
import { readNotionMap } from "../lib/notion-map.ts";
import { FIXTURE } from "./fixture.ts";
import { FIXTURE_MAP_FILE, ledgerHooksOf, writeFixture } from "./notion-form.ts";
import { checkNote, expectedViewRows, liveViewTitles } from "./notion-verify.ts";

function parseArgs(argv: readonly string[]): Record<string, string> {
	const flags: Record<string, string> = {};
	for (let i = 0; i < argv.length; i++) {
		const name = argv[i] ?? "";
		if (name === "--verify") flags["verify"] = "true";
		else if (["--map", "--now", "--ledger", "--ledger-tag"].includes(name) && argv[i + 1] !== undefined) flags[name.slice(2)] = argv[++i] ?? "";
		else throw new Error(`Unknown option or missing value: ${name}. Read the header of write-notion-fixture.ts for the options.`);
	}
	return flags;
}

async function main(): Promise<number> {
	const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
	const flags = parseArgs(process.argv.slice(2));
	const mapFlag = flags["map"] ?? FIXTURE_MAP_FILE;
	const map = readNotionMap(isAbsolute(mapFlag) ? mapFlag : join(repoRoot, mapFlag));
	const now = flags["now"] === undefined ? new Date() : new Date(flags["now"]);
	if (Number.isNaN(now.getTime())) throw new Error(`--now is not an instant: ${flags["now"]}`);
	const hooks = ledgerHooksOf({ NOTION_LEDGER: flags["ledger"] ?? process.env["NOTION_LEDGER"], NOTION_LEDGER_TAG: flags["ledger-tag"] ?? process.env["NOTION_LEDGER_TAG"] });

	const client = await createNotionClient();
	try {
		const result = await writeFixture(client, FIXTURE, map, { now, log: (line) => console.log(line), ...hooks });
		console.log(
			`fixture notes ${FIXTURE.notes.length}, now ${now.toISOString()}: created ${result.created}, updated ${result.updated}, unchanged ${result.unchanged}, moved to Trash ${result.trashed}, left in place ${result.left}, options added ${result.optionsAdded}`,
		);
		if (flags["verify"] === undefined) return 0;

		let differences = 0;
		console.log("\n| Database | View | Expected rows | Live rows | Same titles |\n|---|---|---|---|---|");
		for (const expectation of expectedViewRows(FIXTURE)) {
			const titles = await liveViewTitles(client, map, expectation.database, expectation.view);
			const same = titles.join("\n") === expectation.titles.join("\n");
			if (!same) differences++;
			console.log(`| ${map.databases[expectation.database].title} | ${expectation.view} | ${expectation.titles.length} | ${titles.length} | ${same ? "yes" : `no: expected [${expectation.titles.join(", ")}], live [${titles.join(", ")}]`} |`);
		}

		const manifest = FIXTURE.repoFiles.find((file) => file.path === "vault-manifest.json")?.content ?? null;
		const context = { now, openLoopSections: parseOpenLoopConfig(manifest).sectionRe, pages: result.pages };
		const shown = new Set(FIXTURE.notes.filter((note, index, notes) => notes.findIndex((other) => other.type === note.type) === index).map((note) => note.title));
		let checked = 0;
		console.log("\n| Note | Property | Spec | Notion | Same |\n|---|---|---|---|---|");
		for (const note of FIXTURE.notes) {
			for (const check of await checkNote(client, note, context)) {
				checked++;
				if (!check.same) differences++;
				if (!check.same || shown.has(note.title)) console.log(`| ${note.title} (${note.type}) | ${check.property} | ${check.spec} | ${check.notion} | ${check.same ? "yes" : "NO"} |`);
			}
		}
		console.log(`\nchecked ${checked} values of ${FIXTURE.notes.length} notes. The table shows the first note of each type and each value that differs.`);
		console.log(`\ndifferences ${differences}`);
		return differences === 0 ? 0 : 1;
	} finally {
		await client.close();
	}
}

main().then(
	(code) => process.exit(code),
	(error: unknown) => {
		console.error(error instanceof NotionError ? `write-notion-fixture: ${error.code}: ${error.message}` : `write-notion-fixture: ${error instanceof Error ? error.message : String(error)}`);
		process.exit(1);
	},
);
