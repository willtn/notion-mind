/**
 * The findings of the write check for one written note, and the derived
 * properties that the hook sets on its row. Each function is pure.
 *
 *     const { blocks, policyResults } = checkNote(note, { required, looseActive });
 *     await notion.call("notion-update-page", derivedUpdate(note, openLoopSections, new Date()));
 *
 * The text of a finding is the text of the hook at `fae7be4` with the name
 * of the Notion object in the place of the Markdown object.
 */

import { MONOLITH_BYTES, formatMonolithHint, isMonolithExempt, namesCapped, topicClusters } from "./active-hygiene.ts";
import { countTicketIdWikilinks, type FrontmatterRequired } from "./frontmatter.ts";
import type { PolicyResult } from "./hook-io.ts";
import { derivedValues } from "./notion-derived.ts";
import { DATABASES, LOOSE_ACTIVE_TYPES } from "./notion-model.ts";
import { frontmatterBlock, hasRelation, isSkipped, missingFields, noteMarkdown, valueOf, type WrittenNote } from "./notion-note.ts";
import { hardWrappedParagraphs } from "./prose-width.ts";

export interface NoteFindings {
	readonly blocks: string[];
	readonly policyResults: PolicyResult[];
}

export interface CheckOptions {
	/** `frontmatter_required` of `vault-manifest.json`. */
	readonly required: FrontmatterRequired;
	/** The titles of the loose active rows, or `null` when the hook did not read the view. The written note counts also when the list does not hold it. */
	readonly looseActive: readonly string[] | null;
}

/** The view of the Work database that holds each active row with no `Project`. */
export const LOOSE_ACTIVE_VIEW = "Hygiene: loose active";

/** The target that a topic cluster policy suggests. */
export const TOPIC_GROUP = "a `Project` value";

/** True for a row that the view "Hygiene: loose active" returns. Only such a row can join a topic cluster. */
export function isLooseActive(note: WrittenNote): boolean {
	if (note.place.kind !== "row" || note.place.database !== "work") return false;
	const type = valueOf(note.properties, "Type");
	return (
		valueOf(note.properties, "Status") === "active" &&
		valueOf(note.properties, "Project") === null &&
		typeof type === "string" &&
		(LOOSE_ACTIVE_TYPES as readonly string[]).includes(type)
	);
}

const FIELD_MESSAGES: Readonly<Record<string, (property: string) => string>> = {
	tags: (property) => `The property \`${property}\` is empty`,
	description: (property) => `The property \`${property}\` is empty (~150 chars required by vault convention)`,
	date: (property) => `The property \`${property}\` is empty`,
};

const emptyProperty = (field: string, property: string): string =>
	FIELD_MESSAGES[field]?.(property) ?? `The property \`${property}\` is empty (required by vault-manifest.json frontmatter_required)`;

function warningsOf(note: WrittenNote, text: string, required: FrontmatterRequired): string[] {
	const warnings: string[] = [];
	if (note.place.kind === "page") warnings.push("The page is not a row of a note database");
	for (const { field, property } of missingFields(note, required)) warnings.push(emptyProperty(field, property));

	if (text.length > 300 && !text.includes("[[") && !note.body.includes("<mention") && !hasRelation(note)) {
		warnings.push("No mentions or relations found — every note must link to at least one other note (vault convention)");
	}
	const wrapped = hardWrappedParagraphs(text);
	if (wrapped.length > 0) {
		// The writer sees the page content and not the frontmatter block, so the line is a line of the content.
		const firstLine = (wrapped[0] ?? 0) - (frontmatterBlock(note).split("\n").length - 1);
		warnings.push(
			`${wrapped.length} hard-wrapped paragraph line(s), first at line ${firstLine} — write each paragraph as one line; GitHub renders a single newline as a break (raw captures: the checkbox \`Verbatim\`)`,
		);
	}
	const ticketLinks = countTicketIdWikilinks(text);
	if (ticketLinks > 0) {
		warnings.push(
			`${ticketLinks} ticket-ID wikilink(s) (e.g. [[PROJ-…]]) — ticket IDs are plain text or tracker links, never wikilinks (they are not notes)`,
		);
	}
	return warnings;
}

function clusterHint(token: string, titles: readonly string[]): string {
	return [
		`🗂️  This note joins ${titles.length - 1} active row(s) with no \`Project\` sharing "${token}": ${namesCapped(titles)}.`,
		`Convention: once a workstream has >1 note it gets ${TOPIC_GROUP}.`,
		"Token overlap is BLIND — judge whether these genuinely share context before grouping; if they don't, say so and move on.",
	].join("\n");
}

/** The findings of one written note. A page that the check skips has none. */
export function checkNote(note: WrittenNote, { required, looseActive }: CheckOptions): NoteFindings {
	const blocks: string[] = [];
	const policyResults: PolicyResult[] = [];
	if (isSkipped(note)) return { blocks, policyResults };

	const text = noteMarkdown(note);
	const warnings = warningsOf(note, text, required);
	if (warnings.length > 0) {
		blocks.push(`Workspace hygiene warnings for \`${note.title}\`:\n${warnings.map((warning) => `  - ${warning}`).join("\n")}\nFix these before moving on.`);
		if (countTicketIdWikilinks(text) > 0) {
			policyResults.push({ policy_id: "phantom-edge", path: note.url, classification: "ticket-id-wikilink", action: "warn" });
		}
	}

	const bytes = Buffer.byteLength(text, "utf-8");
	if (bytes >= MONOLITH_BYTES && !isMonolithExempt(note.title)) {
		blocks.push(formatMonolithHint(note.title, bytes));
		policyResults.push({ policy_id: "organization-threshold", path: note.url, classification: "oversized-note", action: "flag" });
	}

	if (looseActive !== null && isLooseActive(note)) {
		const cluster = topicClusters([...new Set([...looseActive, note.title])]).find(({ files }) => files.includes(note.title));
		if (cluster !== undefined) {
			blocks.push(clusterHint(cluster.token, cluster.files));
			policyResults.push({ policy_id: "topic-cluster", path: note.url, classification: "ungrouped-cluster", suggested_target: TOPIC_GROUP, action: "flag" });
		}
	}
	return { blocks, policyResults };
}

/**
 * The one `notion-update-page` call that sets the derived properties of a
 * row, or `null` for a page that is not a row. `Changed` moves only for a
 * write that changed the note, because a property write moves the last
 * edit time of Notion. `Hook stamp` is in the same call, so no later write
 * of the hook comes after it.
 */
export function derivedUpdate(note: WrittenNote, openLoopSections: RegExp, at: Date): Record<string, unknown> | null {
	if (note.place.kind !== "row") return null;
	const database = note.place.database;
	const model = DATABASES.find((spec) => spec.key === database)?.properties ?? {};
	const derived = derivedValues(noteMarkdown(note), openLoopSections);
	const stamp = at.toISOString();
	const values: Readonly<Record<string, unknown>> = {
		Bytes: derived.bytes,
		"Open tasks": derived.openTasks,
		"Open loops": derived.openLoops,
		"Has content": derived.hasContent ? "__YES__" : "__NO__",
	};
	const properties: Record<string, unknown> = Object.fromEntries(Object.entries(values).filter(([name]) => name in model));
	if (note.changed) Object.assign(properties, { "date:Changed:start": stamp, "date:Changed:is_datetime": 1 });
	Object.assign(properties, { "date:Hook stamp:start": stamp, "date:Hook stamp:is_datetime": 1 });
	return { page_id: note.id, command: "update_properties", properties };
}
