/**
 * The body of a vault note as Notion-flavored Markdown (part a.5 of the
 * design record), with each construct that loses form on the way.
 *
 *     const { body, losses, links } = convertBody(note, resolve);
 *     // "See [[Patterns|the list]]. ==Done==."  ->  'See <mention url="https://…">Patterns</mention>. <span color="yellow_bg">Done</span>.'
 *     // losses: [{ kind: "link alias", line: 9, example: "[[Patterns|the list]]" }]
 *     // links:  [{ target: { path: "brain/Patterns.md", … }, section: "Related" }]
 *
 * A code block and a code span stay as they are.
 */

import { hardWrappedParagraphs } from "./prose-width.ts";
import type { SourceNote } from "./import-source.ts";

/** Each construct that loses form, with the sentence that the report shows for it. */
export const LOSS_KINDS = {
	"link alias": "A link with an alias becomes a mention. A mention shows the title of its page, so the alias is lost.",
	"heading anchor": "A link to a heading becomes a mention of the page. The heading anchor is lost.",
	"block anchor": "A link to a block becomes a mention of the page. Notion has no named block anchor.",
	"block ID": "A block ID at the end of a line is removed.",
	embed: "An embed becomes a mention. The page shows a link and not the content of the other note.",
	"unresolved link": "A link to a note that the vault does not hold stays as text.",
	"left-out link": "A link to a file that the import leaves out stays as text.",
	attachment: "A link to a file that is not a note stays as text. The import does not upload the file.",
	"local link": "A Markdown link to a local path stays as it is. Notion cannot open the path.",
	comment: "A comment is removed.",
	"callout type": "A callout of a type that the icon table does not hold gets the default icon. The type name is lost.",
	"callout fold": "A callout that folds becomes a callout that is always open.",
	"inline tag": "An inline tag stays as text. It is not a value of the Tags property.",
	"hard wrap": "The lines of a hard-wrapped paragraph become one line.",
	"frontmatter key": "A frontmatter key with no property in the database of the note is not written.",
	"frontmatter value": "A frontmatter value that its property cannot hold is not written.",
	"relation target": "A name in a relation field that is not a note of the related database is not written.",
	"replaced text": "A page of the setup takes one section of the note. A view of Notion replaces the rest of the note, so the rest is not written.",
} as const;

export type LossKind = keyof typeof LOSS_KINDS;

export interface Loss {
	readonly kind: LossKind;
	/** The 1-based line of the file. */
	readonly line: number;
	readonly example: string;
}

/** The page that a link names. */
export interface LinkTarget {
	/** The source path of the note of the page. */
	readonly path: string;
	readonly title: string;
	readonly url: string;
}

/** What the name in a link names: a page, a file that the import leaves out, a file that is not a note, or nothing. */
export type Resolution = { readonly kind: "page"; readonly target: LinkTarget } | { readonly kind: "left out" } | { readonly kind: "file" } | { readonly kind: "none" };

export interface BodyLink {
	readonly target: LinkTarget;
	/** The text of the heading above the link, or `null`. */
	readonly section: string | null;
}

export interface ConvertedBody {
	readonly body: string;
	readonly losses: readonly Loss[];
	/** Each link to a page, in the order of the text. */
	readonly links: readonly BodyLink[];
}

const CALLOUT_STYLES: readonly (readonly [types: readonly string[], icon: string, color: string])[] = [
	[["note"], "📝", "blue_bg"],
	[["info", "todo"], "ℹ️", "blue_bg"],
	[["abstract", "summary", "tldr"], "📋", "green_bg"],
	[["tip", "hint", "important"], "💡", "green_bg"],
	[["success", "check", "done"], "✅", "green_bg"],
	[["question", "help", "faq"], "❓", "yellow_bg"],
	[["warning", "caution", "attention"], "⚠️", "yellow_bg"],
	[["failure", "fail", "missing", "danger", "error", "bug"], "❗", "red_bg"],
	[["example"], "🧪", "purple_bg"],
	[["quote", "cite"], "💬", "gray_bg"],
];
const DEFAULT_CALLOUT_STYLE = ["💡", "gray_bg"] as const;

