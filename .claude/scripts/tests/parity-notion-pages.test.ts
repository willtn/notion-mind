/**
 * parity/notion-pages.ts and parity/notion-env.ts: a fixture note as a
 * Notion page, the comparison of a spec value with a live value, and the
 * variables that a hook process needs for Notion. No test here calls Notion.
 *
 * The values come from the small spec of `_notion-spec.ts`. The tests on
 * `FIXTURE` hold for each note of the parity fixture set, so they do not
 * name a note of it.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseOpenLoopConfig } from "../lib/active-hygiene.ts";
import { DATABASES, VERBATIM_PROPERTY } from "../lib/notion-model.ts";
import { FIXTURE } from "../parity/fixture.ts";
import { renderNote } from "../parity/markdown-form.ts";
import { notionHookEnvironment } from "../parity/notion-env.ts";
import {
	ARCHIVED_WORK_GROUP,
	canonicalContent,
	changedValues,
	composeContent,
	desiredValues,
	liveValues,
	managedProperties,
	notesInGroup,
	notionBody,
	propertyArguments,
	sameContent,
	stampIsStale,
	targetOf,
	userValues,
	wantedOptions,
	type NoteContext,
	type PageRef,
} from "../parity/notion-pages.ts";
import { expectedViewRows } from "../parity/notion-verify.ts";
import { changedAt, NOTE_TYPES, type FixtureNote, type FixtureSpec, type NoteType } from "../parity/spec.ts";
import { note, SPEC } from "./_notion-spec.ts";

const idOf = (index: number): string => `00000000-0000-0000-0000-${String(index).padStart(12, "0")}`;
const urlOf = (index: number): string => `https://app.notion.com/p/${idOf(index).replace(/-/g, "")}`;
const pagesOf = (notes: readonly FixtureNote[]) => new Map<string, PageRef>(notes.map((n, index) => [n.title, { id: idOf(index), url: urlOf(index), target: targetOf(n) }] as const));
const pages = pagesOf(SPEC.notes);
const pageOf = (title: string): PageRef => pages.get(title) ?? assert.fail(`no page ${title}`);
const now = new Date("2026-03-04T10:00:30.000Z");
const manifest = SPEC.repoFiles.find((file) => file.path === "vault-manifest.json")?.content ?? null;
const context: NoteContext = { now, openLoopSections: parseOpenLoopConfig(manifest).sectionRe, pages };
/** `Bytes` is the size of the file that the Markdown form writes for the same note. */
const outageBytes = Buffer.byteLength(renderNote(note("Outage")));
const valuesOf = (title: string) => {
	const target = targetOf(note(title));
	if (target.kind !== "row") assert.fail(`${title} is not a row`);
	return desiredValues(note(title), target.database, context);
};

describe("the parity fixture set", () => {
	test("each note has a place in Notion, and each row has a value for each managed property", () => {
		const fixturePages = pagesOf(FIXTURE.notes);
		const sections = parseOpenLoopConfig(FIXTURE.repoFiles.find((file) => file.path === "vault-manifest.json")?.content ?? null).sectionRe;
		for (const n of FIXTURE.notes) {
			const target = targetOf(n);
			if (target.kind !== "row") continue;
			const values = desiredValues(n, target.database, { now, openLoopSections: sections, pages: fixturePages });
			assert.deepEqual(Object.keys(values).sort(), managedProperties(target.database).sort(), n.title);
			assert.equal(values["Bytes"], Buffer.byteLength(renderNote(n)), n.title);
		}
	});
});

describe("targetOf", () => {
	test("each note type with a database names a database of the model, and its name is an option of Type", () => {
		for (const type of Object.keys(NOTE_TYPES) as NoteType[]) {
			const title = NOTE_TYPES[type].database;
			if (title === null) continue;
			const database = DATABASES.find((d) => d.title === title) ?? assert.fail(`${type}: no database ${title}`);
			const typeProperty = database.properties["Type"];
			if (typeProperty?.type === "select") assert.ok(typeProperty.options.includes(type), `${database.title}.Type has no option ${type}`);
		}
	});

	test("a row goes to the database of its type, by the key of the model", () => {
		assert.deepEqual(targetOf(note("Outage")), { kind: "row", database: "work" });
		assert.deepEqual(targetOf(note("Ada Park")), { kind: "row", database: "people" });
		assert.deepEqual(targetOf(note("Runbook Archive")), { kind: "row", database: "knowledge" });
	});

	test("a verbatim note outside the databases stops the run, because its page has no property for the mark", () => {
		assert.throws(() => targetOf({ ...note("Loose Draft"), verbatim: true }), /verbatim note outside the databases/);
	});

	test("North Star and Home are pages of the setup, and a note with no properties is a plain page", () => {
		assert.deepEqual(targetOf(note("North Star")), { kind: "scaffold", page: "north_star" });
		assert.deepEqual(targetOf(note("Home")), { kind: "scaffold", page: "home" });
		assert.deepEqual(targetOf(note("Loose Draft")), { kind: "loose" });
	});
});

