/**
 * The plan of notion-import.ts, with no Notion call: how a vault file is
 * read, where each note goes, how each construct of part a.5 of the design
 * record converts, and which values each row gets. `import-run.test.ts`
 * covers the writes.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { convertBody, convertSection, type Resolution } from "../lib/import-body.ts";
import { destinationOf, satelliteOf } from "../lib/import-place.ts";
import { placeholderRefs, placeVault, planImport, SOURCE_PATH_PROPERTY, type ImportPlan, type PlannedPage } from "../lib/import-plan.ts";
import { lossReport, planReport } from "../lib/import-report.ts";
import { parseFrontmatter, parseNote, readVault, type Vault } from "../lib/import-source.ts";
import { A5_BODY } from "../parity/import-vaults.ts";
import { rmTemp } from "./_helpers.ts";

const CHANGED = new Date("2026-01-05T10:00:30.000Z");
const MANIFEST = JSON.stringify({ open_loop_sections: ["action items"] });

const vaultOf = (files: Readonly<Record<string, string>>, otherFiles: readonly string[] = []): Vault => ({
	root: "/vault",
	notes: Object.entries(files).map(([path, raw]) => parseNote(path, raw, CHANGED)),
	otherFiles,
	manifest: MANIFEST,
});
const planOf = (vault: Vault): ImportPlan => {
	const places = placeVault(vault);
	return planImport(vault, places, placeholderRefs(places));
};
const pageOf = (plan: ImportPlan, path: string): PlannedPage => plan.pages.find((page) => page.note.path === path) ?? assert.fail(`no page for ${path}`);
const urlOf = (path: string): string => `dry-run://${encodeURI(path)}`;
const idOf = (path: string): string => `dry-run:${path}`;
const note = (fields: string, body: string): string => `---\n${fields}\n---\n\n${body}`;


const pageTarget = (title: string): Resolution => ({ kind: "page", target: { path: `${title}.md`, title, url: `https://app.notion.com/p/${title.replace(/\W/g, "")}` } });
const mention = (title: string): string => `<mention url="https://app.notion.com/p/${title.replace(/\W/g, "")}">${title}</mention>`;
const resolveAll = (name: string): Resolution => pageTarget(name);

describe("convertBody: the constructs of part a.5", () => {
	const source = parseNote("work/active/Construct Fixture.md", note("tags: [work-note]", A5_BODY), CHANGED);
	const { body, losses, links } = convertBody(source, resolveAll);
	const kinds = losses.map((loss) => loss.kind);

	test("the body is the measured Notion form of each construct", () => {
		assert.equal(
			body,
			[
				"## Context",
				"",
				`This note links to ${mention("North Star")}, to ${mention("Key Decisions")}, and to ${mention("Patterns")}. It also links to a block with ${mention("Gotchas")}.`,
				"",
				"A paragraph line that the hygiene check calls hard-wrapped continues on the next line and on one more line.",
				"",
				'<callout icon="⚠️" color="yellow_bg">',
				"Footgun",
				"",
				"A callout with **bold** and `code`.",
				"</callout>",
				"",
				"## What",
				"",
				"- [ ] An open task",
				"- [x] A closed task",
				"- A bullet with a tag #inline-tag",
				'- A <span color="yellow_bg">highlight</span> and a',
				"",
				"| Column A | Column B |",
				"| --- | --- |",
				"| one | two |",
				"",
				"```ts",
				"const x: number = 1;",
				"```",
				"",
				"```mermaid",
				"graph TD; A-->B;",
				"```",
				"",
				"A line with a block id.",
				"",
				mention("Patterns"),
				"",
				"## Related",
				"",
				`- ${mention("Index")}`,
				`- ${mention("Platform")}`,
				"",
			].join("\n"),
		);
	});

	test("each construct that loses form is in the losses, with its line in the file", () => {
		assert.deepEqual(kinds.sort(), ["block ID", "block anchor", "comment", "embed", "hard wrap", "hard wrap", "heading anchor", "inline tag", "link alias"].sort());
		const lines = (kind: string): number[] => losses.filter((loss) => loss.kind === kind).map((loss) => loss.line);
		assert.deepEqual(lines("link alias"), [9], "the frontmatter has 3 lines and a blank line above the body");
		assert.deepEqual(lines("hard wrap"), [9, 12], "two paragraphs, each at its first line");
		assert.deepEqual(lines("block ID"), [38]);
		assert.equal(losses.find((loss) => loss.kind === "comment")?.example, "%%hidden comment%%");
	});

	test("each link to a page is a link of the body, with the heading above it", () => {
		assert.deepEqual(
			links.map((link) => `${link.target.title} @ ${link.section}`),
			["North Star @ Context", "Key Decisions @ Context", "Patterns @ Context", "Gotchas @ Context", "Patterns @ What", "Index @ Related", "Platform @ Related"],
		);
	});
});

describe("convertBody: edge cases", () => {
	const convert = (body: string, fields = "tags: [reference]", resolve: (name: string) => Resolution = resolveAll) => convertBody(parseNote("reference/Note.md", note(fields, body), CHANGED), resolve);

	test("a link in a code span or a code block stays as it is", () => {
		const { body, losses } = convert("Use `[[Note]]` here.\n\n```\n[[Other]] ==x==\n```\n");
		assert.equal(body, "Use `[[Note]]` here.\n\n```txt\n[[Other]] ==x==\n```\n");
		assert.deepEqual(losses, []);
	});

	test("a code block keeps each blank line, and a gap between two paragraphs becomes one blank line (measured)", () => {
		const code = "```js\nconst value = `first\n\n\nlast`;\nvalue;\n```\n";
		const { body, losses } = convert(`Above\n\n\n\nBelow\n\n${code}`);
		assert.equal(body, `Above\n\nBelow\n\n${code}`);
		assert.deepEqual(losses, []);
	});

	test("a code span stays as it is, and a %% in it starts no comment", () => {
		const { body, losses } = convert("Use `a  %%b%% ==c== [[d]]` and ``e ` [[f]]`` here.\n\nPrint `100%%` now.\n\nThen see [[Note]].\n");
		assert.equal(body, `Use \`a  %%b%% ==c== [[d]]\` and \`\`e \` [[f]]\`\` here.\n\nPrint \`100%%\` now.\n\nThen see ${mention("Note")}.\n`);
		assert.deepEqual(losses, []);
	});

	test("a math block stays as it is", () => {
		const math = "$$\nx ^2\n\n\n\n[[a]] ==b== %%c%%\n$$\n";
		const { body, losses } = convert(`Before\n\n${math}`);
		assert.equal(body, `Before\n\n${math}`);
		assert.deepEqual(losses, []);
	});

	test("a code block in a callout or in a quote stays as it is", () => {
		const { body, losses } = convert("> [!note] Title\n> ```js\n> const a = `[[Note]]\n>\n>\n>\n> ==b==`; %%c%%\n> ```\n\n> Quote\n>\n> ```\n> [[Note]] ^id\n> ```\n");
		assert.equal(body, '<callout icon="📝" color="blue_bg">\nTitle\n\n```js\nconst a = `[[Note]]\n\n\n\n==b==`; %%c%%\n```\n</callout>\n\n> Quote\n>\n> ```txt\n> [[Note]] ^id\n> ```\n');
		assert.deepEqual(losses, []);
	});

	test("a code block with no language is sent as txt and is no loss, and a language that Notion does not know is a loss (measured: Notion stores both as javascript)", () => {
		const { body, losses } = convert("```\na\n```\n\n> ```\n> b\n> ```\n\n~~~\nc\n~~~\n\n```dataview\nd\n```\n\n```JS\ne\n```\n\n```zig\nf\n```\n");
		assert.equal(body, "```txt\na\n```\n\n> ```txt\n> b\n> ```\n\n~~~txt\nc\n~~~\n\n```dataview\nd\n```\n\n```JS\ne\n```\n\n```zig\nf\n```\n");
		assert.deepEqual(losses.map((loss) => `${loss.kind} ${loss.line}: ${loss.example}`), ["code language 17: ```dataview"]);
	});

	test("a verbatim note keeps each line break", () => {
		const { body, losses } = convert("Line one\nline two\nline three\n", "verbatim: true");
		assert.equal(body, "Line one\nline two\nline three\n");
		assert.deepEqual(losses, []);
	});

	test("a link that names no note, a file, or a note that the import leaves out stays as text", () => {
		const resolve = (name: string): Resolution => (name === "INFRA-1" ? { kind: "none" } : name === "diagram.png" ? { kind: "file" } : { kind: "left out" });
		const { body, losses } = convert("See [[INFRA-1]], ![[diagram.png]], and [[Skills]].\n", undefined, resolve);
		assert.equal(body, "See [[INFRA-1]], ![[diagram.png]], and [[Skills]].\n");
		assert.deepEqual(losses.map((loss) => loss.kind), ["unresolved link", "attachment", "left-out link"]);
	});

	test("a callout of an unknown type gets the default icon, a folded callout opens, and a callout with no title takes its first line", () => {
		const { body, losses } = convert("> [!custom]- \n> First line\n>\n> Second line\n");
		assert.equal(body, '<callout icon="💡" color="gray_bg">\nFirst line\n\nSecond line\n</callout>\n');
		assert.deepEqual(losses.map((loss) => loss.kind), ["callout type", "callout fold"]);
	});

	test("a comment over more than one line goes, and a link to a local Markdown path is a loss", () => {
		const { body, losses } = convert("Keep\n%%\nhidden\n%%\n[guide](docs/guide.md) and [site](https://example.com)\n");
		assert.equal(body, "Keep\n[guide](docs/guide.md) and [site](https://example.com)\n");
		assert.deepEqual(losses.map((loss) => loss.kind), ["comment", "local link"]);
	});

	test("a link to a heading of the same note is its text", () => {
		const { body, losses } = convert("See [[#Plan]].\n");
		assert.equal(body, "See Plan.\n");
		assert.deepEqual(losses.map((loss) => loss.kind), ["heading anchor"]);
	});
});

describe("convertSection", () => {
	const memories = parseNote(
		"brain/Memories.md",
		note("tags: [brain]", "# Memories\n\n- [[Patterns]]\n\n```\n## Recent Context\n```\n\n## Recent Context\n\n- Moved to [[Patterns]]\n\n## Later\n\nOther text\n"),
		CHANGED,
	);

	test("gives the section with its heading, and the first line of text outside it", () => {
		const section = convertSection(memories, "Recent Context", resolveAll);
		assert.equal(section?.body, `## Recent Context\n\n- Moved to ${mention("Patterns")}\n`);
		assert.deepEqual(section?.rest, { line: 7, text: "- [[Patterns]]" });
		assert.deepEqual(section?.links.map((link) => link.target.title), ["Patterns"]);
	});

	test("a heading in a code block is not the section, and a note without the section gives null", () => {
		assert.equal(convertSection(memories, "Missing", resolveAll), null);
		assert.equal(convertSection(parseNote("x.md", "```\n## Recent Context\n```\n", CHANGED), "Recent Context", resolveAll), null);
	});

	test("a line of a code block that starts with the fence and has more text does not end the block", () => {
		const code = "```\n``` not the end\n## Later\n```\n";
		const section = convertSection(parseNote("x.md", `## Recent Context\n\n${code}\nKept\n\n## Later\n\nOther text\n`, CHANGED), "Recent Context", resolveAll);
		assert.equal(section?.body, `## Recent Context\n\n${code.replace("```\n", "```txt\n")}\nKept\n`);
	});
});

describe("parseFrontmatter and readVault", () => {
	test("reads the YAML forms of the template, and leaves out an empty key", () => {
		const yaml = ['date: "2026-01-05"', "description:", "tags:", "  - work-note", "  - perf", "aliases: [Goals, \"A, B\"]", "summary: |", "  one", "  two", "owner:", "  name: Ada"].join("\n");
		assert.deepEqual(parseFrontmatter(yaml), {
			fields: { date: "2026-01-05", tags: ["work-note", "perf"], aliases: ["Goals", "A, B"], summary: "one\ntwo" },
			nestedKeys: ["owner"],
		});
	});

	test("a note gives its title from the file name, and the body starts after the frontmatter", () => {
		const parsed = parseNote("work/active/Billing.md", "---\r\nstatus: active\r\n---\r\n\r\n# Billing\r\n", CHANGED);
		assert.deepEqual([parsed.title, parsed.body, parsed.bodyLine, parsed.fields], ["Billing", "# Billing\n", 5, { status: "active" }]);
	});

	test("reads each file once, skips a dot folder and a symbolic link, and keeps other files apart", () => {
		const root = mkdtempSync(join(tmpdir(), "import-vault-"));
		try {
			mkdirSync(join(root, ".obsidian"));
			mkdirSync(join(root, "work", "active"), { recursive: true });
			writeFileSync(join(root, ".obsidian", "app.json"), "{}");
			writeFileSync(join(root, "work", "active", "A.md"), "# A\n");
			writeFileSync(join(root, "diagram.png"), "");
			writeFileSync(join(root, "vault-manifest.json"), MANIFEST);
			symlinkSync(join(root, "work"), join(root, "link"));
			const vault = readVault(root);
			assert.deepEqual(vault.notes.map((n) => n.path), ["work/active/A.md"]);
			assert.deepEqual(vault.otherFiles, ["diagram.png", "vault-manifest.json"]);
			assert.equal(vault.manifest, MANIFEST);
		} finally {
			rmTemp(root);
		}
	});
});

describe("destinationOf", () => {
	const place = (path: string, fields: Record<string, string | string[]> = {}) => {
		const destination = destinationOf({ path, title: (path.split("/").at(-1) ?? "").replace(/\.md$/, ""), fields });
		if (destination.kind !== "row") return destination;
		return { database: destination.database, type: destination.type, defaults: destination.defaults, ...(destination.adopts === undefined ? {} : { adopts: destination.adopts }), ...(destination.byDefault ? { byDefault: true } : {}) };
	};

	test("the folder gives the database, the type, and the fields of part c.1", () => {
		const table: [string, unknown][] = [
			["work/active/A.md", { database: "work", type: "Work note", defaults: { status: "active" } }],
			["work/active/Billing/A.md", { database: "work", type: "Work note", defaults: { status: "active", project: "Billing" } }],
			["work/archive/2025/Billing/A.md", { database: "work", type: "Work note", defaults: { status: "completed", project: "Billing" } }],
			["work/incidents/A.md", { database: "work", type: "Incident", defaults: {} }],
			["work/1-1/Ada 2026-01-10.md", { database: "work", type: "1:1", defaults: {} }],
			["work/meetings/Standup.md", { database: "work", type: "Inbox item", defaults: {} }],
			["thinking/Draft.md", { database: "work", type: "Thinking", defaults: {} }],
			["org/people/Ada Park.md", { database: "people", type: null, defaults: {} }],
			["org/teams/Platform.md", { database: "teams", type: null, defaults: {} }],
			["perf/competencies/Ownership.md", { database: "competencies", type: null, defaults: {} }],
			["perf/evidence/Ada PRs - H1.md", { database: "perf_docs", type: "PR evidence", defaults: {} }],
			["perf/brag/Q1 2026.md", { database: "perf_docs", type: "Brag quarter", defaults: {} }],
			["perf/h1-2026/H1 Review Brief.md", { database: "perf_docs", type: "Review brief", defaults: { cycle: "h1-2026" } }],
			["perf/h1-2026/Peer Notes.md", { database: "perf_docs", type: "Review artifact", defaults: { cycle: "h1-2026" } }],
			["brain/Ideas.md", { database: "knowledge", type: "Brain topic", defaults: {} }],
			["reference/Flows.md", { database: "knowledge", type: "Reference", defaults: {} }],
			["notes/Loose.md", { database: "knowledge", type: "Reference", defaults: {}, byDefault: true }],
		];
		for (const [path, expected] of table) assert.deepEqual(place(path), expected, path);
		assert.deepEqual(place("work/active/Use Postgres.md", { tags: ["decision"] }), { database: "work", type: "Decision", defaults: { status: "active" } });
	});

	test("a file of the setup goes to its page, its row, or one section of a page", () => {
		assert.deepEqual(place("brain/North Star.md"), { kind: "page", page: "north_star" });
		assert.deepEqual(place("org/People & Context.md"), { kind: "page", page: "people_and_context" });
		assert.deepEqual(place("brain/Patterns.md"), { database: "knowledge", type: "Brain topic", defaults: {}, adopts: "patterns" });
		assert.deepEqual(place("work/Index.md"), { kind: "section", page: "home", section: "Open Questions", rest: "The views of the Work database replace it." });
		assert.equal((place("brain/Memories.md") as { section: string }).section, "Recent Context");
	});

	test("a file with a different form in Notion stays out with a reason", () => {
		for (const path of ["Home.md", "perf/Brag Doc.md", "brain/Skills.md", "templates/Work Note.md", "bases/Work.base", "AGENTS.md", "README.ja.md"]) {
			assert.equal(destinationOf({ path, title: "x", fields: {} }).kind, "skip", path);
		}
	});

	test("satelliteOf names the core note of an archive note, an event log, and a domain note", () => {
		assert.deepEqual(satelliteOf("Runbook Archive"), { type: "Archive note", core: "Runbook", byNameAlone: true });
		assert.deepEqual(satelliteOf("Ada Park — Promotion Log"), { type: "Event-log satellite", core: "Ada Park", byNameAlone: true });
		assert.deepEqual(satelliteOf("Gotchas - Tooling"), { type: "Domain note", core: "Gotchas", byNameAlone: false });
		assert.equal(satelliteOf("Runbook"), null);
	});
});

describe("planImport", () => {
	const VAULT = {
		"work/active/Billing/Retry Rules.md": note(
			["date: 2026-01-05", "description: How retries work", "quarter: Q1-2026", "tags:", "  - work-note", "team: Platform", "update: soon"].join("\n"),
			"# Retry Rules\n\nSee [[Use Postgres]], [[Export]], [[Ada Park]], [[Ownership]], and [[Patterns]].\n\n## Action Items\n\n- [ ] Ship it\n- [ ] Tell [[Ada Park]]\n",
		),
		"work/active/Billing/Export.md": note("tags: [work-note]\nverbatim: true", "Line one\nline two\n"),
		"work/active/Use Postgres.md": note("tags: [decision]\nstatus: accepted\ndate: 2026-02-01T09:30", "The decision.\n"),
		"thinking/Draft.md": note("tags: [thinking]", "## Feeds into\n\n- [[Use Postgres]]\n\n## Other\n\n- [[Export]]\n"),
		"org/people/Ada Park.md": note("title: Staff Engineer\nteam: \"[[Platform]]\"", "# Ada Park\n"),
		"org/teams/Platform.md": note("tags: [team]", "Members.\n"),
		"perf/competencies/Ownership.md": note("current-level: L5\nbad-level: x", "Definition.\n"),
		"perf/evidence/Ada PRs - H1.md": note("person: Ada Park\nperiod: H1", "- [[Retry Rules]]\n"),
		"reference/Runbook.md": note("tags: [reference]", "Steps.\n"),
		"reference/Runbook Archive.md": note("tags: [reference]", "Old steps.\n"),
		"brain/North Star.md": note("tags: [brain]", "# North Star\n\n## Current Focus\n\n- Ship [[Retry Rules]]\n"),
		"brain/Memories.md": note("tags: [brain]", "# Memories\n\n- [[Patterns]]\n\n## Recent Context\n\n- See [[Index]]\n"),
		"brain/Patterns.md": note("tags: [brain]", "- One pattern\n"),
		"work/Index.md": note("tags: [index]", "# Work Notes\n\n## Open Questions\n\n- Why [[Home]]?\n- See [[Work Note]]\n"),
		"Home.md": "# Home\n",
		"templates/Work Note.md": "# {{title}}\n",
	};
	const plan = planOf(vaultOf(VAULT, ["attachments/a.png"]));
	const values = (path: string) => pageOf(plan, path).values;

	test("frontmatter fields become properties, and a key with no property is a loss", () => {
		const retry = values("work/active/Billing/Retry Rules.md");
		assert.equal(retry["Type"], "Work note");
		assert.equal(retry["Status"], "active");
		assert.equal(retry["Project"], "Billing");
		assert.equal(retry["Quarter"], "Q1-2026");
		assert.equal(retry["Date"], "2026-01-05");
		assert.equal(retry["Description"], "How retries work");
		assert.deepEqual(retry["Tags"], ["work-note"]);
		assert.equal(retry[SOURCE_PATH_PROPERTY], "work/active/Billing/Retry Rules.md");
		assert.equal(retry["Ticket"], null, "a property that the note does not set is empty");
		assert.equal(values("work/active/Use Postgres.md")["Date"], "2026-02-01T09:30");
		assert.equal(values("work/active/Use Postgres.md")["Status"], "accepted", "a frontmatter field wins over the folder");
		assert.equal(values("org/people/Ada Park.md")["Role"], "Staff Engineer");
		assert.equal(values("perf/competencies/Ownership.md")["Current level"], "L5");
		assert.equal(values("perf/evidence/Ada PRs - H1.md")["Period"], "H1");
		const keys = pageOf(plan, "work/active/Billing/Retry Rules.md").losses.filter((loss) => loss.kind === "frontmatter key").map((loss) => loss.example);
		assert.deepEqual(keys, ["update: soon"]);
	});

	test("a relation field and the links of the body fill the relations of part c.3", () => {
		const retry = values("work/active/Billing/Retry Rules.md");
		assert.deepEqual(retry["Team"], [idOf("org/teams/Platform.md")]);
		assert.deepEqual(retry["Decisions"], [idOf("work/active/Use Postgres.md")]);
		assert.deepEqual(retry["Related"], [idOf("work/active/Billing/Export.md")]);
		assert.deepEqual(retry["Person"], [idOf("org/people/Ada Park.md")]);
		assert.deepEqual(retry["Competencies"], [idOf("perf/competencies/Ownership.md")]);
		const draft = values("thinking/Draft.md");
		assert.deepEqual(draft["Feeds into"], [idOf("work/active/Use Postgres.md")]);
		assert.deepEqual(draft["Related"], [idOf("work/active/Billing/Export.md")], "a link under another heading is a Related link");
		assert.deepEqual(values("org/people/Ada Park.md")["Team"], [idOf("org/teams/Platform.md")]);
		assert.deepEqual(values("perf/evidence/Ada PRs - H1.md")["Person"], [idOf("org/people/Ada Park.md")]);
		assert.deepEqual(values("perf/evidence/Ada PRs - H1.md")["Work evidence"], [idOf("work/active/Billing/Retry Rules.md")]);
		assert.deepEqual(values("reference/Runbook Archive.md")["Parent"], [idOf("reference/Runbook.md")]);
		assert.equal(values("reference/Runbook Archive.md")["Type"], "Archive note");
	});

	test("the derived values come from the file text and its time, and the Verbatim mark from the key", () => {
		const retry = values("work/active/Billing/Retry Rules.md");
		assert.equal(retry["Open tasks"], 2);
		assert.equal(retry["Open loops"], 2);
		assert.equal(retry["Bytes"], Buffer.byteLength(VAULT["work/active/Billing/Retry Rules.md"]));
		assert.equal(retry["Changed"], "2026-01-05T10:00");
		assert.equal(retry["Verbatim"], false);
		assert.equal(values("work/active/Billing/Export.md")["Verbatim"], true);
		assert.equal(pageOf(plan, "work/active/Billing/Export.md").body, "Line one\nline two\n");
		assert.equal(values("reference/Runbook.md")["Has content"], false);
		assert.equal(values("brain/Patterns.md")["Has content"], true);
	});

	test("the North Star page takes the Recent Context section of Memories, and Memories stays out", () => {
		const northStar = pageOf(plan, "brain/North Star.md");
		assert.deepEqual(northStar.destination, { kind: "page", page: "north_star" });
		assert.equal(northStar.body, `## Current Focus\n\n- Ship <mention url="${urlOf("work/active/Billing/Retry Rules.md")}">Retry Rules</mention>\n\n## Recent Context\n\n- See <mention url="${urlOf("page:home")}">Home</mention>\n`);
		assert.ok(plan.leftOut.some((file) => file.path === "brain/Memories.md" && file.reason.includes('takes its section "Recent Context"')));
		assert.deepEqual(
			northStar.losses.filter((loss) => loss.path === "brain/Memories.md").map((loss) => `${loss.kind}: ${loss.example}`),
			["replaced text: - [[Patterns]]"],
		);
	});

	test("Index gives the Open Questions section of Home, and a link to a replaced file or a template names its page", () => {
		const index = pageOf(plan, "work/Index.md");
		assert.equal(index.title, "Home");
		assert.equal(
			index.body,
			`## Open Questions\n\n- Why <mention url="${urlOf("page:home")}">Home</mention>?\n- See <mention url="${urlOf("template:Work Note")}">Work Note</mention>\n`,
		);
		assert.equal(pageOf(plan, "brain/Patterns.md").destination.kind, "row");
		assert.ok(!plan.pages.some((page) => page.note.path === "Home.md"));
	});

	test("the digest is the same for the same vault and changes with a change of the note", () => {
		const again = planOf(vaultOf(VAULT, ["attachments/a.png"]));
		assert.deepEqual(again.pages.map((page) => page.digest), plan.pages.map((page) => page.digest));
		const edited = planOf(vaultOf({ ...VAULT, "reference/Runbook.md": note("tags: [reference]", "New steps.\n") }));
		const changed = edited.pages.filter((page, index) => page.digest !== plan.pages[index]?.digest).map((page) => page.note.path);
		assert.deepEqual(changed, ["reference/Runbook.md"]);
	});

	test("the reports name each place, each file left out, and each construct that loses form with its first example", () => {
		const places = planReport(plan);
		assert.match(places, /\| work\/Index\.md \| \(a page of the setup\) \|  \| Home \| the section "Open Questions" only \|/);
		assert.match(places, /\| attachments\/a\.png \| It is not a Markdown note/);
		const losses = lossReport(plan);
		assert.match(losses, /\| frontmatter key \| \d+ \| \d+ \| .* \| work\/active\/Billing\/Retry Rules\.md:1: `update: soon` \|/);
		assert.match(losses, /\| replaced text \| 1 \| 1 \| .* \| brain\/Memories\.md:7: `- \[\[Patterns\]\]` \|/, "a title heading outside the section is not a loss");
	});
});
