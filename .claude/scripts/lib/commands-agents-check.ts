/**
 * The two checks on the commands and the subagents.
 *
 * The static check proves that no text orders a read of a local vault path, a
 * search tool, the cross-repository server, or the Obsidian CLI. The link
 * check proves that each Notion name in the text exists: each tool in the
 * schema of the server, each top-level argument key of a read call in that
 * schema (a keys check needs a schema, so only the live listing gives it), and
 * each database, property, option, view, scaffold page, and template in
 * `notion-model.ts`.
 *
 * A reference to the model is a backticked token in one of these forms:
 *
 *     `Work.Status`            a property of a database
 *     `Work.Type = Incident`   a property and one option of its select
 *     `Work > Stale Actives`   a saved view of a database
 *     `Page > North Star`      a scaffold page
 *     `Template > Work Note`   a template row
 *
 * Some words of the static patterns are written with a bracket, such as
 * `q[m]d`, so that a text search for the plain word does not find this file.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DATABASES, PAGES, TEMPLATES, type DatabaseSpec } from "./notion-model.ts";
import { NOTION_TOOLS, OUTBOX_DIR, outboxCommand, type NotionTool } from "./notion-write.ts";

export interface SourceFile {
	readonly path: string;
	readonly text: string;
}

export interface Finding {
	readonly group: string;
	readonly file: string;
	readonly line: number;
	readonly text: string;
}

export const COMMANDS_DIR = ".claude/commands";
export const AGENTS_DIR = ".claude/agents";

/** `vault-migrator` moves into the import tool (PR 11), so this port leaves it as it is. */
export const EXEMPT_FILES: readonly string[] = ["vault-migrator.md"];

export interface StaticGroup {
	readonly name: string;
	readonly proves: string;
	readonly pattern: RegExp;
}

