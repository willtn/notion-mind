/**
 * Live checks of the Notion form of the fixture set. They need `mcporter`
 * with a Notion login and the map file of the fixture root, so they run only
 * with NOTION_LIVE=1 and skip in each other run. They write to the fixture
 * root only: the pages of the fixture notes get the values of the spec. Set
 * NOTION_LEDGER to record each page that a run makes or moves to Trash.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseOpenLoopConfig } from "../lib/active-hygiene.ts";
import { createNotionClient } from "../lib/notion-client.ts";
import { NOTION_MAP_ENV, NOTION_MAP_FILE, readNotionMap } from "../lib/notion-map.ts";
import { VERBATIM_PROPERTY } from "../lib/notion-model.ts";
import { FIXTURE } from "../parity/fixture.ts";
import { FIXTURE_MAP_FILE, ledgerHooksOf, notionForm, writeFixture } from "../parity/notion-form.ts";
import { ARCHIVED_WORK_GROUP } from "../parity/notion-pages.ts";
import { checkNote, expectedViewRows, liveViewTitles } from "../parity/notion-verify.ts";
import { NOTION_WORDING } from "../parity/notion-wording.ts";
import { minimalHookEnvironment } from "../parity/runner.ts";

const scriptsDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mapPath = join(resolve(scriptsDir, "..", ".."), FIXTURE_MAP_FILE);
const skip = process.env["NOTION_LIVE"] !== "1" || !existsSync(mapPath);
const now = new Date();
const manifest = FIXTURE.repoFiles.find((file) => file.path === "vault-manifest.json")?.content ?? null;

describe("the Notion form of the fixture set, live", () => {
	test("a second run with the same instant creates no page and updates no page", { skip }, async () => {
		const client = await createNotionClient();
		try {
			const map = readNotionMap(mapPath);
			const first = await writeFixture(client, FIXTURE, map, { now, ...ledgerHooksOf() });
			assert.equal(first.created + first.updated + first.unchanged, FIXTURE.notes.length);
			const second = await writeFixture(client, FIXTURE, map, { now, ...ledgerHooksOf() });
			assert.deepEqual({ created: second.created, updated: second.updated, trashed: second.trashed, optionsAdded: second.optionsAdded }, { created: 0, updated: 0, trashed: 0, optionsAdded: 0 });
			assert.equal(second.unchanged, FIXTURE.notes.length);
		} finally {
			await client.close();
		}
	});

	test("each hook view returns the rows that part (d) gives for the fixture set", { skip }, async () => {
		const client = await createNotionClient();
		try {
			const map = readNotionMap(mapPath);
			for (const expectation of expectedViewRows(FIXTURE)) {
				assert.deepEqual(await liveViewTitles(client, map, expectation.database, expectation.view), expectation.titles, `${expectation.database}: ${expectation.view}`);
			}
		} finally {
			await client.close();
		}
	});

	test("one fetch of the page of each note holds each property and the content of the spec", { skip }, async () => {
		const client = await createNotionClient();
		try {
			const { pages } = await writeFixture(client, FIXTURE, readNotionMap(mapPath), { now, ...ledgerHooksOf() });
			const context = { now, openLoopSections: parseOpenLoopConfig(manifest).sectionRe, pages };
			for (const note of FIXTURE.notes) {
				const wrong = (await checkNote(client, note, context)).filter((check) => !check.same);
				assert.deepEqual(wrong, [], note.title);
			}
		} finally {
			await client.close();
		}
	});

	test("a hook process in the environment of the form reaches the workspace of the map file", { skip: skip || process.platform === "win32" }, async () => {
		const form = await notionForm(FIXTURE, mapPath, { scriptsDir, now });
		const dir = mkdtempSync(join(tmpdir(), "om-notion-form-"));
		try {
			const environment = form(join(dir, "form"));
			for (const file of [...FIXTURE.repoFiles.map((repoFile) => repoFile.path), NOTION_MAP_FILE]) assert.ok(existsSync(join(environment.projectDir, file)), file);
			assert.equal(environment.env[NOTION_MAP_ENV], join(environment.projectDir, NOTION_MAP_FILE));

			const moduleUrl = (file: string): string => JSON.stringify(pathToFileURL(join(scriptsDir, "lib", file)).href);
			const script = [
				`import { createNotionClient } from ${moduleUrl("notion-client.ts")};`,
				`import { notionMapPath, readNotionMap } from ${moduleUrl("notion-map.ts")};`,
				`import { parseWorkspaceId } from ${moduleUrl("notion-parse.ts")};`,
				"const client = await createNotionClient();",
				'const workspace = parseWorkspaceId(await client.call("notion-get-self"));',
				"await client.close();",
				'console.log(workspace === readNotionMap(notionMapPath(process.cwd())).workspace_id ? "same workspace" : "different workspace");',
				'console.log(`variables: ${Object.keys(process.env).sort().join(" ")}`);',
			].join("\n");
			const withoutVault = (names: readonly string[]): string[] => names.filter((name) => !name.startsWith("MCPORTER_VAULT_")).sort();
			assert.deepEqual(withoutVault(Object.keys(environment.env)), ["MCPORTER_CONFIG", NOTION_MAP_ENV, "PATH", "XDG_DATA_HOME"], "the form adds only what mcporter and the map file need");
			const env = { ...minimalHookEnvironment(dir), ...environment.env };
			const run = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", "--experimental-strip-types", "--input-type=module", "-e", script], {
				env,
				cwd: environment.projectDir,
				encoding: "utf-8",
				timeout: 60_000,
			});
			assert.equal(run.status, 0, run.stderr);
			assert.match(run.stdout, /^same workspace$/m);
			const variables = run.stdout.match(/^variables: (.*)$/m)?.[1]?.split(" ").filter((name) => name !== "__CF_USER_TEXT_ENCODING") ?? [];
			assert.deepEqual(withoutVault(variables), withoutVault(Object.keys(env)), "the process has no variable of the harness");

			const note = FIXTURE.notes.find((candidate) => candidate.type === "Work note") ?? assert.fail("the fixture has no work note");
			const payload = environment.writePayload([note]);
			assert.equal(payload["tool_name"], "Bash");
			const command = String((payload["tool_input"] as { command: string }).command);
			const outbox = command.match(/\$\(cat ([^)]+)\)/)?.[1] ?? assert.fail(command);
			const args = JSON.parse(readFileSync(join(environment.projectDir, outbox), "utf-8")) as { allow_async: boolean; pages: { properties: Record<string, unknown> }[] };
			assert.equal(args.allow_async, false);
			assert.equal(args.pages[0]?.properties["Name"], note.title);
			assert.equal(args.pages[0]?.properties["Bytes"], undefined);
			const page = (args as unknown as { parent: { data_source_id: string } }).parent.data_source_id;
			assert.match(page, /^collection:\/\//);
			const stdout = JSON.parse(String((payload["tool_response"] as { stdout: string }).stdout)) as { pages: { id: string; url: string }[] };
			for (const reference of [note.title, stdout.pages[0]?.id ?? "", stdout.pages[0]?.url ?? "", `${stdout.pages[0]?.url}?pvs=204`]) {
				assert.equal(environment.noteOf(reference), note.title, reference);
			}
			assert.equal(environment.noteOf("No Such Note"), null);
			assert.equal(environment.wording, NOTION_WORDING);
			assert.deepEqual(environment.notesIn("Work note"), FIXTURE.notes.filter((candidate) => candidate.type === "Work note").map((candidate) => candidate.title));
			assert.deepEqual([...environment.notesIn(ARCHIVED_WORK_GROUP)].sort(), ["Legacy Importer", "Old Pricing Plan", "Search Migration", "Undated Plan"]);

			const raw = FIXTURE.notes.find((candidate) => candidate.verbatim) ?? assert.fail("the fixture has no verbatim note");
			const rawCommand = String((environment.writePayload([raw])["tool_input"] as { command: string }).command);
			const rawArgs = JSON.parse(readFileSync(join(environment.projectDir, rawCommand.match(/\$\(cat ([^)]+)\)/)?.[1] ?? ""), "utf-8")) as { pages: { properties: Record<string, unknown> }[] };
			assert.equal(rawArgs.pages[0]?.properties[VERBATIM_PROPERTY], "__YES__", "the write of a verbatim note sends the mark");

			const two = FIXTURE.notes.filter((candidate) => candidate.type === "Work note").slice(0, 2);
			const twoCommand = String((environment.writePayload(two)["tool_input"] as { command: string }).command);
			const twoArgs = JSON.parse(readFileSync(join(environment.projectDir, twoCommand.match(/\$\(cat ([^)]+)\)/)?.[1] ?? ""), "utf-8")) as { pages: { properties: Record<string, unknown> }[] };
			assert.deepEqual(twoArgs.pages.map((page) => page.properties["Name"]), two.map((candidate) => candidate.title), "one call writes both notes");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