describe("desiredValues", () => {
	test("an incident holds its fields, its type, and the derived values", () => {
		assert.deepEqual(valuesOf("Outage"), {
			Type: "Incident",
			Date: "2026-01-05",
			Description: "The checkout failed",
			Tags: ["incident", "work-note"],
			Status: "active",
			Quarter: "Q1-2026",
			Project: null,
			Person: null,
			Ticket: "OPS-41",
			Severity: "high",
			Role: "incident-lead",
			Verbatim: false,
			Related: null,
			Changed: "2026-02-07T10:00",
			Bytes: outageBytes,
			"Open tasks": 1,
			"Open loops": 2,
		});
	});

	test("Changed is the instant of changedAt, to the minute", () => {
		const changed = changedAt(note("Runbook"), now).toISOString();
		assert.equal(valuesOf("Runbook")["Changed"], changed.slice(0, 16));
	});

	test("the person of a 1:1 note is a relation to the People row, and the body link adds no second entry", () => {
		assert.deepEqual(valuesOf("Ada Park 2026-02-07")["Person"], [pageOf("Ada Park").id]);
	});

	test("a body link to a row of the same database fills Related, and a link to a Knowledge row fills no relation", () => {
		assert.deepEqual(valuesOf("Outage RCA")["Related"], [pageOf("Outage").id]);
		assert.equal(valuesOf("Export Pipeline")["Related"], null);
	});

	test("the title of a person is the Role, and a Knowledge row has Has content from its body", () => {
		assert.equal(valuesOf("Ada Park")["Role"], "Staff Engineer");
		assert.equal(valuesOf("Patterns")["Has content"], true);
		assert.equal(valuesOf("Gotchas")["Has content"], false);
	});

	test("a field that the note does not have is an empty property, so a value of an earlier state goes away", () => {
		assert.equal(valuesOf("Patterns")["Description"], null);
		assert.deepEqual(Object.keys(valuesOf("Patterns")).sort(), managedProperties("knowledge").sort());
	});

	test("Bytes is the size of the Markdown file of the note", () => {
		for (const title of ["Runbook", "Runbook Archive", "Ada Park"]) assert.equal(valuesOf(title)["Bytes"], Buffer.byteLength(renderNote(note(title))), title);
		assert.ok((valuesOf("Runbook")["Bytes"] as number) >= 25_000);
	});

	test("a field with no property in the database stops the run", () => {
		const wrong: FixtureNote = { ...note("Ada Park"), fields: { ticket: "OPS-1" } };
		assert.throws(() => desiredValues(wrong, "people", context), /the field "ticket" needs the property "Ticket"/);
	});

	test("a person that is not a fixture note stops the run", () => {
		const wrong: FixtureNote = { ...note("Ada Park 2026-02-07"), fields: { person: "Nobody" } };
		assert.throws(() => desiredValues(wrong, "work", context), /"Person" names "Nobody"/);
	});

	test("userValues leaves out each derived property", () => {
		assert.deepEqual(Object.keys(userValues(valuesOf("Gotchas"))).sort(), ["Date", "Description", "Tags", "Type", "Verbatim"]);
	});

	test("a verbatim note has the Verbatim box set, in each database, and a write sends it as a property of a person", () => {
		for (const title of ["Outage RCA", "Ada Park", "Runbook"]) {
			const target = targetOf(note(title));
			if (target.kind !== "row") assert.fail(`${title} is not a row`);
			assert.equal(valuesOf(title)[VERBATIM_PROPERTY], false, title);
			const values = desiredValues({ ...note(title), verbatim: true }, target.database, context);
			assert.equal(values[VERBATIM_PROPERTY], true, title);
			assert.equal(propertyArguments(userValues(values), target.database)[VERBATIM_PROPERTY], "__YES__", title);
		}
	});

	test("the other keys of a note are in no property, and they count in Bytes as they do in the file", () => {
		const plain = note("Export Pipeline");
		const withKey: FixtureNote = { ...plain, otherKeys: { update: "2026-01-05" } };
		const { Bytes: bytes, ...rest } = desiredValues(withKey, "work", context);
		const { Bytes: plainBytes, ...plainRest } = valuesOf("Export Pipeline");
		assert.deepEqual(rest, plainRest);
		assert.equal(bytes, (plainBytes as number) + Buffer.byteLength("update: 2026-01-05\n"));
	});
});

