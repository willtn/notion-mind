/**
 * The body of a vault note as Notion-flavored Markdown (part a.5 of the
 * design record), with each construct that loses form on the way.
 *
 *     const { body, losses, links } = convertBody(note, resolve);
 *     // "See [[Patterns|the list]]. ==Done==."  ->  'See <mention url="https://…">Patterns</mention>. <span color="yellow_bg">Done</span>.'
 *     // losses: [{ kind: "link alias", line: 9, example: "[[Patterns|the list]]" }]
 *     // links:  [{ target: { path: "brain/Patterns.md", … }, section: "Related" }]
 *
 * A code block, a code span, and a `$$` math block stay as they are, each
 * blank line included. Notion keeps them in that form (measured), except the
 * language of a code block, which `code-language.ts` holds. A run of blank
 * lines between two blocks becomes one blank line, as Notion stores it.
 */

import { storedLanguage } from "./code-language.ts";
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
	"code language": "A code block with no language, or with a language that Notion does not know, becomes a `javascript` code block. The code stays as it is.",
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

const FENCE = /^\s*(`{3,}|~{3,})(.*)$/;
const CALLOUT = /^>\s*\[!([A-Za-z-]+)\]([+-]?)\s*(.*)$/;
const HEADING = /^#{1,6}\s+(.*?)\s*#*\s*$/;
const BLOCK_ID = /(?:^|\s)\^[A-Za-z0-9-]+\s*$/;
const WIKILINK = /(!?)\[\[([^\]\n]+?)\]\]/g;
const HIGHLIGHT = /==(?=\S)([^=\n]+?)==/g;
const INLINE_TAG = /(?:^|\s)(#[A-Za-z][\w/-]*)/;
const MARKDOWN_LINK = /!?\[[^\]\n]*\]\(([^)\s]+)[^)\n]*\)/g;
const REMOTE = /^(?:[a-z][a-z0-9+.-]*:|#|<)/i;

interface Line {
	/** The 1-based line of the file. */
	readonly no: number;
	text: string;
	/** A line of a code block or of a math block, which no rule changes. */
	readonly literal: boolean;
	/** The quote depth of the block of a literal line. 0 for each other line. */
	readonly quote: number;
}

/** The index after the run of backticks at `start` of `text`. */
function backticksEnd(text: string, start: number): number {
	let end = start;
	while (text[end] === "`") end++;
	return end;
}

/**
 * The index after the code span that opens at `start` of `text`. With no
 * run of backticks of the same length to close it, the run at `start` is
 * text, and the result is the index after the run.
 */
function codeEnd(text: string, start: number): { readonly end: number; readonly isSpan: boolean } {
	const open = backticksEnd(text, start);
	for (let i = open; i < text.length; i++) {
		if (text[i] !== "`") continue;
		const end = backticksEnd(text, i);
		if (end - i === open - start) return { end, isSpan: true };
		i = end;
	}
	return { end: open, isSpan: false };
}

/** The parts of `text` in order: each code span, and the text between two code spans. */
function spans(text: string): { readonly text: string; readonly code: boolean }[] {
	const parts: { text: string; code: boolean }[] = [];
	let from = 0;
	for (let i = 0; i < text.length; ) {
		if (text[i] !== "`") {
			i++;
			continue;
		}
		const { end, isSpan } = codeEnd(text, i);
		if (isSpan) {
			if (i > from) parts.push({ text: text.slice(from, i), code: false });
			parts.push({ text: text.slice(i, end), code: true });
			from = end;
		}
		i = end;
	}
	if (from < text.length) parts.push({ text: text.slice(from), code: false });
	return parts;
}

/** `text` without each `%%comment%%`. `open` is true when a comment goes on after the line. A `%%` in a code span is text. */
function withoutComments(text: string, open: boolean): { readonly text: string; readonly open: boolean; readonly removed: readonly string[] } {
	const removed: string[] = [];
	let kept = "";
	let inComment = open;
	for (let i = 0; i < text.length; ) {
		if (inComment) {
			const end = text.indexOf("%%", i);
			const comment = text.slice(i, end === -1 ? text.length : end).trim();
			if (comment !== "") removed.push(comment);
			if (end === -1) break;
			inComment = false;
			i = end + 2;
		} else if (text.startsWith("%%", i)) {
			inComment = true;
			i += 2;
		} else {
			const end = text[i] === "`" ? codeEnd(text, i).end : i + 1;
			kept += text.slice(i, end);
			i = end;
		}
	}
	return { text: kept, open: inComment, removed };
}

/** A line of the page. No rule changes or removes a literal line. */
interface OutLine {
	readonly text: string;
	readonly literal: boolean;
}

const isBlank = (line: OutLine | undefined): boolean => line !== undefined && !line.literal && line.text === "";

/** The lines of `body`. The line break at the end of the file starts no line. */
const bodyLines = (body: string): string[] => (body.endsWith("\n") ? body.slice(0, -1) : body).split("\n");

const dequoted = (text: string): string => text.replace(/^(?:>\s?)+/, "");
const quoteDepth = (text: string): number => (/^(?:>\s?)*/.exec(text)?.[0].match(/>/g) ?? []).length;
const unquoted = (text: string, depth: number): string => text.replace(new RegExp(`^(?:>\\s?){0,${depth}}`), "");

interface ScannedLine {
	/** The line without its comments. A literal line is the line of the file. */
	readonly text: string;
	readonly literal: boolean;
	readonly quote: number;
	/** The language of the code block that the line opens, or `null` for each other line. */
	readonly language: string | null;
	/** The text of each comment that the line held. */
	readonly comments: readonly string[];
	/** True for a line that held a comment and no other text. */
	readonly onlyComment: boolean;
}

