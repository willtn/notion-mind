/**
 * `notion-map.json`: the one file that holds the Notion IDs of the content
 * model. The setup writes it. Each hook, command, and subagent reads it.
 * The file is not committed, because the repository is public.
 *
 *     const map = readNotionMap(join(repoRoot, NOTION_MAP_FILE));
 *     map.databases.work.data_source      // "collection://…"
 *     map.databases.work.views["Open tasks"]  // "view://…"
 *     map.pages.north_star.url
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { writeFileAtomic } from "./atomic-write.ts";
import type { DatabaseKey, PageKey } from "./notion-model.ts";

export const NOTION_MAP_FILE = "notion-map.json";

export interface NotionRef {
	readonly id: string;
	readonly url: string;
}

export interface MapDatabase extends NotionRef {
	readonly title: string;
	/** The `collection://` URL, for `data_source_id` and for queries. */
	readonly data_source: string;
	/** The `view://` URL of each saved view, by view name. */
	readonly views: Readonly<Record<string, string>>;
}

export interface MapPage extends NotionRef {
	readonly title: string;
	/** The `view://` URL of each linked view on the page, by view name. */
	readonly views: Readonly<Record<string, string>>;
}

export interface NotionMap {
	readonly version: 1;
	readonly workspace_id: string;
	readonly root: NotionRef & { readonly title: string };
	readonly databases: Readonly<Record<DatabaseKey, MapDatabase>>;
	readonly pages: Readonly<Record<PageKey | "reader_map", MapPage>>;
	/** The template rows, by template title. */
	readonly templates: Readonly<Record<string, NotionRef>>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** The map file, or an error that says how to make it. The check is on the top-level parts only. */
export function readNotionMap(path: string): NotionMap {
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		const cause = error instanceof Error ? error.message : String(error);
		throw new Error(`Cannot read the Notion map file ${path} (${cause}). Run notion-setup.ts to write it.`);
	}
	const parts = ["root", "databases", "pages", "templates"] as const;
	if (!isRecord(parsed) || parsed["version"] !== 1 || typeof parsed["workspace_id"] !== "string" || !parts.every((key) => isRecord(parsed[key]))) {
		throw new Error(`The Notion map file ${path} does not have the shape of version 1. Run notion-setup.ts to write it again.`);
	}
	return parsed as unknown as NotionMap;
}

export function writeNotionMap(path: string, map: NotionMap): void {
	writeFileAtomic(path, `${JSON.stringify(map, null, "\t")}\n`);
}

/** A digest of the map content. The "Reader map" page shows it, so the setup can see when the page is out of date. */
function mapDigest(map: NotionMap): string {
	return `sha256:${createHash("sha256").update(JSON.stringify(map)).digest("hex")}`;
}

export const digestLine = (map: NotionMap): string => `Map digest: ${mapDigest(map)}`;

/** The body of the "Reader map" page: the same data as the file, for a reader that cannot read the repository. */
export function readerMapBody(map: NotionMap): string {
	const link = (title: string, url: string): string => `[${title}](${url})`;
	const viewRows = (owner: string, views: Readonly<Record<string, string>>): string[] =>
		Object.entries(views).map(([name, url]) => `| ${owner} | ${name} | \`${url}\` |`);
	const databases = Object.values(map.databases);
	const pages = Object.values(map.pages);
	return [
		"This page is a copy of the map file that the setup of the repository writes. The setup replaces this page, so do not edit it.",
		"",
		digestLine(map),
		"",
		"## Databases",
		"",
		"| Database | Data source |",
		"|---|---|",
		...databases.map((d) => `| ${link(d.title, d.url)} | \`${d.data_source}\` |`),
		"",
		"## Views",
		"",
		"Query a view with `notion-query-data-sources` in view mode.",
		"",
		"| Database or page | View | URL |",
		"|---|---|---|",
		...databases.flatMap((d) => viewRows(d.title, d.views)),
		...pages.flatMap((p) => viewRows(p.title, p.views)),
		"",
		"## Pages",
		"",
		...pages.map((p) => `- ${link(p.title, p.url)}`),
		"",
		"## Templates",
		"",
		...Object.entries(map.templates).map(([title, ref]) => `- ${link(title, ref.url)}`),
		"",
	].join("\n");
}
