/**
 * A Markdown vault of this template as data. The import reads the vault
 * only through this module, and it never writes to the vault.
 *
 *     const vault = readVault("/path/to/vault");
 *     vault.notes[0]
 *     // { path: "work/active/Billing.md", title: "Billing", fields: { status: "active", tags: ["work-note"] },
 *     //   body: "# Billing\n…", bodyLine: 8, text: "---\nstatus: active\n…", changed: 2026-01-05T10:00:00.000Z }
 *     vault.otherFiles    // ["attachments/diagram.png", "bases/Work Dashboard.base"]
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** A frontmatter value. A key with no value is absent, because Notion has no "present but empty" state. */
export type FieldValue = string | readonly string[];

export interface SourceNote {
	/** The path from the vault root, with forward slashes. It is the key of the page in Notion. */
	readonly path: string;
	/** The file name without `.md`. A wikilink names a note by it. */
	readonly title: string;
	readonly fields: Readonly<Record<string, FieldValue>>;
	/** Frontmatter keys that hold a nested map. The import has no property for such a value. */
	readonly nestedKeys: readonly string[];
	/** The text after the frontmatter, with no blank line at its start. */
	readonly body: string;
	/** The 1-based line of the file where `body` starts. */
	readonly bodyLine: number;
	/** The whole file, with `\n` line ends. The derived values count this text. */
	readonly text: string;
	/** The last change of the file. */
	readonly changed: Date;
}

export interface Vault {
	readonly root: string;
	readonly notes: readonly SourceNote[];
	/** Each file that is not a note, as a path from the vault root. */
	readonly otherFiles: readonly string[];
	/** The text of `vault-manifest.json`, or `null`. */
	readonly manifest: string | null;
}

const unquote = (raw: string): string => {
	const text = raw.trim();
	const quote = text[0];
	return text.length >= 2 && (quote === '"' || quote === "'") && text.endsWith(quote) ? text.slice(1, -1) : text;
};

/** The items of `[a, "b, c", d]`. A comma inside quotes does not split. */
function inlineList(raw: string): string[] {
	const items: string[] = [];
	let item = "";
	let quote: string | null = null;
	for (const char of raw.slice(1, -1)) {
		if (quote !== null) {
			if (char === quote) quote = null;
			item += char;
		} else if (char === '"' || char === "'") {
			quote = char;
			item += char;
		} else if (char === ",") {
			items.push(item);
			item = "";
		} else item += char;
	}
	items.push(item);
	return items.map(unquote).filter((value) => value !== "");
}

/**
 * The subset of YAML that the notes of this template use: a scalar, a
 * quoted scalar, an inline list, a block list, and a block scalar. A key
 * with a nested map goes to `nestedKeys`.
 */
export function parseFrontmatter(yaml: string): { fields: Record<string, FieldValue>; nestedKeys: string[] } {
	const fields: Record<string, FieldValue> = {};
	const nestedKeys: string[] = [];
	const lines = yaml.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const entry = /^([A-Za-z0-9_][^:]*?):(?:\s+(.*))?$/.exec(lines[i] ?? "");
		if (entry === null) continue;
		const key = (entry[1] ?? "").trim();
		const rest = (entry[2] ?? "").trim();
		const below: string[] = [];
		while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1] ?? "") || /^-(\s|$)/.test(lines[i + 1] ?? "") || ((lines[i + 1] ?? "").trim() === "" && below.length > 0))) below.push(lines[++i] ?? "");

		if (/^[|>][+-]?$/.test(rest)) {
			const text = below.map((line) => line.trim()).join(rest.startsWith("|") ? "\n" : " ").trim();
			if (text !== "") fields[key] = text;
		} else if (rest.startsWith("[") && rest.endsWith("]")) {
			const items = inlineList(rest);
			if (items.length > 0) fields[key] = items;
		} else if (rest !== "") {
			const value = unquote(rest);
			if (value !== "") fields[key] = value;
		} else {
			const content = below.filter((line) => line.trim() !== "");
			if (content.length === 0) continue;
			if (!content.every((line) => /^\s*-(\s|$)/.test(line))) {
				nestedKeys.push(key);
				continue;
			}
			const items = content.map((line) => unquote(line.replace(/^\s*-\s*/, ""))).filter((value) => value !== "");
			if (items.length > 0) fields[key] = items;
		}
	}
	return { fields, nestedKeys };
}

/** One file of a vault as a note. `path` has forward slashes. */
export function parseNote(path: string, raw: string, changed: Date): SourceNote {
	const text = raw.replace(/\r\n/g, "\n");
	const title = (path.split("/").at(-1) ?? path).replace(/\.md$/i, "");
	const lines = text.split("\n");
	const close = lines[0] === "---" ? lines.indexOf("---", 1) : -1;
	const { fields, nestedKeys } = close === -1 ? { fields: {}, nestedKeys: [] } : parseFrontmatter(lines.slice(1, close).join("\n"));
	let start = close + 1;
	while (start < lines.length && (lines[start] ?? "").trim() === "") start++;
	return { path, title, fields, nestedKeys, body: lines.slice(start).join("\n"), bodyLine: start + 1, text, changed };
}

const SKIPPED_DIRECTORIES: readonly string[] = ["node_modules"];

/** Each file of the vault. A name that starts with a dot is not read, and a symbolic link is not followed. */
export function readVault(root: string): Vault {
	if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`The vault ${root} is not a directory.`);
	const notes: SourceNote[] = [];
	const otherFiles: string[] = [];
	const walk = (folder: string): void => {
		for (const entry of readdirSync(join(root, folder), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
			if (entry.name.startsWith(".") || SKIPPED_DIRECTORIES.includes(entry.name)) continue;
			const path = folder === "" ? entry.name : `${folder}/${entry.name}`;
			if (entry.isDirectory()) walk(path);
			else if (!entry.isFile()) continue;
			else if (/\.md$/i.test(entry.name)) notes.push(parseNote(path, readFileSync(join(root, path), "utf8"), statSync(join(root, path)).mtime));
			else otherFiles.push(path);
		}
	};
	walk("");
	const manifestPath = join(root, "vault-manifest.json");
	return { root, notes, otherFiles, manifest: statSync(manifestPath, { throwIfNoEntry: false })?.isFile() ? readFileSync(manifestPath, "utf8") : null };
}