describe("notesInGroup", () => {
	const archived: FixtureNote = { ...note("Export Pipeline"), title: "Old Export", fields: { ...note("Export Pipeline").fields, status: "completed" } };
	const notes = [...SPEC.notes, archived];

	test("the archived Work notes are one group, and the group of their Type does not hold them", () => {
		assert.deepEqual(notesInGroup(notes, ARCHIVED_WORK_GROUP), ["Old Export"]);
		assert.deepEqual(notesInGroup(notes, "Work / Work note"), ["Export Pipeline", "Pricing Rollout"]);
		assert.deepEqual(notesInGroup(notes, "Knowledge / Reference"), ["Runbook", "Ticket Links"]);
	});

	test("an incident with no status is not an archived Work note", () => {
		assert.deepEqual(notesInGroup(notes, "Work / Incident"), ["Outage", "Outage RCA"]);
	});

	test("a Type alone and a database alone hold each note of that name", () => {
		assert.deepEqual(notesInGroup(notes, "Work note"), ["Export Pipeline", "Pricing Rollout", "Old Export"]);
		assert.deepEqual(notesInGroup(notes, "People"), ["Ada Park"]);
	});

	test("each row is in exactly one group of a database and a Type, and a page outside the databases is in none", () => {
		const groups = ["Work / Work note", "Work / Incident", "Work / 1:1", "Work / Inbox item", "Work / Thinking", ARCHIVED_WORK_GROUP, "People / Person", "Knowledge / Brain topic", "Knowledge / Reference", "Knowledge / Archive note"];
		const grouped = groups.flatMap((group) => notesInGroup(FIXTURE.notes, group));
		const rows = FIXTURE.notes.filter((n) => NOTE_TYPES[n.type].database !== null).map((n) => n.title);
		assert.deepEqual([...grouped].sort(), [...rows].sort());
	});

	test("the parity fixture set has the groups that the wording test of the harness names", () => {
		assert.deepEqual(notesInGroup(FIXTURE.notes, ARCHIVED_WORK_GROUP), FIXTURE.notes.filter((n) => n.type === "Work note" && n.fields.status !== "active").map((n) => n.title));
		assert.equal(notesInGroup(FIXTURE.notes, ARCHIVED_WORK_GROUP).length, 4);
		assert.equal(notesInGroup(FIXTURE.notes, "Knowledge / Reference").length, 13);
		assert.deepEqual(notesInGroup(FIXTURE.notes, "No such group"), []);
	});
});

