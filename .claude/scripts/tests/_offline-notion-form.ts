/**
 * The Notion form of the fixture with no Notion: the pages have made-up
 * IDs, and each hook process calls the stand-in runtime of
 * `_fake-notion.ts`. A test of a ported hook runs the parity comparison on
 * it, so `npm test` shows a difference before a live run does.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { NotionMap } from "../lib/notion-map.ts";
import { hookFormOf } from "../parity/notion-form.ts";
import { targetOf, type PageRef } from "../parity/notion-pages.ts";
import { isLooseActive, type FixtureSpec, type HookForm } from "../parity/spec.ts";
import { fakeMap, fakeNotion, fakeUrl, type FakeCall } from "./_fake-notion.ts";

export interface OfflineNotion {
	readonly map: NotionMap;
	readonly pages: ReadonlyMap<string, PageRef>;
	/** The form that runs the hooks of `scriptsDir`. */
	readonly form: (scriptsDir: string) => HookForm;
	/** The Notion calls of each scenario so far, in the order of the runs. */
	readonly calls: () => FakeCall[];
}

/** `dir` gets the map file. `now` is the instant that the note ages count from. */
export function offlineNotion(spec: FixtureSpec, dir: string, now: Date): OfflineNotion {
	const { map, nextId } = fakeMap();
	const pages = new Map(
		spec.notes.map((note) => {
			const id = nextId();
			return [note.title, { id, url: fakeUrl(id), target: targetOf(note) }] as const;
		}),
	);
	const looseActive = spec.notes.filter(isLooseActive).map((note) => ({ Name: note.title, url: pages.get(note.title)?.url }));
	const mapFile = join(dir, "notion-map.offline.json");
	writeFileSync(mapFile, JSON.stringify(map));

	const fakes: { calls: () => FakeCall[] }[] = [];
	const notionEnv = (tools: string): Record<string, string> => {
		mkdirSync(tools, { recursive: true });
		const fake = fakeNotion(tools, {
			"notion-query-data-sources": JSON.stringify({ results: looseActive, has_more: false }),
			"notion-update-page": JSON.stringify({ result: "ok" }),
		});
		fakes.push(fake);
		return fake.env;
	};
	return {
		map,
		pages,
		form: (scriptsDir) => hookFormOf(spec, { scriptsDir, now, mapFile, map, pages, notionEnv }),
		calls: () => fakes.flatMap((fake) => fake.calls()),
	};
}
