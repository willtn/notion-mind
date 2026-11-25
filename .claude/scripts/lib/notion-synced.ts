/**
 * A section that one page owns as an original synced block and another page
 * shows as a reference. Notion cannot embed one heading of another page, as
 * `![[North Star#Current Focus]]` does in `Home.md`. A synced block is the
 * same live text in two places.
 *
 * Each step reads the live content of the pages and makes only the
 * difference, so a second run changes nothing.
 */

import type { NotionClient } from "./notion-client.ts";
import type { SyncedSection } from "./notion-model.ts";
import { notionId, parsePage } from "./notion-parse.ts";

const headingLine = (heading: string): string => `## ${heading}`;

interface Span {
	readonly start: number;
	readonly end: number;
	readonly lines: readonly string[];
}

/** The lines of a `##` section: from its heading to its last line that has text. */
function findSection(content: string, heading: string): Span | undefined {
	const lines = content.split("\n");
	const start = lines.findIndex((line) => line.trim() === headingLine(heading));
	if (start === -1) return undefined;
	const rest = lines.slice(start + 1);
	const next = rest.findIndex((line) => /^##? /.test(line));
	const body = next === -1 ? rest : rest.slice(0, next);
	let last = body.length - 1;
	while (last >= 0 && (body[last] ?? "").trim() === "") last--;
	return { start, end: start + 1 + last, lines };
}

/** The text under a `##` heading, without the heading and the blank lines around it. */
export function sectionBody(content: string, heading: string): string | undefined {
	const span = findSection(content, heading);
	return span === undefined ? undefined : span.lines.slice(span.start + 1, span.end + 1).join("\n").trim();
}

/** The URL of the original synced block that makes up a section, or `undefined`. */
export function syncedBlockUrl(content: string, heading: string): string | undefined {
	return sectionBody(content, heading)?.match(/^<synced-block url="([^"]+)">/)?.[1];
}

/** The search and replace that turns the body of a section into an original synced block, or `undefined` when it is one already. */
export function wrapSection(content: string, heading: string): { readonly old_str: string; readonly new_str: string } | undefined {
	const span = findSection(content, heading);
	if (span === undefined) throw new Error(`The page has no "${headingLine(heading)}" section to make a synced block from.`);
	const body = span.lines.slice(span.start + 1, span.end + 1).join("\n").trim();
	if (body === "") throw new Error(`The section "${headingLine(heading)}" has no text to make a synced block from.`);
	if (body.startsWith("<synced-block")) return undefined;
	const indented = body.split("\n").map((line) => (line === "" ? line : `\t${line}`));
	return {
		old_str: span.lines.slice(span.start, span.end + 1).join("\n"),
		new_str: [span.lines[span.start], "", "<synced-block>", ...indented, "</synced-block>"].join("\n"),
	};
}

/** The block that shows the original under its own heading. */
export const referenceSection = (heading: string, url: string): string => `${headingLine(heading)}\n\n<synced-block-reference url="${url}"></synced-block-reference>\n`;

/** What to insert at the top of the page so that it shows the original, or `undefined` when it does. */
export function referenceInsert(content: string, heading: string, url: string): string | undefined {
	const body = sectionBody(content, heading);
	if (body === undefined) return referenceSection(heading, url);
	if (body.includes(`<synced-block-reference url="${url}"`)) return undefined;
	throw new Error(`The page has a "${headingLine(heading)}" section that does not show the original synced block. Remove that section, then run the setup again.`);
}

/** Make the original block, then the reference. Calls `onCreated` for each block that it makes. */
export async function ensureSyncedSection(
	client: NotionClient,
	sync: SyncedSection,
	pages: { readonly original: string; readonly copy: string },
	onCreated: (id: string, title: string) => void,
): Promise<void> {
	const fetchContent = async (id: string): Promise<string> => parsePage(await client.call("notion-fetch", { id })).content;
	const originalContent = await fetchContent(pages.original);
	let url = syncedBlockUrl(originalContent, sync.section);
	if (url === undefined) {
		const wrap = wrapSection(originalContent, sync.section);
		if (wrap === undefined) throw new Error(`The section "${sync.section}" is a synced block without a URL in the reply of Notion.`);
		await client.call("notion-update-page", { page_id: pages.original, command: "update_content", content_updates: [wrap] });
		url = syncedBlockUrl(await fetchContent(pages.original), sync.section);
		if (url === undefined) throw new Error(`Notion did not keep the synced block of "${sync.section}".`);
		onCreated(notionId(url.split("#")[1] ?? ""), `synced block: ${sync.section}`);
	}
	const insert = referenceInsert(await fetchContent(pages.copy), sync.section, url);
	if (insert === undefined) return;
	await client.call("notion-update-page", { page_id: pages.copy, command: "insert_content", content: insert, position: { type: "start" } });
	if (referenceInsert(await fetchContent(pages.copy), sync.section, url) !== undefined) throw new Error(`Notion did not keep the synced block reference of "${sync.section}".`);
	onCreated(notionId(pages.copy), `synced block reference: ${sync.section}`);
}