describe("liveValues and changedValues", () => {
	const row = {
		Name: "Outage",
		Type: "Incident",
		"date:Date:start": "2026-01-05",
		"date:Date:is_datetime": 0,
		Description: "The checkout failed",
		Tags: '["work-note","incident"]',
		Status: "active",
		Quarter: "Q1-2026",
		Ticket: "OPS-41",
		Severity: "high",
		Role: "incident-lead",
		Context: "",
		"date:Changed:start": "2026-02-07T10:00:00.000Z",
		"date:Changed:is_datetime": 1,
		Bytes: outageBytes,
		"Open tasks": 1,
		"Open loops": 2,
		Stale: "formulaResult://x",
	};

	test("a query row in the form that Notion sends equals the spec values", () => {
		assert.deepEqual(liveValues(row, "work"), valuesOf("Outage"));
		assert.deepEqual(changedValues(valuesOf("Outage"), liveValues(row, "work")), {});
	});

	test("a relation is a JSON list of page URLs, and it compares by page ID in any order", () => {
		const live = liveValues({ Related: JSON.stringify([urlOf(7), urlOf(3)]) }, "work");
		assert.deepEqual(live["Related"], [idOf(3), idOf(7)]);
	});

	test("an empty text, an empty list, and an absent key are empty properties", () => {
		const live = liveValues({ Description: "", Tags: "[]" }, "work");
		assert.equal(live["Description"], null);
		assert.equal(live["Tags"], null);
		assert.equal(live["Changed"], null);
		assert.equal(live["Open tasks"], null);
	});

	test("a checkbox reads as true only for the checked text", () => {
		assert.equal(liveValues({ "Has content": "__YES__" }, "knowledge")["Has content"], true);
		assert.equal(liveValues({ "Has content": "__NO__" }, "knowledge")["Has content"], false);
		assert.equal(liveValues({}, "knowledge")["Has content"], false);
	});

	test("changedValues names only the properties that differ, a value to remove included", () => {
		const live = liveValues({ ...row, Severity: "low", Role: "", Project: "Pricing", "Open loops": 0 }, "work");
		assert.deepEqual(changedValues(valuesOf("Outage"), live), { Severity: "high", Role: "incident-lead", Project: null, "Open loops": 2 });
	});

	test("a different minute of Changed is a difference, and a different second is not", () => {
		const later = { ...row, "date:Changed:start": "2026-02-07T10:01:00.000Z" };
		assert.deepEqual(Object.keys(changedValues(valuesOf("Outage"), liveValues(later, "work"))), ["Changed"]);
		const sameMinute = desiredValues(note("Outage"), "work", { ...context, now: new Date("2026-03-04T10:00:59.000Z") });
		assert.deepEqual(changedValues(sameMinute, liveValues(row, "work")), {});
	});
});

describe("propertyArguments", () => {
	test("a date splits into its start and its kind, a checkbox is the text of Notion, and null removes a value", () => {
		assert.deepEqual(propertyArguments({ Date: "2026-01-05", Changed: "2026-02-07T10:00", "Has content": true, Description: null, Tags: ["brain"], Bytes: 91 }, "knowledge"), {
			"date:Date:start": "2026-01-05",
			"date:Date:is_datetime": 0,
			"date:Changed:start": "2026-02-07T10:00:00.000Z",
			"date:Changed:is_datetime": 1,
			"Has content": "__YES__",
			Description: null,
			Tags: ["brain"],
			Bytes: 91,
		});
		assert.deepEqual(propertyArguments({ Changed: null, "Has content": false }, "knowledge"), { "date:Changed:start": null, "date:Changed:is_datetime": 0, "Has content": "__NO__" });
	});
});

describe("stampIsStale", () => {
	test("a row with no stamp, or with an edit more than 2 minutes after the stamp, needs a new stamp", () => {
		assert.equal(stampIsStale({}), true);
		assert.equal(stampIsStale({ "Last edited": "2026-03-04T10:05:00.000Z", "date:Hook stamp:start": "2026-03-04T10:00:00.000Z" }), true);
		assert.equal(stampIsStale({ "Last edited": "2026-03-04T10:00:59.000Z", "date:Hook stamp:start": "2026-03-04T10:00:00.000Z" }), false);
	});
});

describe("wantedOptions", () => {
	test("collects the select and multi-select values of the rows of one database", () => {
		const work = SPEC.notes.filter((n) => NOTE_TYPES[n.type].database === "Work");
		const wanted = wantedOptions(work, "work");
		assert.deepEqual(wanted["Quarter"], ["Q1-2026"]);
		assert.deepEqual(wanted["Project"], ["Pricing"]);
		assert.deepEqual([...(wanted["Tags"] ?? [])].sort(), ["incident", "meeting", "work-note"]);
		assert.deepEqual(wanted["Severity"], ["high"]);
		assert.equal(wanted["Ticket"], undefined);
	});
});

describe("notionBody", () => {
	test("a link to a fixture note is a mention of its page, and a link to no note stays as text", () => {
		assert.equal(notionBody(note("Ticket Links"), pages), `# Ticket Links\n\nThe work is in [[PROJ-123]] and [[OPS-9]]. See <mention url="${pageOf("Patterns").url}">Patterns</mention>.\n`);
	});
});

