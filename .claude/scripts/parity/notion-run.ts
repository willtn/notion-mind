/**
 * The port side of a parity run on the real workspace: the hooks of this
 * repository on the Notion form of the fixture, for the scenarios of one
 * hook. `run-parity.ts` and `run-mutations.ts` read their options here.
 *
 *     --notion            Compare with the hooks of this repository on the Notion form.
 *     --hook <name>       The hook to compare, such as validate-write. Necessary with --notion.
 *     --now <instant>     The instant that the note ages count from. Default the time of the run.
 *     --map <path>        The map file of the fixture root. Default notion-map.fixtures.json in the repository root.
 *
 * A run with the same `--now` as the last write of the fixture changes no
 * `Changed` value. Only one run at a time can use the fixture root.
 */

import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createNotionClient } from "../lib/notion-client.ts";
import { readNotionMap } from "../lib/notion-map.ts";
import { FIXTURE } from "./fixture.ts";
import { FIXTURE_MAP_FILE, ledgerHooksOf, notionForms, writeFixture } from "./notion-form.ts";
import { HOOKS, type FixtureSpec, type HookForm, type HookName } from "./spec.ts";

export interface NotionRun {
	readonly hook: HookName;
	readonly now: Date;
	/** The fixture with only the scenarios that run `hook`. */
	readonly spec: FixtureSpec;
	/** The directory of the hooks of this repository. */
	readonly scriptsDir: string;
	/** The form that runs the hooks of a scripts directory on the fixture root. */
	readonly form: (scriptsDir: string) => HookForm;
	/**
	 * Write the fixture again. A ported hook changes the rows that it reads
	 * as written, so a run ends with this step. The result is one line for
	 * the summary.
	 */
	readonly restore: () => Promise<string>;
}

const VALUE_FLAGS = ["--hook", "--now", "--map"];

/** The Notion run that `argv` asks for, or `null` for a run with no `--notion`. Each other argument stays in `rest`. */
export async function notionRun(argv: readonly string[]): Promise<{ readonly run: NotionRun | null; readonly rest: string[] }> {
	const flags: Record<string, string> = {};
	const rest: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		const name = argv[i] ?? "";
		if (name === "--notion") flags["notion"] = "true";
		else if (VALUE_FLAGS.includes(name) && argv[i + 1] !== undefined) flags[name.slice(2)] = argv[++i] ?? "";
		else rest.push(name);
	}
	if (flags["notion"] === undefined) return { run: null, rest };

	const hook = flags["hook"];
	if (hook === undefined || !Object.hasOwn(HOOKS, hook)) throw new Error(`--notion needs --hook with one of: ${Object.keys(HOOKS).join(", ")}.`);
	const now = flags["now"] === undefined ? new Date() : new Date(flags["now"]);
	if (Number.isNaN(now.getTime())) throw new Error(`--now is not an instant: ${flags["now"]}`);
	const scriptsDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
	const mapFlag = flags["map"] ?? FIXTURE_MAP_FILE;
	const mapFile = isAbsolute(mapFlag) ? mapFlag : join(scriptsDir, "..", "..", mapFlag);

	const restore = async (): Promise<string> => {
		const client = await createNotionClient();
		try {
			const result = await writeFixture(client, FIXTURE, readNotionMap(mapFile), { now, ...ledgerHooksOf() });
			return `fixture written again for ${now.toISOString()}: created ${result.created}, updated ${result.updated}, unchanged ${result.unchanged}`;
		} finally {
			await client.close();
		}
	};
	const spec: FixtureSpec = { ...FIXTURE, scenarios: FIXTURE.scenarios.filter(({ steps }) => steps.some((step) => step.hook === hook)) };
	return { run: { hook: hook as HookName, now, spec, scriptsDir, form: await notionForms(FIXTURE, mapFile, now), restore }, rest };
}
