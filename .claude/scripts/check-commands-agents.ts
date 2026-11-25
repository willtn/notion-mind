#!/usr/bin/env node
/**
 * `node --experimental-strip-types check-commands-agents.ts [static] [links] [--live] [--tools-file <listing.json>]`
 *
 * With no mode, it runs both checks. It exits 0 when each check finds
 * nothing, 1 when a check has findings, and 2 when it cannot run a check.
 *
 *   static   the patterns of lib/commands-agents-check.ts over the commands and the subagents
 *   links    each Notion tool, argument, database, property, view, page, and template name
 *   --live   also fetch each database of the map file and check the references against the live schema
 *            (one `notion-fetch` read for each database)
 *   --tools-file  a saved `mcporter list notion --schema --output json` listing, in place of the live one
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	STATIC_GROUPS,
	formProblems,
	linkProblems,
	liveProblems,
	reachProblems,
	references,
	staticFindings,
	targetFiles,
	toolNames,
	toolTableFromSchema,
	type LiveSchema,
	type Problem,
	type ToolTable,
} from "./lib/commands-agents-check.ts";
import { createNotionClient } from "./lib/notion-client.ts";
import { notionMapPath, readNotionMap } from "./lib/notion-map.ts";
import { parseDatabase } from "./lib/notion-parse.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function loadListing(toolsFile: string | undefined): unknown {
	if (toolsFile !== undefined) return JSON.parse(readFileSync(toolsFile, "utf8"));
	const run = spawnSync("mcporter", ["list", "notion", "--schema", "--output", "json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true });
	if (run.status !== 0) throw new Error(`mcporter list notion failed: ${run.error?.message ?? run.stderr.trim()}`);
	return JSON.parse(run.stdout);
}

function report(title: string, problems: readonly Problem[]): number {
	for (const problem of problems) console.log(`${problem.kind}\t${problem.file}:${problem.line}\t${problem.name}\t${problem.detail}`);
	console.log(`${title}: ${problems.length} problems`);
	return problems.length;
}

async function liveSchemas(): Promise<LiveSchema[]> {
	const map = readNotionMap(notionMapPath(root));
	const client = await createNotionClient();
	try {
		const schemas: LiveSchema[] = [];
		for (const entry of Object.values(map.databases)) {
			const database = parseDatabase(await client.call("notion-fetch", { id: entry.id }));
			schemas.push({ title: database.title, properties: Object.keys(database.properties), views: database.views.map((view) => view.name) });
		}
		return schemas;
	} finally {
		await client.close();
	}
}

async function main(): Promise<number> {
	const args = process.argv.slice(2);
	const toolsFlag = args.indexOf("--tools-file");
	const toolsFile = toolsFlag === -1 ? undefined : args[toolsFlag + 1];
	const modes = args.filter((arg) => arg === "static" || arg === "links");
	const runStatic = modes.length === 0 || modes.includes("static");
	const runLinks = modes.length === 0 || modes.includes("links");
	const files = targetFiles(root);
	let failed = 0;

	if (runStatic) {
		const findings = staticFindings(files);
		for (const group of STATIC_GROUPS) console.log(`${group.name} ${findings.filter((f) => f.group === group.name).length}\t${group.proves}`);
		for (const finding of findings) console.log(`${finding.group}\t${finding.file}:${finding.line}\t${finding.text}`);
		console.log(`static: ${findings.length} hits in ${files.length} files`);
		failed += findings.length;
	}

	if (runLinks) {
		const tools: ToolTable = toolTableFromSchema(loadListing(toolsFile));
		const used = new Set(files.flatMap((file) => toolNames(file.text)));
		console.log(`tools: ${used.size} names used, ${tools.size} tools in the schema`);
		const found = files.flatMap((file) => references(file.text));
		const count = (kind: string): number => found.filter((ref) => ref.kind === kind).length;
		console.log(`references: ${count("property")} properties, ${count("view")} views, ${count("page")} pages, ${count("template")} templates`);
		failed += report("links", [...linkProblems(files, tools), ...reachProblems(files), ...formProblems(files)]);
		if (args.includes("--live")) {
			const schemas = await liveSchemas();
			console.log(`live: ${schemas.length} databases fetched`);
			failed += report("live", liveProblems(files, schemas));
		} else {
			console.log("live: skipped (no --live)");
		}
	}
	return failed === 0 ? 0 : 1;
}

main().then(
	(code) => process.exit(code),
	(error: unknown) => {
		console.error(`cannot run the check: ${error instanceof Error ? error.message : String(error)}`);
		process.exit(2);
	},
);
