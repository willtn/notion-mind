/**
 * Checks of the Notion form against the spec, on a read path that the
 * writer does not use: the rows that each hook view returns, and the
 * properties and the content of one page fetch.
 *
 * The expected rows of a view come from the conditions of the original
 * hooks on the Markdown form (the folder, the file age, and the file text),
 * not from the view filters. So a view filter that does not match part (d)
 * shows as a difference. The original hooks count a note from the day that
 * its age reaches a limit: `floor(age in days) >= limit`.
 */

import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { countOpenLoops, INBOX_PRESSURE_DAYS, isMonolithExempt, MONOLITH_BYTES, OPEN_LOOP_DAYS, parseOpenLoopConfig } from "../lib/active-hygiene.ts";
import type { NotionClient } from "../lib/notion-client.ts";
import type { NotionMap } from "../lib/notion-map.ts";
import type { DatabaseKey } from "../lib/notion-model.ts";
import { parsePage, parseRows } from "../lib/notion-parse.ts";
import { markdownPath, renderNote } from "./markdown-form.ts";
import { canonicalContent, composeContent, desiredValues, FIXTURE_DATABASES, liveValues, notionBody, targetOf, type NoteContext, type Value } from "./notion-pages.ts";
import type { FixtureNote, FixtureSpec } from "./spec.ts";

export interface ViewExpectation {
	readonly database: DatabaseKey;
	readonly view: string;
	/** The titles of the fixture notes that the view must return, in sorted order. */
	readonly titles: readonly string[];
	/**
	 * The titles of `titles` that the original hook skips by the name of
	 * the note. No view filter of part (d) holds a name, so the view returns
	 * these rows and the ported hook must leave them out.
	 */
	readonly hookLeavesOut: readonly string[];
}

/** The rows that each view of a hook must return for the fixture set, by the conditions of part (d). */
export function expectedViewRows(spec: FixtureSpec): ViewExpectation[] {
	const manifest = spec.repoFiles.find((file) => file.path === "vault-manifest.json")?.content ?? null;
	const loops = parseOpenLoopConfig(manifest);
	const folder = (note: FixtureNote): string => dirname(markdownPath(note));
	const inDatabase = (note: FixtureNote, database: DatabaseKey): boolean => {
		const target = targetOf(note);
		return target.kind === "row" && target.database === database;
	};
	const titles = (test: (note: FixtureNote) => boolean): string[] => spec.notes.filter(test).map((note) => note.title).sort();
	const looseActive = (note: FixtureNote): boolean => folder(note) === "work/active";
	const hasOpenLoops = (note: FixtureNote): boolean =>
		loops.dirs.includes(folder(note)) && note.changedDaysAgo >= OPEN_LOOP_DAYS && countOpenLoops(renderNote(note), loops.sectionRe) > 0;
	const view = (database: DatabaseKey, name: string, test: (note: FixtureNote) => boolean, skippedByName: (note: FixtureNote) => boolean = () => false): ViewExpectation => ({
		database,
		view: name,
		titles: titles(test),
		hookLeavesOut: titles((note) => test(note) && skippedByName(note)),
	});

	return [
		...FIXTURE_DATABASES.map((database) =>
			view(database, "Hygiene: oversized", (note) => inDatabase(note, database) && Buffer.byteLength(renderNote(note)) >= MONOLITH_BYTES && !isMonolithExempt(`${note.title}.md`)),
		),
		// `findOpenLoops` of the original skips a note with "Archive" in its name.
		view("work", "Hygiene: open loops", hasOpenLoops, (note) => note.title.includes("Archive")),
		view("work", "Hygiene: inbox pressure", (note) => folder(note) === "work/meetings" && note.changedDaysAgo >= INBOX_PRESSURE_DAYS),
		view("work", "Hygiene: loose active", looseActive),
		view("work", "Open tasks", (note) => looseActive(note) && /^\s*- \[ \]/m.test(note.body)),
		// `formatBrainIndex` of the original leaves out the note "Memories".
		view("knowledge", "Brain index", (note) => note.type === "Brain topic", (note) => note.title === "Memories"),
		...FIXTURE_DATABASES.map((database) => view(database, "Hygiene: edited outside hooks", () => false)),
	];
}

/** The titles of the rows that a saved view returns now, in sorted order. */
export async function liveViewTitles(client: NotionClient, map: NotionMap, database: DatabaseKey, view: string): Promise<string[]> {
	const url = map.databases[database].views[view];
	if (url === undefined) throw new Error(`The map file has no view "${view}" for ${map.databases[database].title}.`);
	const titles: string[] = [];
	let cursor: string | undefined;
	do {
		const page = parseRows(await client.call("notion-query-data-sources", { data: { mode: "view", view_url: url, page_size: 100, ...(cursor === undefined ? {} : { start_cursor: cursor }) } }));
		titles.push(...page.rows.map((row) => String(row["Name"] ?? "")));
		cursor = page.nextCursor;
	} while (cursor !== undefined);
	return titles.sort();
}

export interface FieldCheck {
	readonly property: string;
	readonly spec: string;
	readonly notion: string;
	readonly same: boolean;
}

const digest = (content: string): string => `${Buffer.byteLength(content)} bytes, sha256 ${createHash("sha256").update(content).digest("hex").slice(0, 12)}`;

/** Each property and the content of one fixture note: the value of the spec beside the value of one page fetch. */
export async function checkNote(client: NotionClient, note: FixtureNote, context: NoteContext): Promise<FieldCheck[]> {
	const page = context.pages.get(note.title);
	if (page === undefined) throw new Error(`${note.title} is not a page of the fixture.`);
	const reply = await client.call("notion-fetch", { id: page.id });
	const fetched = parsePage(reply);
	const checks: FieldCheck[] = [];

	if (page.target.kind === "row") {
		// The fetch reply is JSON, and its `text` holds the page with the properties as one JSON line.
		const text = typeof reply.json === "object" && reply.json !== null && "text" in reply.json ? String(reply.json.text) : reply.text;
		const properties = text.match(/<properties>\n([\s\S]*?)\n<\/properties>/)?.[1];
		if (properties === undefined) throw new Error(`The fetch of "${note.title}" has no properties.`);
		const live = liveValues(JSON.parse(properties) as Record<string, unknown>, page.target.database);
		const titleOf = new Map([...context.pages].map(([title, ref]) => [ref.id, title] as const));
		const show = (value: Value | undefined): string => JSON.stringify(Array.isArray(value) ? value.map((item) => titleOf.get(item) ?? item) : (value ?? null));
		for (const [property, value] of Object.entries(desiredValues(note, page.target.database, context))) {
			checks.push({ property, spec: show(value), notion: show(live[property]), same: show(value) === show(live[property]) });
		}
	}
	const wanted = canonicalContent(composeContent(notionBody(note, context.pages), fetched.content));
	const held = canonicalContent(fetched.content);
	checks.push({ property: "content", spec: digest(wanted), notion: digest(held), same: wanted === held });
	return checks;
}