const FENCE = /^\s*(`{3,}|~{3,})/;
const CALLOUT = /^>\s*\[!([A-Za-z-]+)\]([+-]?)\s*(.*)$/;
const HEADING = /^#{1,6}\s+(.*?)\s*#*\s*$/;
const BLOCK_ID = /(?:^|\s)\^[A-Za-z0-9-]+\s*$/;
const WIKILINK = /(!?)\[\[([^\]\n]+?)\]\]/g;
const HIGHLIGHT = /==(?=\S)([^=\n]+?)==/g;
const INLINE_TAG = /(?:^|\s)(#[A-Za-z][\w/-]*)/;
const MARKDOWN_LINK = /!?\[[^\]\n]*\]\(([^)\s]+)[^)\n]*\)/g;
const REMOTE = /^(?:[a-z][a-z0-9+.-]*:|#|<)/i;
const CODE_SPAN = /(`+[^`\n]*`+)/;

interface Line {
	/** The 1-based line of the file. */
	readonly no: number;
	text: string;
	/** A line of a code block, which no rule changes. */
	readonly code: boolean;
}

/** `text` without each `%%comment%%`. `open` is true when a comment goes on after the line. */
function withoutComments(text: string, open: boolean): { readonly text: string; readonly open: boolean; readonly removed: readonly string[] } {
	const parts = text.split("%%");
	const removed: string[] = [];
	let kept = "";
	let inComment = open;
	for (const [index, part] of parts.entries()) {
		if (index > 0) inComment = !inComment;
		if (inComment) {
			if (part.trim() !== "") removed.push(part.trim());
		} else kept += part;
	}
	return { text: kept, open: inComment, removed };
}

const dequoted = (text: string): string => text.replace(/^(?:>\s?)+/, "");

/**
 * The body of `note` for its page. `resolve` gives what the name in a link
 * names. The name is the text before `#` and `|`.
 */
export function convertBody(note: Pick<SourceNote, "title" | "body" | "bodyLine" | "text">, resolve: (name: string) => Resolution): ConvertedBody {
	const losses: Loss[] = [];
	const links: BodyLink[] = [];
	const lose = (kind: LossKind, line: number, example: string): void => {
		losses.push({ kind, line, example: example.length > 120 ? `${example.slice(0, 117)}...` : example });
	};

	const lines: Line[] = [];
	let fence: string | null = null;
	let inComment = false;
	for (const [index, raw] of note.body.split("\n").entries()) {
		const no = note.bodyLine + index;
		if (fence !== null) {
			lines.push({ no, text: raw, code: true });
			if (raw.trim().startsWith(fence) && raw.trim().replace(/[`~]/g, "") === "") fence = null;
			continue;
		}
		const open = inComment ? null : FENCE.exec(raw);
		if (open !== null) {
			fence = open[1] ?? "```";
			lines.push({ no, text: raw, code: true });
			continue;
		}
		const stripped = withoutComments(raw, inComment);
		inComment = stripped.open;
		for (const comment of stripped.removed) lose("comment", no, `%%${comment}%%`);
		const onlyComment = stripped.text.trim() === "" && (raw.trim() !== "" || stripped.open);
		if (!onlyComment) lines.push({ no, text: stripped.text.trimEnd(), code: false });
	}

	const first = lines.findIndex((line) => line.text.trim() !== "");
	if (first !== -1 && !lines[first]?.code && lines[first]?.text.trim() === `# ${note.title}`) lines.splice(0, first + 1);

	// The lines that the hard-wrap check of the write hook flags go up to the line above them.
	const wrapped = new Set(hardWrappedParagraphs(note.text));
	const joined: Line[] = [];
	let lastNo = -1;
	let inJoin = false;
	for (const line of lines) {
		const above = joined.at(-1);
		if (wrapped.has(line.no) && !line.code && above !== undefined && !above.code && lastNo === line.no - 1) {
			if (!inJoin) lose("hard wrap", above.no, `${above.text} / ${dequoted(line.text)}`);
			above.text = `${above.text} ${dequoted(line.text).trimStart()}`;
			inJoin = true;
		} else {
			joined.push({ ...line });
			inJoin = false;
		}
		lastNo = line.no;
	}

	let section: string | null = null;
	const inline = (text: string, no: number): string =>
		text
			.split(CODE_SPAN)
			.map((part, index) => {
				if (index % 2 === 1) return part;
				let out = part.replace(WIKILINK, (source, bang: string, inner: string) => {
					const [name = "", alias] = inner.split(/\\?\|/);
					const [page = "", anchor] = name.split("#");
					const label = alias?.trim() || (anchor ?? "").replace(/^\^/, "") || page.trim();
					if (page.trim() === "") {
						lose("heading anchor", no, source);
						return label;
					}
					const resolution = resolve(page.trim());
					if (resolution.kind !== "page") {
						lose(resolution.kind === "file" ? "attachment" : resolution.kind === "left out" ? "left-out link" : "unresolved link", no, source);
						return source;
					}
					if (bang === "!") lose("embed", no, source);
					if (anchor !== undefined) lose(anchor.startsWith("^") ? "block anchor" : "heading anchor", no, source);
					if (alias !== undefined && alias.trim() !== resolution.target.title) lose("link alias", no, source);
					links.push({ target: resolution.target, section });
					return `<mention url="${resolution.target.url}">${resolution.target.title}</mention>`;
				});
				for (const match of out.matchAll(MARKDOWN_LINK)) {
					if (!REMOTE.test(match[1] ?? "")) lose("local link", no, match[0]);
				}
				out = out.replace(HIGHLIGHT, '<span color="yellow_bg">$1</span>');
				const tag = INLINE_TAG.exec(part);
				if (tag !== null && !HEADING.test(text)) lose("inline tag", no, tag[1] ?? "");
				return out;
			})
			.join("");

	const out: string[] = [];
	for (let i = 0; i < joined.length; i++) {
		const line = joined[i];
		if (line === undefined) continue;
		if (line.code) {
			out.push(line.text);
			continue;
		}
		let text = line.text;
		if (BLOCK_ID.test(text)) {
			lose("block ID", line.no, text.trim());
			text = text.replace(BLOCK_ID, "");
			if (text.trim() === "") continue;
		}
		const heading = HEADING.exec(text);
		if (heading !== null) section = heading[1] ?? null;

		const callout = CALLOUT.exec(text);
		if (callout === null) {
			out.push(inline(text, line.no));
			continue;
		}
		const [, type = "", fold = "", title = ""] = callout;
		const style = CALLOUT_STYLES.find(([types]) => types.includes(type.toLowerCase()));
		if (style === undefined) lose("callout type", line.no, text);
		if (fold !== "") lose("callout fold", line.no, text);
		const content: string[] = [];
		while (joined[i + 1] !== undefined && !joined[i + 1]?.code && /^>/.test(joined[i + 1]?.text ?? "")) {
			const child = joined[++i];
			if (child !== undefined) content.push(inline(dequoted(child.text), child.no));
		}
		while (content[0]?.trim() === "") content.shift();
		while (content.at(-1)?.trim() === "") content.pop();
		const label = title.trim() === "" ? (content.shift() ?? `${type.charAt(0).toUpperCase()}${type.slice(1)}`) : inline(title.trim(), line.no);
		const [, icon, color] = style ?? ["", ...DEFAULT_CALLOUT_STYLE];
		out.push(`<callout icon="${icon}" color="${color}">`, label, ...(content.length === 0 ? [] : ["", ...content]), "</callout>");
	}

	const body = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
	return { body: body === "" ? "" : `${body}\n`, losses, links };
}

/**
 * One `##` section of `note`, converted, with its heading. `rest` is the
 * first line of text outside the section that is not a title heading, or
 * `null` when there is none. A note without the section gives `null`.
 */
export function convertSection(
	note: Pick<SourceNote, "title" | "body" | "bodyLine" | "text">,
	heading: string,
	resolve: (name: string) => Resolution,
): (ConvertedBody & { readonly rest: { readonly line: number; readonly text: string } | null }) | null {
	const lines = note.body.split("\n");
	let fence: string | null = null;
	const isTopHeading = lines.map((line) => {
		if (fence !== null) {
			if (line.trim().startsWith(fence)) fence = null;
			return false;
		}
		const open = FENCE.exec(line);
		if (open !== null) {
			fence = open[1] ?? "```";
			return false;
		}
		return /^##? /.test(line);
	});
	const start = lines.findIndex((line, index) => isTopHeading[index] === true && line.trim() === `## ${heading}`);
	if (start === -1) return null;
	const next = isTopHeading.findIndex((top, index) => top && index > start);
	const end = next === -1 ? lines.length : next;
	const outside = lines.findIndex((line, index) => (index < start || index >= end) && line.trim() !== "" && !/^#\s/.test(line));
	const converted = convertBody({ ...note, body: lines.slice(start, end).join("\n"), bodyLine: note.bodyLine + start }, resolve);
	return { ...converted, rest: outside === -1 ? null : { line: note.bodyLine + outside, text: (lines[outside] ?? "").trim() } };
}
