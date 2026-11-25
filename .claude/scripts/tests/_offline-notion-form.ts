/**
 * The Notion form of the fixture with no Notion: the pages have made-up
 * IDs, and each hook process calls the stand-in runtime of
 * `_fake-notion.ts`. A test of a ported hook runs the parity comparison on
 * it, so `npm test` shows a difference before a live run does.
 *
 * A view query gets the rows that the filters of the model give for the
 * fixture notes. This file has a stand-in for each formula that a filter
 * reads, because the formula text runs only in Notion. The run on the real
 * workspace is the proof of the formulas.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseOpenLoopConfig } from "../lib/active-hygiene.ts";
import type { NotionMap } from "../lib/notion-map.ts";
import { DATABASES, SYNCED_SECTIONS, type Filter, type ViewSpec } from "../lib/notion-model.ts";
import { referenceSection, sectionBody } from "../lib/notion-synced.ts";
import { createArguments, hookFormOf } from "../parity/notion-form.ts";
import { composeContent, desiredValues, propertyArguments, storedBody, targetOf, type NoteContext, type PageRef, type Values } from "../parity/notion-pages.ts";
import { changedAt, isLooseActive, type FixtureNote, type FixtureSpec, type HookForm } from "../parity/spec.ts";
import { fakeMap, fakeNotion, fakeUrl, fetchedPage, viewRows, type FakeCall } from "./_fake-notion.ts";

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

const DAY_MS = 86_400_000;
const yesNo = (test: boolean): string => (test ? "yes" : "no");

/** The value of each formula that a view of the model filters, for one note. */
const FORMULAS: Readonly<Record<string, (note: FixtureNote, values: Values, now: Date) => string>> = {
	Stale: (note, _values, now) => yesNo(Math.floor((now.getTime() - changedAt(note, now).getTime()) / DAY_MS) >= 14),
	"Older than 7 days": (note, _values, now) => yesNo(Math.floor((now.getTime() - changedAt(note, now).getTime()) / DAY_MS) >= 7),
	Oversized: (note, values) => yesNo(typeof values["Bytes"] === "number" && values["Bytes"] >= 25_000 && !note.title.includes("Archive")),
};

function passes(filter: Filter, note: FixtureNote, values: Values, now: Date): boolean {
	const value = FORMULAS[filter.property]?.(note, values, now) ?? values[filter.property] ?? null;
	if ("is" in filter) return value === filter.is;
	if ("in" in filter) return typeof value === "string" && filter.in.includes(value);
	if ("empty" in filter) return value === null;
	if ("above" in filter) return typeof value === "number" && value > filter.above;
	throw new Error(`The stand-in has no test for the filter of "${filter.property}".`);
}

const inView = (view: ViewSpec, note: FixtureNote, values: Values, now: Date): boolean => (view.filters ?? []).every((filter) => passes(filter, note, values, now));

type ViewEntry = { readonly note: FixtureNote; readonly values: Values; readonly row: Readonly<Record<string, unknown>> };

/** The entries in the order of the sort of `view`. A value that is absent is last, and the title gives the order of two equal values. */
function inViewOrder(view: ViewSpec, entries: readonly ViewEntry[]): ViewEntry[] {
	const { sort } = view;
	if (sort === undefined) return [...entries];
	const key = (entry: ViewEntry): string | number | null => {
		const value = sort.property === "Name" ? entry.note.title : entry.values[sort.property];
		return typeof value === "string" || typeof value === "number" ? value : null;
	};
	const direction = sort.direction === "ASC" ? 1 : -1;
	return [...entries].sort((a, b) => {
		const [x, y] = [key(a), key(b)];
		if (x === y) return a.note.title < b.note.title ? -1 : 1;
		if (x === null || y === null) return x === null ? 1 : -1;
		return (x < y ? -1 : 1) * direction;
	});
}

/** Markdown in the form that a fetch returns it (measured): a strike-through is a tag. */
const asFetched = (markdown: string): string => markdown.replace(/~~([^~\n]+)~~/g, "<s>$1</s>");

