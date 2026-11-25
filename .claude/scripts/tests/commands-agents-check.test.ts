/**
 * lib/commands-agents-check.ts: each static group finds the text that it
 * names and nothing else, each link problem is reported, and the commands
 * and the subagents of this repository pass both checks.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	EXEMPT_FILES,
	formProblems,
	linkProblems,
	liveProblems,
	propertyNames,
	reachProblems,
	references,
	staticFindings,
	targetFiles,
	toolNames,
	toolTableFromSchema,
	type SourceFile,
	type ToolTable,
} from "../lib/commands-agents-check.ts";
import { DATABASES } from "../lib/notion-model.ts";
import { NOTION_TOOLS } from "../lib/notion-write.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const file = (text: string, path = ".claude/commands/om-sample.md"): SourceFile => ({ path, text });
const groupsOf = (text: string): string[] => staticFindings([file(text)]).map((f) => f.group);

const SEARCH_TOOL = "q" + "md";
const OTHER_PRODUCT = "gem" + "ini";
const MEMORY_SERVER = "mcp__" + "om";

const tools: ToolTable = new Map([
	["notion-fetch", ["id"]],
	["notion-search", ["query", "query_type", "data_source_url"]],
	["notion-query-data-sources", ["data", "skill"]],
]);

describe("static groups", () => {
	const samples: [string, string][] = [
		["A", "Read work/active/Plan.md first."],
		["A", "Open Home.md."],
		["A", "Read vault-manifest.json."],
		["B", "Link to [[Some Note]]."],
		["C", `Run ${SEARCH_TOOL} query.`],
		["C", `Call mcp__${SEARCH_TOOL}__query.`],
		["D", `Call ${MEMORY_SERVER}.`],
		["D", "Write a note to memories."],
		["E", "Use the Obsidian CLI."],
		["E", "Load the obsidian-markdown skill."],
		["F", "Run git mv on the note."],
		["F", "Check the working tree."],
		["G", "Run .claude/scripts/tidy.ts."],
		["H", `Read the ${OTHER_PRODUCT} transcripts.`],
		["I", "  - obsidian-markdown"],
		["I", `  - ${SEARCH_TOOL}`],
		["A", "Read ~/notes/Plan first."],
		["A", "Open `~/vault`."],
		["D", `Call ${MEMORY_SERVER}_remember.`],
		["F", "Run git  mv on the note."],
		["F", "Run git\tmv on the note."],
		["F", "Run git -C vault mv a b."],
		["F", "Run git -C /x -c a=b log."],
	];
	for (const [group, text] of samples) {
		test(`group ${group} finds: ${text}`, () => assert.ok(groupsOf(text).includes(group), groupsOf(text).join(",")));
	}

	test("group J finds an absolute path inside a code fence and nowhere else", () => {
		assert.deepEqual(groupsOf("```sh\ncat /Users/someone/notes.md\n```"), ["J"]);
		assert.deepEqual(groupsOf("~~~\nls /tmp/out\n~~~"), ["J"]);
		assert.deepEqual(groupsOf("Prose names /usr/local/bin outside a fence."), []);
		assert.deepEqual(groupsOf("```\nok\n```\ncat /usr/local/bin"), []);
	});

	test("a code fence without an absolute path has no hit", () => {
		assert.deepEqual(groupsOf("```sh\nmcporter call notion.notion-fetch --args '{\"id\":\"a/b\"}' --output json\n```"), []);
	});

	test("the name obsidian-mind is allowed", () => {
		assert.deepEqual(groupsOf("The root page is named obsidian-mind."), []);
	});

	test("Notion text with databases, views, and tools has no hit", () => {
		assert.deepEqual(groupsOf("Query `Work > Active Work` with notion-query-data-sources, then set `Work.Status` to archived."), []);
	});

	test("a finding names the group, the file, and the line", () => {
		const [found] = staticFindings([file("clean\nRun git mv now.", ".claude/agents/x.md")]);
		assert.deepEqual(found, { group: "F", file: ".claude/agents/x.md", line: 2, text: "Run git mv now." });
	});
});

describe("target files", () => {
	test("the exempt files are left out and other markdown files are read", () => {
		const root = mkdtempSync(join(tmpdir(), "check-targets-"));
		try {
			for (const dir of [".claude/commands", ".claude/agents"]) mkdirSync(join(root, dir), { recursive: true });
			writeFileSync(join(root, ".claude/commands/om-a.md"), "a");
			writeFileSync(join(root, ".claude/agents/helper.md"), "b");
			writeFileSync(join(root, ".claude/agents/notes.txt"), "c");
			for (const name of EXEMPT_FILES) writeFileSync(join(root, ".claude/agents", name), "d");
			assert.deepEqual(
				targetFiles(root).map((f) => f.path),
				[".claude/commands/om-a.md", ".claude/agents/helper.md"],
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("tool names", () => {
	test("a tool name is found and the names of repository files are not", () => {
		assert.deepEqual(toolNames("Use notion-fetch and notion-query-data-sources. Read notion-map.json and notion-model.ts."), ["notion-fetch", "notion-query-data-sources"]);
	});

	test("the schema listing gives the argument keys of each tool", () => {
		const table = toolTableFromSchema({ tools: [{ name: "notion-fetch", inputSchema: { properties: { id: {} } } }, { name: "bare" }] });
		assert.deepEqual(table.get("notion-fetch"), ["id"]);
		assert.equal(table.has("bare"), true);
		assert.equal(table.get("bare"), undefined);
	});
});

describe("references", () => {
	test("each form is found", () => {
		const found = references("`Work.Status`, `Work.Type = Work note`, `Work > Stale Actives`, `Page > North Star`, `Template > Work Note`, `notion-map.json`");
		assert.deepEqual(
			found.map((r) => [r.kind, r.database, r.name, r.option]),
			[
				["property", "Work", "Status", undefined],
				["property", "Work", "Type", "Work note"],
				["view", "Work", "Stale Actives", undefined],
				["page", undefined, "North Star", undefined],
				["template", undefined, "Work Note", undefined],
			],
		);
	});
});

describe("link problems", () => {
	const kinds = (text: string): string[] => linkProblems([file(text)], tools).map((p) => `${p.kind}:${p.name}`);

	test("a known tool, property, option, view, page, and template give no problem", () => {
		assert.deepEqual(kinds("notion-fetch `Work.Type = Incident` `Work > Stale Actives` `Page > Home` `Template > Decision Record` `Perf docs.Person`"), []);
	});

	test("a tool that the server does not have is reported", () => {
		assert.deepEqual(kinds("Call notion-fetches."), ["tool:notion-fetches"]);
	});

	test("an argument key that the schema does not have is reported", () => {
		assert.deepEqual(kinds(`Run mcporter call notion.notion-fetch --args '{"page_id":"x"}' --output json`), ["argument:notion-fetch.page_id"]);
	});

	test("a read call with known keys gives no problem", () => {
		assert.deepEqual(kinds(`Run mcporter call notion.notion-search --args '{"query":"a","query_type":"internal"}' --output json`), []);
	});

	test("an unknown database, property, option, view, page, and template are reported", () => {
		assert.deepEqual(kinds("`Wrok.Status` `Work.Statuz` `Work.Type = Meeting` `Work > Nope` `Page > Nope` `Template > Nope`"), [
			"database:Wrok",
			"property:Work.Statuz",
			"option:Work.Type = Meeting",
			"view:Work > Nope",
			"page:Nope",
			"template:Nope",
		]);
	});

	test("the reverse side of a relation is a property of its target", () => {
		const work = DATABASES.find((d) => d.key === "work");
		const competencies = DATABASES.find((d) => d.key === "competencies");
		assert.ok(work !== undefined && competencies !== undefined);
		assert.ok(propertyNames(work).has("Decision of"));
		assert.ok(propertyNames(competencies).has("Evidence"));
	});

	test("a lowercase property or database name is reported", () => {
		assert.deepEqual(kinds("`Work.status` `work.Status` `Perf docs.quarter`"), ["property:Work.status", "database:work", "property:Perf docs.quarter"]);
	});

	test("a file name or a command in backticks is not a reference", () => {
		assert.deepEqual(kinds("`Home.md` `notion-map.json` `mcporter call notion.notion-fetch --args '{}'`"), []);
	});

	test("an empty option list accepts any value", () => {
		assert.deepEqual(kinds("`Work.Quarter = Q1-2026`"), []);
	});
});

describe("reach problems", () => {
	test("a file with no Notion tool and an agent with no Bash are reported", () => {
		const problems = reachProblems([file("Nothing here."), file("---\ntools: Read, Grep\n---\nnotion-fetch", ".claude/agents/a.md")]);
		assert.deepEqual(
			problems.map((p) => p.detail),
			["names no Notion tool", "the tools line has no Bash"],
		);
	});
});

describe("live problems", () => {
	test("a property or a view that the live database lacks is reported", () => {
		const live = [{ title: "Work", properties: ["Status"], views: ["Active Work"] }];
		const problems = liveProblems([file("`Work.Status` `Work.Nope` `Work > Active Work` `Work > Gone` `People.Role`")], live);
		assert.deepEqual(
			problems.map((p) => `${p.kind}:${p.name}`),
			["property:Work.Nope", "view:Work > Gone", "database:People"],
		);
	});
});

describe("form problems", () => {
	const outbox = 'Write the file, then run `mcporter call notion.<tool> --args "$(cat .claude/state/outbox/<name>.json)"`.';

	test("a write tool without the outbox form is reported", () => {
		assert.deepEqual(
			formProblems([file("Use notion-update-page to change the row.")]).map((p) => p.detail),
			["names a write tool and does not show the outbox form"],
		);
	});

	test("a write tool with inline --args is reported, also in a file that shows the outbox form", () => {
		const inline = (call: string): string[] => formProblems([file(`${outbox}\n${call}`)]).map((p) => `${p.line}:${p.name}:${p.detail}`);
		const detail = "a write tool with inline --args, which the guard denies";
		assert.deepEqual(inline("mcporter call notion.notion-update-page --args '{\"page_id\":\"x\"}'"), [`2:notion-update-page:${detail}`]);
		assert.deepEqual(inline("mcporter  call  notion.notion-update-page   --args={}"), [`2:notion-update-page:${detail}`]);
		assert.deepEqual(inline("mcporter call notion.notion-update-page --args \"$(cat other.json)\""), [`2:notion-update-page:${detail}`]);
	});

	test("the outbox form and an inline read are not reported", () => {
		assert.deepEqual(formProblems([file(`${outbox}\nmcporter call notion.notion-update-page --args "$(cat .claude/state/outbox/x.json)"\nmcporter call notion.notion-fetch --args '{"id":"x"}' --output json`)]), []);
	});

	test("a read tool needs no outbox form", () => {
		assert.deepEqual(formProblems([file("Use notion-fetch and notion-search.")]), []);
	});

	test("notion-create-pages needs allow_async false", () => {
		assert.deepEqual(
			formProblems([file(`Use notion-create-pages. ${outbox}`)]).map((p) => p.detail),
			['does not show "allow_async": false'],
		);
		assert.deepEqual(formProblems([file(`Use notion-create-pages with "allow_async": false. ${outbox}`)]), []);
	});
});

describe("this repository", () => {
	const files = targetFiles(repoRoot);
	const offline: ToolTable = new Map(Object.keys(NOTION_TOOLS).map((name) => [name, undefined]));

	test("the commands and the subagents are found", () => {
		assert.equal(files.filter((f) => f.path.startsWith(".claude/commands/")).length, 19);
		assert.equal(files.filter((f) => f.path.startsWith(".claude/agents/")).length, 9);
	});

	test("the static check has no hit", () => {
		assert.deepEqual(staticFindings(files), []);
	});

	test("each Notion name resolves", () => {
		assert.deepEqual(linkProblems(files, offline), []);
	});

	test("each file names a Notion tool, each subagent can run Bash, and each write uses the outbox form", () => {
		assert.deepEqual([...reachProblems(files), ...formProblems(files)], []);
	});
});