/**
 * Each line of a body, with the lines of code blocks and of `$$` math blocks
 * marked as literal. A block in a quote or a callout ends with its quote.
 */
function scan(rawLines: readonly string[]): ScannedLine[] {
	let block: { readonly closes: (text: string) => boolean; readonly quote: number } | null = null;
	let inComment = false;
	return rawLines.map((raw): ScannedLine => {
		if (block !== null && quoteDepth(raw) < block.quote) block = null;
		if (block !== null) {
			const { quote } = block;
			if (block.closes(unquoted(raw, quote).trim())) block = null;
			return { text: raw, literal: true, quote, language: null, comments: [], onlyComment: false };
		}
		if (!inComment) {
			const quote = quoteDepth(raw);
			const text = unquoted(raw, quote);
			const [, fence, language = ""] = FENCE.exec(text) ?? [];
			if (fence !== undefined) block = { closes: (line) => line.startsWith(fence) && line.replace(/[`~]/g, "") === "", quote };
			else if (text.trim() === "$$") block = { closes: (line) => line === "$$", quote };
			if (block !== null) return { text: raw, literal: true, quote, language: fence === undefined ? null : language.trim(), comments: [], onlyComment: false };
		}
		const stripped = withoutComments(raw, inComment);
		inComment = stripped.open;
		return { text: stripped.text.trimEnd(), literal: false, quote: 0, language: null, comments: stripped.removed, onlyComment: stripped.text.trim() === "" && (raw.trim() !== "" || stripped.open) };
	});
}

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
	for (const [index, { text, literal, quote, language, comments, onlyComment }] of scan(bodyLines(note.body)).entries()) {
		const no = note.bodyLine + index;
		for (const comment of comments) lose("comment", no, `%%${comment}%%`);
		if (language !== null && storedLanguage(language)?.known === false) lose("code language", no, text.trim());
		if (!onlyComment) lines.push({ no, text, literal, quote });
	}

	const first = lines.findIndex((line) => line.text.trim() !== "");
	if (first !== -1 && !lines[first]?.literal && lines[first]?.text.trim() === `# ${note.title}`) lines.splice(0, first + 1);

	const continuationLines = new Set(hardWrappedParagraphs(note.text));
	const joined: Line[] = [];
	let lastNo = -1;
	let inJoin = false;
	for (const line of lines) {
		const above = joined.at(-1);
		if (continuationLines.has(line.no) && !line.literal && above !== undefined && !above.literal && lastNo === line.no - 1) {
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
		spans(text)
			.map(({ text: part, code }) => {
				if (code) return part;
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

	const out: OutLine[] = [];
	const prose = (text: string): OutLine => ({ text, literal: false });
	for (let i = 0; i < joined.length; i++) {
		const line = joined[i];
		if (line === undefined) continue;
		if (line.literal) {
			out.push({ text: line.text, literal: true });
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
			out.push(prose(inline(text, line.no)));
			continue;
		}
		const [, type = "", fold = "", title = ""] = callout;
		const style = CALLOUT_STYLES.find(([types]) => types.includes(type.toLowerCase()));
		if (style === undefined) lose("callout type", line.no, text);
		if (fold !== "") lose("callout fold", line.no, text);
		const content: OutLine[] = [];
		for (let child = joined[i + 1]; child !== undefined && (child.literal ? child.quote > 0 : child.text.startsWith(">")); child = joined[++i + 1]) {
			content.push(child.literal ? { text: unquoted(child.text, child.quote), literal: true } : prose(inline(dequoted(child.text), child.no)));
		}
		while (isBlank(content[0])) content.shift();
		while (isBlank(content.at(-1))) content.pop();
		const firstLine = title.trim() === "" && content[0]?.literal === false ? content.shift() : undefined;
		const label = firstLine?.text ?? (title.trim() === "" ? `${type.charAt(0).toUpperCase()}${type.slice(1)}` : inline(title.trim(), line.no));
		const [, icon, color] = style ?? ["", ...DEFAULT_CALLOUT_STYLE];
		out.push(prose(`<callout icon="${icon}" color="${color}">`), prose(label), ...(content.length === 0 ? [] : [prose(""), ...content]), prose("</callout>"));
	}

	const kept = out.filter((line, index) => !(isBlank(line) && (index === 0 || isBlank(out[index - 1]))));
	while (isBlank(kept.at(-1))) kept.pop();
	const [head, ...rest] = kept;
	if (head === undefined) return { body: "", losses, links };
	const body = [head.literal ? head.text : head.text.trimStart(), ...rest.map((line) => line.text)].join("\n");
	return { body: `${body}\n`, losses, links };
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
	const lines = bodyLines(note.body);
	const isTopHeading = scan(lines).map((line) => !line.literal && /^##? /.test(line.text));
	const start = lines.findIndex((line, index) => isTopHeading[index] === true && line.trim() === `## ${heading}`);
	if (start === -1) return null;
	const next = isTopHeading.findIndex((top, index) => top && index > start);
	const end = next === -1 ? lines.length : next;
	const outside = lines.findIndex((line, index) => (index < start || index >= end) && line.trim() !== "" && !/^#\s/.test(line));
	const converted = convertBody({ ...note, body: lines.slice(start, end).join("\n"), bodyLine: note.bodyLine + start }, resolve);
	return { ...converted, rest: outside === -1 ? null : { line: note.bodyLine + outside, text: (lines[outside] ?? "").trim() } };
}