/**
 * The reply of `notion-fetch` for each page of the setup that holds a
 * fixture note, and for the root page. A section of `SYNCED_SECTIONS` is a
 * synced block on its page, and the page that shows it has a reference with
 * the same text, as the setup makes them (measured on the fixture root).
 */
function setupPageReplies(spec: FixtureSpec, map: NotionMap, pages: ReadonlyMap<string, PageRef>, blockId: () => string): Record<string, string> {
	const scaffold = spec.notes.flatMap((note) => {
		const target = targetOf(note);
		return target.kind === "scaffold" ? [{ key: target.page, title: note.title, id: map.pages[target.page].id }] : [];
	});
	const content = new Map(scaffold.map(({ key, title }) => [key, storedBody(spec.notes.find((note) => note.title === title)!, pages)] as const));
	for (const { section, original, copy } of SYNCED_SECTIONS) {
		const from = content.get(original);
		const to = content.get(copy);
		if (from === undefined || to === undefined) continue;
		const url = `${map.pages[original].url}#${blockId().replace(/-/g, "")}`;
		content.set(original, composeContent(from, `## ${section}\n\n<synced-block url="${url}">\n</synced-block>\n`));
		content.set(copy, composeContent(to, referenceSection(section, url).replace("></synced-block-reference>", `>\n${sectionBody(from, section) ?? ""}\n</synced-block-reference>`)));
	}
	const root = { id: map.root.id, title: map.root.title };
	const child = (tag: string, url: string, title: string, attributes = ""): string => `<${tag} url="${url}"${attributes}>${title}</${tag}>`;
	return {
		...Object.fromEntries(scaffold.map(({ key, title, id }) => [id, fetchedPage({ id, title, properties: { title }, content: asFetched(content.get(key) ?? ""), under: [root] })] as const)),
		[root.id]: fetchedPage({
			...root,
			properties: { title: root.title },
			content: [
				...Object.values(map.pages).map(({ url, title }) => child("page", url, title)),
				...[...pages].filter(([, { target }]) => target.kind === "loose").map(([title, { url }]) => child("page", url, title)),
				...Object.values(map.databases).map(({ url, title, data_source }) => child("database", url, title, ` inline="false" data-source-url="${data_source}"`)),
			].join("\n"),
			under: [],
		}),
	};
}

/** `dir` gets the map file. `now` is the instant that the note ages count from. */
export function offlineNotion(spec: FixtureSpec, dir: string, now: Date): OfflineNotion {
	const { map, nextId } = fakeMap();
	const pages = new Map(
		spec.notes.map((note) => {
			const target = targetOf(note);
			const id = target.kind === "scaffold" ? map.pages[target.page].id : nextId();
			return [note.title, { id, url: fakeUrl(id), target }] as const;
		}),
	);
	const context = { now, openLoopSections: parseOpenLoopConfig(spec.repoFiles.find((file) => file.path === "vault-manifest.json")?.content ?? null).sectionRe, pages };
	const byView: Record<string, string> = {};
	for (const database of DATABASES) {
		const rows = spec.notes.flatMap((note) => {
			const target = targetOf(note);
			if (target.kind !== "row" || target.database !== database.key) return [];
			const values = desiredValues(note, database.key, context);
			return [{ note, values, row: { Name: note.title, url: pages.get(note.title)?.url, ...propertyArguments(values, database.key) } }];
		});
		for (const view of database.views) {
			const url = map.databases[database.key].views[view.name];
			if (url !== undefined) byView[url] = viewRows(inViewOrder(view, rows.filter(({ note, values }) => inView(view, note, values, now))).map(({ row }) => row));
		}
	}
	const mapFile = join(dir, "notion-map.offline.json");
	writeFileSync(mapFile, JSON.stringify(map));

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
			"notion-query-data-sources": { byView },
			"notion-update-page": JSON.stringify({ result: "ok" }),
			"notion-fetch": { byId: { ...stored, ...setupPageReplies(spec, map, pages, nextId) } },
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
