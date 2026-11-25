/**
 * The Notion form of the fixture. The form needs the content model that the
 * setup creates, so a later pull request gives this function its body.
 */

import type { FixtureSpec, HookForm } from "./spec.ts";

/**
 * Make the notes of `spec` exist in the Notion workspace that `mapFile`
 * describes. Each note has `Changed` at the instant that `changedAt` of
 * `spec.ts` gives for `now`. Each note also has the derived properties that
 * the write hook sets, with the values that its content gives: `Bytes`,
 * `Open tasks`, `Open loops`, `Has content`, and `Hook stamp`. The ported
 * hooks read these properties, so a note without them gives wrong findings.
 *
 * The result runs the hooks of `scriptsDir` on those notes. Its `wording`
 * is `NOTION_WORDING`, its `projectDir` holds the repository files of
 * `spec`, and its `env` adds only what the Notion calls need.
 *
 * `mapFile` is the path of `notion-map.json`.
 */
export async function notionForm(
	_spec: FixtureSpec,
	_mapFile: string,
	_options: { readonly scriptsDir: string; readonly now: Date },
): Promise<HookForm> {
	throw new Error("not implemented");
}
