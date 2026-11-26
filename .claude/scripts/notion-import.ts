/**
 * Move a Markdown vault of this template into the Notion content model.
 *
 *     node --experimental-strip-types .claude/scripts/notion-import.ts --vault ../my-vault --dry-run
 *     node --experimental-strip-types .claude/scripts/notion-import.ts --vault ../my-vault
 *     node --experimental-strip-types .claude/scripts/notion-import.ts --vault ../my-vault --verify
 *
 * The run reads the vault and never changes it. Each note becomes a row
 * with its path in the property "Source path", and the run finds a row by
 * that value. So a second run makes no page, and it writes only a note
 * that changed. Run `notion-setup.ts` first: the import needs its map file.
 *
 * The output is a Markdown report: the place of each note, each file that
 * the import leaves out, and each construct that loses form.
 *
 * Options:
 *   --vault <dir>          The vault to read. Required.
 *   --root-title <title>   The title of the root page that the map file must name. Default "obsidian-mind".
 *   --map <path>           The map file. Default notion-map.json in the repository root.
 *   --ledger <path>        Append one JSON line for each row, property, and option set that the run makes.
 *   --ledger-tag <k=v>     Add one field to each ledger line.
 *   --dry-run              Make no Notion call. Print the report of the plan.
 *   --verify               After the run, fetch each page and compare it with the plan. Exit 1 on a difference.
 */

import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { placeholderRefs, placeVault, planImport } from "./lib/import-plan.ts";
import { lossReport, planReport, verifyReport } from "./lib/import-report.ts";
import { runImport, verifyImport } from "./lib/import-run.ts";
import { readVault } from "./lib/import-source.ts";
import { isMainModule } from "./lib/main-guard.ts";
import { createNotionClient, NotionError } from "./lib/notion-client.ts";
import { NOTION_MAP_FILE, readNotionMap } from "./lib/notion-map.ts";

const VALUE_FLAGS: readonly string[] = ["--vault", "--root-title", "--map", "--ledger", "--ledger-tag"];
const SWITCHES: readonly string[] = ["--dry-run", "--verify"];

export function parseArgs(argv: readonly string[]): Record<string, string> {
	const flags: Record<string, string> = {};
	for (let i = 0; i < argv.length; i++) {
		const name = argv[i] ?? "";
		if (SWITCHES.includes(name)) flags[name.slice(2)] = "true";
		else if (VALUE_FLAGS.includes(name) && argv[i + 1] !== undefined) flags[name.slice(2)] = argv[++i] ?? "";
		else throw new Error(`Unknown option or missing value: ${name}. Read the header of notion-import.ts for the options.`);
	}
	if (flags["vault"] === undefined) throw new Error("--vault <dir> is required.");
	if (flags["dry-run"] !== undefined && flags["verify"] !== undefined) throw new Error("--verify reads the pages of a run, and --dry-run makes none. Use one of them.");
	return flags;
}

async function main(): Promise<number> {
	const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
	const flags = parseArgs(process.argv.slice(2));
	const vault = readVault(resolve(flags["vault"] ?? ""));
	const name = basename(vault.root);

	if (flags["dry-run"] !== undefined) {
		const places = placeVault(vault);
		const plan = planImport(vault, places, placeholderRefs(places));
		console.log(`# Import plan of the vault "${name}" (dry run, no Notion call)\n`);
		console.log(`notes read ${vault.notes.length}, pages planned ${plan.pages.length}, files left out ${plan.leftOut.length}\n`);
		console.log(`${planReport(plan)}\n\n${lossReport(plan)}`);
		return 0;
	}

	const mapFlag = flags["map"] ?? NOTION_MAP_FILE;
	const map = readNotionMap(isAbsolute(mapFlag) ? mapFlag : join(repoRoot, mapFlag));
	const tag = flags["ledger-tag"]?.split("=");
	const tagValue = tag?.[1] !== undefined && /^\d+$/.test(tag[1]) ? Number(tag[1]) : tag?.[1];
	const client = await createNotionClient();
	try {
		const result = await runImport(client, vault, map, {
			rootTitle: flags["root-title"] ?? "obsidian-mind",
			log: (line) => console.error(line),
			...(flags["ledger"] === undefined ? {} : { ledgerPath: flags["ledger"] }),
			...(tag?.[0] === undefined ? {} : { ledgerTag: [tag[0], tagValue] as const }),
		});
		console.log(`# Import of the vault "${name}" into the root "${map.root.title}"\n`);
		console.log(`notes read ${vault.notes.length}, pages planned ${result.plan.pages.length}, files left out ${result.plan.leftOut.length}`);
		console.log(`created ${result.created}, updated ${result.updated}, unchanged ${result.unchanged}, failed ${result.failed.length}`);
		console.log(`properties added ${result.propertiesAdded}, options added ${result.optionsAdded}, rows of an earlier import that this vault does not hold ${result.notInVault.length}\n`);
		for (const failure of result.failed) console.log(`- failed: ${failure.path}: ${failure.message}`);
		console.log(`${planReport(result.plan)}\n\n${lossReport(result.plan)}`);
		if (flags["verify"] === undefined) return result.failed.length === 0 ? 0 : 1;

		const checks = await verifyImport(client, map, result.plan, result.refs);
		console.log(`\n${verifyReport(checks)}`);
		return result.failed.length === 0 && checks.every((check) => check.same) ? 0 : 1;
	} finally {
		await client.close();
	}
}

if (isMainModule(import.meta.url)) {
	main().then(
		(code) => process.exit(code),
		(error: unknown) => {
			console.error(error instanceof NotionError ? `notion-import: ${error.code}: ${error.message}` : `notion-import: ${error instanceof Error ? error.message : String(error)}`);
			process.exit(1);
		},
	);
}