describe("composeContent", () => {
	const view = `<database url="https://app.notion.com/p/${"1".repeat(32)}" data-source-url="collection://${idOf(1)}" inline="true"></database>`;
	const blockUrl = `https://app.notion.com/p/${"2".repeat(32)}#${"3".repeat(32)}`;

	test("a page with no block of the setup gets the body", () => {
		assert.equal(composeContent("# Note\n\nText.\n", "Old text.\n"), "# Note\n\nText.\n");
	});

	test("a linked view stays after the body", () => {
		assert.equal(composeContent("# Key Decisions\n\n- One.\n", `Old text.\n\n${view}\n`), `# Key Decisions\n\n- One.\n\n${view}\n`);
	});

	test("a section that the page holds as a synced block keeps the block around the new text", () => {
		const live = `Old.\n\n## Current Focus\n\n<synced-block url="${blockUrl}">\n- Old focus.\n</synced-block>\n\n## Goals\n\n- Old goal.\n`;
		const body = "# North Star\n\nIntro.\n\n## Current Focus\n\n- Ship.\n- Keep.\n\n## Longer Term\n\n- Grow.\n";
		assert.equal(composeContent(body, live), `# North Star\n\nIntro.\n\n## Current Focus\n\n<synced-block url="${blockUrl}">\n- Ship.\n- Keep.\n</synced-block>\n\n## Longer Term\n\n- Grow.\n`);
	});

	test("a note without the section of a synced block stops the run", () => {
		const live = `## Current Focus\n\n<synced-block url="${blockUrl}">\n- Old focus.\n</synced-block>\n`;
		assert.throws(() => composeContent("# North Star\n\nNo focus section.\n", live), /holds the section "## Current Focus" as a synced block/);
	});

	test("a synced block reference stays first with its heading and its text, and a linked view stays last", () => {
		const reference = `<synced-block-reference url="${blockUrl}">\n- Ship.\n- Keep.\n</synced-block-reference>`;
		const live = `## Current Focus\n\n${reference}\n\n## Open Questions\n\nOld.\n\n${view}\n`;
		assert.equal(composeContent("# Home\n\n- [ ] A task\n", live), `## Current Focus\n\n${reference}\n\n# Home\n\n- [ ] A task\n\n${view}\n`);
	});

	test("the result of a write is a fixed point: a second compose on it gives the same content", () => {
		const reference = `<synced-block-reference url="${blockUrl}">\n- Ship.\n</synced-block-reference>`;
		const first = composeContent("# Home\n\n- [ ] A task\n", `## Current Focus\n\n${reference}\n\nOld.\n\n${view}\n`);
		assert.equal(composeContent("# Home\n\n- [ ] A task\n", first), first);
	});
});