export const STATIC_GROUPS: readonly StaticGroup[] = [
	{
		name: "A",
		proves: "local vault paths, index files, manifest, Bases, and ShardMind state",
		pattern:
			/\b(work|org|perf|brain|reference|thinking|memories|templates|bases|daily)\/[A-Za-z0-9_.*<{ -]|(^|[^A-Za-z])(Home|Index|North Star|Brag Doc|People & Context|Memories|Gotchas|Patterns|Key Decisions|Skills)\.md|vault-manifest\.json|\.base\b|\.canvas\b|\.obsidian|\.shardmind/,
	},
	{ name: "B", proves: "wikilinks, embeds, block ids, and Dataview", pattern: /\[\[|!\[\[|\^om-|\^block-id|\bDataview\b|key:: / },
	{ name: "C", proves: "the local search tool", pattern: /\bq[m]d\b|q[m]d-mcp|mcp__q[m]d/i },
	{ name: "D", proves: "the om server and cross-repository memory", pattern: /om-mcp|mcp__o[m]\b|\brecall\b|promoted:|mcp_never_expose|\bom server\b|\bmemories\b/ },
	{ name: "E", proves: "the Obsidian CLI and the Obsidian skills (the name obsidian-mind stays)", pattern: /\bobsidian\b(?!-mind)|obsidian-(cli|markdown)/i },
	{ name: "F", proves: "git commands and the working tree", pattern: /\bgit (mv|log|diff|status|add|commit)\b|--no-merges|working tree/ },
	{ name: "G", proves: "local scripts and ShardMind", pattern: /\.claude\/scripts|charcount\.ts|tidy-fix|generate-memory-index|upgrade-plan|session-start\.ts|\bshardmind\b|MEMORY\.md/i },
	{ name: "H", proves: "other agent products", pattern: /gem[i]ni|cod[e]x|antigravit[y]|\.gem[i]ni/i },
	{ name: "I", proves: "agent skill lines for the local search tool and Obsidian", pattern: /^\s+-\s+(q[m]d|obsidian-[a-z-]+)\s*$/ },
];

export function targetFiles(root: string): SourceFile[] {
	const files: SourceFile[] = [];
	for (const dir of [COMMANDS_DIR, AGENTS_DIR]) {
		for (const name of readdirSync(join(root, dir)).sort()) {
			if (!name.endsWith(".md") || EXEMPT_FILES.includes(name)) continue;
			const path = `${dir}/${name}`;
			files.push({ path, text: readFileSync(join(root, path), "utf8") });
		}
	}
	return files;
}

export function staticFindings(files: readonly SourceFile[]): Finding[] {
	const findings: Finding[] = [];
	for (const file of files) {
		file.text.split("\n").forEach((text, index) => {
			for (const group of STATIC_GROUPS) {
				if (group.pattern.test(text)) findings.push({ group: group.name, file: file.path, line: index + 1, text: text.trim() });
			}
		});
	}
	return findings;
}

const TOOL_PATTERN = /\bnotion-[a-z]+(?:-[a-z]+)*\b(?![\w/-]|\.(?:json|ts|md|mjs)\b)/g;
/** Names that start with `notion-` and are files of this repository, not tools. */
const NOT_TOOLS: readonly string[] = ["notion-map", "notion-mind", "notion-model", "notion-setup"];

export function toolNames(text: string): string[] {
	return (text.match(TOOL_PATTERN) ?? []).filter((name) => !NOT_TOOLS.includes(name));
}

/** The tools of the `notion` server, each with the argument keys of its schema, or `undefined` when the schema is not known. */
export type ToolTable = ReadonlyMap<string, readonly string[] | undefined>;

export function toolTableFromSchema(listing: unknown): ToolTable {
	const tools = (listing as { tools?: unknown }).tools;
	if (!Array.isArray(tools)) throw new Error("The listing of the notion server has no tools array.");
	const table = new Map<string, readonly string[] | undefined>();
	for (const tool of tools as { name: string; inputSchema?: { properties?: Record<string, unknown> } }[]) {
		table.set(tool.name, tool.inputSchema?.properties === undefined ? undefined : Object.keys(tool.inputSchema.properties));
	}
	return table;
}

export interface Problem {
	readonly kind: "tool" | "argument" | "database" | "property" | "option" | "view" | "page" | "template" | "no-notion" | "form";
	readonly file: string;
	readonly line: number;
	readonly name: string;
	readonly detail: string;
}

export interface Reference {
	readonly kind: "property" | "view" | "page" | "template";
	readonly database: string | undefined;
	readonly name: string;
	readonly option: string | undefined;
	readonly line: number;
}

const BACKTICKED = /`([^`\n]+)`/g;
const PROPERTY_REFERENCE = /^([A-Z][A-Za-z ]*[A-Za-z])\.([A-Z][^=`]*?)(?: = (.+))?$/;
const VIEW_REFERENCE = /^([A-Z][A-Za-z ]*[A-Za-z]) > (.+)$/;

export function references(text: string): Reference[] {
	const found: Reference[] = [];
	text.split("\n").forEach((lineText, index) => {
		for (const match of lineText.matchAll(BACKTICKED)) {
			const token = (match[1] ?? "").trim();
			const line = index + 1;
			const view = token.match(VIEW_REFERENCE);
			if (view !== null) {
				const [, owner = "", name = ""] = view;
				if (owner === "Page") found.push({ kind: "page", database: undefined, name, option: undefined, line });
				else if (owner === "Template") found.push({ kind: "template", database: undefined, name, option: undefined, line });
				else found.push({ kind: "view", database: owner, name, option: undefined, line });
				continue;
			}
			const property = token.match(PROPERTY_REFERENCE);
			if (property !== null) found.push({ kind: "property", database: property[1], name: (property[2] ?? "").trim(), option: property[3], line });
		}
	});
	return found;
}

/** The property names of a database: its own, the common ones, the title, and the reverse side of each relation that points at it. */
export function propertyNames(spec: DatabaseSpec, all: readonly DatabaseSpec[] = DATABASES): Set<string> {
	const names = new Set<string>(["Name", ...Object.keys(spec.properties)]);
	for (const other of all) {
		for (const property of Object.values(other.properties)) {
			if (property.type === "relation" && property.target === spec.key && property.reverse !== undefined) names.add(property.reverse);
		}
	}
	return names;
}

export function linkProblems(files: readonly SourceFile[], tools: ToolTable): Problem[] {
	const problems: Problem[] = [];
	const bySpec = new Map(DATABASES.map((spec) => [spec.title, spec]));
	for (const file of files) {
		const lines = file.text.split("\n");
		lines.forEach((text, index) => {
			for (const name of toolNames(text)) {
				if (!tools.has(name)) problems.push({ kind: "tool", file: file.path, line: index + 1, name, detail: "not a tool of the notion server" });
			}
			for (const call of text.matchAll(/mcporter call notion\.(notion-[a-z-]+) --args '(\{.*?\})'(?: --output json)?/g)) {
				const keys = tools.get(call[1] ?? "");
				if (keys === undefined) continue;
				let args: unknown;
				try {
					args = JSON.parse(call[2] ?? "");
				} catch {
					problems.push({ kind: "argument", file: file.path, line: index + 1, name: call[1] ?? "", detail: "the JSON of the call does not parse" });
					continue;
				}
				for (const key of Object.keys(args as object)) {
					if (!keys.includes(key)) problems.push({ kind: "argument", file: file.path, line: index + 1, name: `${call[1]}.${key}`, detail: "not an argument of the tool" });
				}
			}
		});
		for (const ref of references(file.text)) {
			const at = { file: file.path, line: ref.line };
			if (ref.kind === "page") {
				if (!PAGES.some((page) => page.title === ref.name)) problems.push({ ...at, kind: "page", name: ref.name, detail: "not a scaffold page of the model" });
				continue;
			}
			if (ref.kind === "template") {
				if (!TEMPLATES.some((template) => template.title === ref.name)) problems.push({ ...at, kind: "template", name: ref.name, detail: "not a template row of the model" });
				continue;
			}
			const spec = bySpec.get(ref.database ?? "");
			if (spec === undefined) {
				problems.push({ ...at, kind: "database", name: ref.database ?? "", detail: "not a database of the model" });
				continue;
			}
			if (ref.kind === "view") {
				if (!spec.views.some((view) => view.name === ref.name)) problems.push({ ...at, kind: "view", name: `${spec.title} > ${ref.name}`, detail: "not a view of the database" });
				continue;
			}
			if (!propertyNames(spec).has(ref.name)) {
				problems.push({ ...at, kind: "property", name: `${spec.title}.${ref.name}`, detail: "not a property of the database" });
				continue;
			}
			const definition = spec.properties[ref.name];
			if (ref.option !== undefined && definition !== undefined && (definition.type === "select" || definition.type === "multi_select") && definition.options.length > 0) {
				if (!definition.options.includes(ref.option)) problems.push({ ...at, kind: "option", name: `${spec.title}.${ref.name} = ${ref.option}`, detail: `not one of: ${definition.options.join(", ")}` });
			}
		}
	}
	return problems;
}

/** Each file must name at least one tool, and each subagent must have `Bash` in its `tools:` line, the only way to run `mcporter`. */
export function reachProblems(files: readonly SourceFile[]): Problem[] {
	const problems: Problem[] = [];
	for (const file of files) {
		if (toolNames(file.text).length === 0) problems.push({ kind: "no-notion", file: file.path, line: 1, name: file.path, detail: "names no Notion tool" });
		if (file.path.startsWith(`${AGENTS_DIR}/`)) {
			const tools = file.text.split("\n").find((line) => /^tools:/.test(line)) ?? "";
			if (!/\bBash\b/.test(tools)) problems.push({ kind: "no-notion", file: file.path, line: 1, name: file.path, detail: "the tools line has no Bash" });
		}
	}
	return problems;
}

const OUTBOX_FORM = outboxCommand("<tool>", `${OUTBOX_DIR}/<name>.json`);

/** A file that names a write tool must teach the outbox form, the only write that a hooked session can run. */
export function formProblems(files: readonly SourceFile[]): Problem[] {
	const problems: Problem[] = [];
	for (const file of files) {
		const used = toolNames(file.text);
		const writes = used.filter((name) => NOTION_TOOLS[name as NotionTool] === "write");
		if (writes.length > 0 && !file.text.includes(OUTBOX_FORM)) {
			problems.push({ kind: "form", file: file.path, line: 1, name: writes.join(", "), detail: "names a write tool and does not show the outbox form" });
		}
		if (used.includes("notion-create-pages") && !file.text.includes('"allow_async": false')) {
			problems.push({ kind: "form", file: file.path, line: 1, name: "notion-create-pages", detail: 'does not show "allow_async": false' });
		}
	}
	return problems;
}

export interface LiveSchema {
	readonly title: string;
	readonly properties: readonly string[];
	readonly views: readonly string[];
}

/** The same references, checked against the live databases. A reverse relation is in the live schema, so it needs no special case. */
export function liveProblems(files: readonly SourceFile[], live: readonly LiveSchema[]): Problem[] {
	const problems: Problem[] = [];
	const byTitle = new Map(live.map((schema) => [schema.title, schema]));
	for (const file of files) {
		for (const ref of references(file.text)) {
			if (ref.kind !== "property" && ref.kind !== "view") continue;
			const schema = byTitle.get(ref.database ?? "");
			const at = { file: file.path, line: ref.line };
			if (schema === undefined) {
				problems.push({ ...at, kind: "database", name: ref.database ?? "", detail: "not a live database" });
			} else if (ref.kind === "property" && !schema.properties.includes(ref.name)) {
				problems.push({ ...at, kind: "property", name: `${schema.title}.${ref.name}`, detail: "not a live property" });
			} else if (ref.kind === "view" && !schema.views.includes(ref.name)) {
				problems.push({ ...at, kind: "view", name: `${schema.title} > ${ref.name}`, detail: "not a live view" });
			}
		}
	}
	return problems;
}
