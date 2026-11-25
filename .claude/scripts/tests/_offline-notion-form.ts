/**
 * The Notion form of the fixture with no Notion: the pages have made-up
 * IDs, and each hook process calls the stand-in runtime of
 * `_fake-notion.ts`. A test of a ported hook runs the parity comparison on
 * it, so `npm test` shows a difference before a live run does.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseOpenLoopConfig } from "../lib/active-hygiene.ts";
import type { NotionMap } from "../lib/notion-map.ts";
import { createArguments, hookFormOf } from "../parity/notion-form.ts";
import { storedBody, targetOf, type NoteContext, type PageRef } from "../parity/notion-pages.ts";
import { isLooseActive, type FixtureNote, type FixtureSpec, type HookForm } from "../parity/spec.ts";
import { fakeMap, fakeNotion, fakeUrl, fetchedPage, type FakeCall } from "./_fake-notion.ts";

export interface OfflineNotion {
	readonly map: NotionMap;
	readonly pages: ReadonlyMap<string, PageRef>;
	/** The form that runs the hooks of `scriptsDir`. */
	readonly form: (scriptsDir: string) => HookForm;
	/** The Notion calls of each scenario so far, in the order of the runs. */
	readonly calls: () => FakeCall[];
}

/** The reply of `notion-fetch` for the page of `note`: the properties and the body as Notion stores them after a write of `createArguments`. */
export function storedPageReply(note: FixtureNote, id: string, map: NotionMap, context: NoteContext): string {
	const target = targetOf(note);
	const [sent] = createArguments([note], map, context)["pages"] as { properties: Record<string, unknown> }[];
	const database = target.kind === "row" ? map.databases[target.database] : undefined;
	return fetchedPage({
		id,
		title: note.title,
		properties: sent?.properties ?? {},
		content: storedBody(note, context.pages).replace(/\n+$/, ""),
		...(database === undefined ? {} : { rowOf: { id: database.id, data_source: database.data_source, title: database.title } }),
		under: database === undefined ? [{ id: map.root.id, title: map.root.title }] : [],
	});
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

	const context = { now, openLoopSections: parseOpenLoopConfig(spec.repoFiles.find((file) => file.path === "vault-manifest.json")?.content ?? null).sectionRe, pages };
	const stored = Object.fromEntries(
		spec.notes
			.filter((note) => targetOf(note).kind !== "scaffold")
			.map((note) => {
				const page = pages.get(note.title);
				if (page === undefined) throw new Error(`${note.title} is not a page of the fixture.`);
				return [page.id, storedPageReply(note, page.id, map, context)] as const;
			}),
	);

	const fakes: { calls: () => FakeCall[] }[] = [];
	const notionEnv = (tools: string): Record<string, string> => {
		mkdirSync(tools, { recursive: true });
		const fake = fakeNotion(tools, {
			"notion-query-data-sources": JSON.stringify({ results: looseActive, has_more: false }),
			"notion-update-page": JSON.stringify({ result: "ok" }),
			"notion-fetch": { byId: stored },
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