describe("canonicalContent", () => {
	const mention = (index: number, title: string): string => `<mention url="${urlOf(index)}">${title}</mention>`;

	test("what a write sends equals what a fetch returns, for each construct of the fixture set", () => {
		const sent = [
			"# Wrapped Prose",
			"",
			"This paragraph has a line break in the",
			"middle of a sentence, and a second",
			`line break after it. See <mention url="${urlOf(2)}"/>.`,
			"",
			"The work is in [[PROJ-123]] and [[OPS-9]].",
			"",
			"- ~~Close the search migration.~~",
			"  - A detail of the closed goal.",
			"- [ ] Send the notes",
			"- [x] Share the agenda",
			"- A plain item",
			"",
			"```text",
			"gateway: refused",
			"retries: 3",
			"```",
			"",
		].join("\n");
		const fetched = [
			"# Wrapped Prose",
			"",
			`This paragraph has a line break in the<br />middle of a sentence, and a second<br />line break after it. See ${mention(2, "Patterns")}.`,
			"",
			"The work is in \\[\\[PROJ-123\\]\\] and \\[\\[OPS-9\\]\\].",
			"",
			"- <s>Close the search migration.</s>",
			"  - A detail of the closed goal.",
			"",
			"- [ ] Send the notes",
			"- [x] Share the agenda",
			"",
			"- A plain item",
			"",
			"```txt",
			"gateway: refused",
			"retries: 3",
			"```",
		].join("\n");
		assert.ok(sameContent(sent, fetched));
	});

	test("a line of a code block stays as it is: no wrap mark, no changed tag, and a blank line counts", () => {
		const block = "```text\nfirst <b>line</b>\nsecond line\n```\n";
		assert.equal(canonicalContent(block), "```txt\nfirst <b>line</b>\nsecond line\n```");
		assert.equal(sameContent(block, block.replace("second", "third")), false);
		assert.equal(sameContent(block, block.replace("\nsecond", "\n\nsecond")), false);
		assert.equal(sameContent(block, block.replace("```text", "```yaml")), false);
		assert.equal(canonicalContent("```\ncode\n```\nA line\nand its wrap.\n"), "```\ncode\n```\nA line<br />and its wrap.");
	});

	test("a changed word, a closed task, a removed line, and a mention of a different page are differences", () => {
		const base = `# Note\n\nA first idea. See <mention url="${urlOf(2)}"/>.\n\n- [ ] Send the notes\n- [ ] Book the next meeting\n`;
		for (const [what, other] of [
			["word", base.replace("first", "second")],
			["task state", base.replace("- [ ] Send", "- [x] Send")],
			["line", base.replace("- [ ] Book the next meeting\n", "")],
			["mention", base.replace(urlOf(2), urlOf(3))],
			["heading level", base.replace("# Note", "## Note")],
		] as const) {
			assert.equal(sameContent(base, other), false, what);
		}
	});

	test("a hard wrap and a paragraph break are different content", () => {
		assert.equal(sameContent("One line\nand its wrap.\n", "One line\n\nand its wrap.\n"), false);
		assert.equal(canonicalContent("One line\nand its wrap.\n"), "One line<br />and its wrap.");
	});

	test("the composed content of each note of the fixture set is equal to itself after a pass through the Notion forms", () => {
		const fixturePages = pagesOf(FIXTURE.notes);
		for (const n of FIXTURE.notes) {
			const sent = composeContent(notionBody(n, fixturePages), "");
			const fetched = sent.replace(/<mention url="([^"]+)"\/>/g, '<mention url="$1">Title</mention>').replace(/\[\[/g, "\\[\\[").replace(/\]\]/g, "\\]\\]").replace(/^```text$/gm, "```txt");
			assert.ok(sameContent(sent, fetched), n.title);
		}
	});
});

describe("expectedViewRows", () => {
	const rows = (view: string, database = "work"): readonly string[] =>
		expectedViewRows(SPEC).find((expectation) => expectation.view === view && expectation.database === database)?.titles ?? assert.fail(`no view ${view}`);

	test("the conditions of part (d) give these rows, and a note counts from the day that its age reaches the limit", () => {
		assert.deepEqual(rows("Hygiene: loose active"), ["Export Pipeline"]);
		assert.deepEqual(rows("Open tasks"), ["Export Pipeline"]);
		assert.deepEqual(rows("Hygiene: inbox pressure"), ["Planning Export"]);
		assert.deepEqual(rows("Hygiene: open loops"), ["Ada Park 2026-02-07", "Outage"]);
		assert.deepEqual(rows("Hygiene: oversized", "knowledge"), ["Runbook"]);
		assert.deepEqual(rows("Hygiene: oversized"), []);
		assert.deepEqual(rows("Brain index", "knowledge"), ["Gotchas", "Patterns"]);
	});

	test("a note that the original hook skips by its name is a row of the view, and the expectation names it for the hook", () => {
		const named: FixtureSpec = { ...SPEC, notes: [...SPEC.notes, { ...note("Outage"), title: "Outage Log Archive" }, { ...note("Patterns"), title: "Memories" }] };
		const of = (view: string, database: string) => expectedViewRows(named).find((expectation) => expectation.view === view && expectation.database === database) ?? assert.fail(`no view ${view}`);
		assert.deepEqual(of("Hygiene: open loops", "work").titles, ["Ada Park 2026-02-07", "Outage", "Outage Log Archive"]);
		assert.deepEqual(of("Hygiene: open loops", "work").hookLeavesOut, ["Outage Log Archive"]);
		assert.deepEqual(of("Brain index", "knowledge").titles, ["Gotchas", "Memories", "Patterns"]);
		assert.deepEqual(of("Brain index", "knowledge").hookLeavesOut, ["Memories"]);
		assert.deepEqual(expectedViewRows(SPEC).flatMap((expectation) => expectation.hookLeavesOut), []);
	});

	test("an old note with open loops outside the watched folders is a row of the open-loops view, and the expectation names it for the hook", () => {
		const archived: FixtureNote = { ...note("Export Pipeline"), title: "Legacy Importer", fields: { ...note("Export Pipeline").fields, status: "completed" }, body: "# Legacy Importer\n\nWaiting on the data team.\n", changedDaysAgo: 90 };
		const young: FixtureNote = { ...archived, title: "New Importer", changedDaysAgo: 13 };
		const loops = expectedViewRows({ ...SPEC, notes: [...SPEC.notes, archived, young] }).find(({ view }) => view === "Hygiene: open loops") ?? assert.fail("no view");
		assert.deepEqual(loops.titles, ["Ada Park 2026-02-07", "Legacy Importer", "Outage"]);
		assert.deepEqual(loops.hookLeavesOut, ["Legacy Importer"]);
	});

	test("the watched folders are the `open_loop_dirs` of the manifest of the spec", () => {
		const manifest = JSON.parse(SPEC.repoFiles.find(({ path }) => path === "vault-manifest.json")?.content ?? assert.fail("no manifest")) as Record<string, unknown>;
		const incidentsOnly: FixtureSpec = { ...SPEC, repoFiles: [{ path: "vault-manifest.json", content: JSON.stringify({ ...manifest, open_loop_dirs: ["work/incidents"] }) }] };
		const loops = expectedViewRows(incidentsOnly).find(({ view }) => view === "Hygiene: open loops") ?? assert.fail("no view");
		assert.deepEqual(loops.titles, ["Ada Park 2026-02-07", "Outage"]);
		assert.deepEqual(loops.hookLeavesOut, ["Ada Park 2026-02-07"]);
	});

	test("each expected view is a view of the model", () => {
		for (const expectation of expectedViewRows(FIXTURE)) {
			const database = DATABASES.find((d) => d.key === expectation.database) ?? assert.fail(`no database ${expectation.database}`);
			assert.ok(database.views.some((view) => view.name === expectation.view), `${database.title} has no view ${expectation.view}`);
		}
	});
});

describe("notionHookEnvironment", () => {
	const fakeMachine = (): { root: string; env: NodeJS.ProcessEnv } => {
		const root = realpathSync(mkdtempSync(join(tmpdir(), "om-notion-env-")));
		for (const folder of ["bin", "config/mcporter", "data/mcporter"]) mkdirSync(join(root, folder), { recursive: true });
		writeFileSync(join(root, "bin", "mcporter"), "#!/bin/sh\n", { mode: 0o755 });
		writeFileSync(join(root, "config", "mcporter", "mcporter.json"), "{}\n");
		writeFileSync(join(root, "data", "mcporter", "credentials.json"), "{}\n");
		return { root, env: { PATH: join(root, "bin"), XDG_CONFIG_HOME: join(root, "config"), XDG_DATA_HOME: join(root, "data"), SECRET_TOKEN: "x", npm_config_prefix: "/x" } };
	};

	test("passes only the path, the config file, and the login folder of mcporter", { skip: process.platform === "win32" }, () => {
		const { root, env } = fakeMachine();
		try {
			const dir = join(root, "scenario");
			mkdirSync(dir);
			const out = notionHookEnvironment(dir, env);
			assert.deepEqual(Object.keys(out).sort(), ["MCPORTER_CONFIG", "PATH", "XDG_DATA_HOME"]);
			assert.equal(out["MCPORTER_CONFIG"], join(root, "config", "mcporter", "mcporter.json"));
			assert.deepEqual(readdirSync(out["PATH"] ?? "").filter((name) => name !== "git").sort(), ["mcporter", "node"]);
			assert.equal(realpathSync(join(out["PATH"] ?? "", "mcporter")), join(root, "bin", "mcporter"));
			assert.equal(realpathSync(join(out["XDG_DATA_HOME"] ?? "", "mcporter")), join(root, "data", "mcporter"), "the login is the folder of the machine, not a copy");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("MCPORTER_CONFIG and the vault variables of the harness pass through", { skip: process.platform === "win32" }, () => {
		const { root, env } = fakeMachine();
		try {
			const dir = join(root, "scenario");
			mkdirSync(dir);
			const out = notionHookEnvironment(dir, { ...env, MCPORTER_CONFIG: "/elsewhere/mcporter.json", MCPORTER_VAULT_PASSWORD: "p".repeat(32) });
			assert.equal(out["MCPORTER_CONFIG"], "/elsewhere/mcporter.json");
			assert.equal(out["MCPORTER_VAULT_PASSWORD"], "p".repeat(32));
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("says what is missing when mcporter is not on PATH or has no login folder", { skip: process.platform === "win32" }, () => {
		const { root, env } = fakeMachine();
		try {
			const dir = join(root, "scenario");
			mkdirSync(dir);
			assert.throws(() => notionHookEnvironment(dir, { ...env, PATH: join(root, "empty") }), /mcporter is not on PATH/);
			assert.throws(() => notionHookEnvironment(dir, { ...env, XDG_DATA_HOME: join(root, "no-login") }), /no login folder/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
