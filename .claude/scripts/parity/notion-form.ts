/**
 * The Notion form of the fixture. The form needs the content model that the
 * setup creates, so a later pull request gives this function its body.
 */

import type { FixtureSpec, HookForm } from "./spec.ts";

/**
 * Make the notes of `spec` exist in the Notion workspace that `mapFile`
 * describes, with `Changed` at the instant that `changedAt` of `spec.ts`
 * gives for `now`. The result runs the hooks of `scriptsDir` on those notes.
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
