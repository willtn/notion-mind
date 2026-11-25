/**
 * The findings of the write check for one written note (lib/write-check.ts)
 * and the note that it reads (lib/notion-note.ts). Each case states the
 * row of part d.1 of `NOTION-PORT-DESIGN.md` that it covers.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseOpenLoopConfig } from "../lib/active-hygiene.ts";
import type { FrontmatterRequired } from "../lib/frontmatter.ts";
import type { DatabaseKey } from "../lib/notion-model.ts";
import { missingFields, noteMarkdown, valueOf, type Place, type Properties, type WrittenNote } from "../lib/notion-note.ts";
import { checkNote, derivedUpdate, isLooseActive, type NoteFindings } from "../lib/write-check.ts";

const REQUIRED: FrontmatterRequired = {
	global: ["date", "description", "tags"],
	"work-note": ["date", "status", "quarter"],
	incident: ["date", "status", "quarter", "ticket", "severity", "role"],
	person: ["date", "title"],
	team: ["date"],
	"1-1": ["date", "quarter"],
};

const GLOBAL: Properties = { "date:Date:start": "2026-01-05", Description: "A note", Tags: ["work-note"] };
const URL = "https://app.notion.com/p/00000000000040008000000000000001";
const LINK = '<mention url="https://app.notion.com/p/00000000000040008000000000000002">Patterns</mention>';

const row = (database: DatabaseKey): Place => ({ kind: "row", database });

function note(fields: Partial<WrittenNote> & { readonly place: Place }): WrittenNote {
	return { id: "00000000-0000-4000-8000-000000000001", url: URL, title: "A Note", properties: GLOBAL, body: `See ${LINK}.`, changed: true, ...fields };
}

const check = (written: WrittenNote, looseActive: readonly string[] | null = null): NoteFindings => checkNote(written, { required: REQUIRED, looseActive });

/** The warning lines of the one warning block, with no list mark. */
function warnings(findings: NoteFindings): string[] {
	const block = findings.blocks.find((text) => text.startsWith("Workspace hygiene warnings"));
	return block === undefined ? [] : block.split("\n").slice(1, -1).map((line) => line.replace(/^ {2}- /, ""));
}

const workNote = (properties: Properties, fields: Partial<WrittenNote> = {}): WrittenNote =>
	note({ place: row("work"), properties: { ...GLOBAL, Type: "Work note", ...properties }, ...fields });

describe("the property values of a note", () => {
	test("an absent key, an empty text, an empty list, and the JSON text of an empty list are all an empty property", () => {
		for (const properties of [{}, { Tags: "" }, { Tags: [] }, { Tags: "[]" }, { Tags: null }]) assert.equal(valueOf(properties, "Tags"), null, JSON.stringify(properties));
	});

	test("a date is under its start key, and a list of a query row is JSON text", () => {
		assert.equal(valueOf({ "date:Date:start": "2026-01-05" }, "Date"), "2026-01-05");
		assert.deepEqual(valueOf({ Tags: '["a","b"]' }, "Tags"), ["a", "b"]);
		assert.deepEqual(valueOf({ Tags: ["a"] }, "Tags"), ["a"]);
	});
});

describe("the note as Markdown", () => {
	test("the properties that come from frontmatter are a YAML block above the body, with the field names of the vault", () => {
		const written = workNote({ Status: "active", Quarter: "Q1-2026", Tags: ["work-note", "decision"] }, { body: "# A Note\n" });
		assert.equal(
			noteMarkdown(written),
			"---\ndate: 2026-01-05\ndescription: A note\ntags:\n  - work-note\n  - decision\nstatus: active\nquarter: Q1-2026\n---\n\n# A Note\n",
		);
	});

	test("`Type`, the title, a relation, and a derived property add no text", () => {
		const written = workNote({ Name: "A Note", Person: ["00000000-0000-4000-8000-000000000009"], Bytes: 10, "date:Changed:start": "2026-01-05T00:00:00.000Z" }, { body: "Body" });
		assert.equal(noteMarkdown(written), "---\ndate: 2026-01-05\ndescription: A note\ntags:\n  - work-note\n---\n\nBody");
	});

	test("the `Role` of a person is the field `title`", () => {
		const written = note({ place: row("people"), properties: { ...GLOBAL, Role: "Engineer" }, body: "Body" });
		assert.match(noteMarkdown(written), /^title: Engineer$/m);
		assert.doesNotMatch(noteMarkdown(written), /^role:/m);
	});

	test("a mention that names its page is a link, and a mention with no name stays", () => {
		const bare = '<mention url="https://app.notion.com/p/00000000000040008000000000000002"/>';
		assert.equal(noteMarkdown(note({ place: { kind: "page" }, body: `See ${LINK} and ${bare}.` })), `See [[Patterns]] and ${bare}.`);
	});

	test("a page that is not a row is its body only", () => {
		assert.equal(noteMarkdown(note({ place: { kind: "page" }, properties: { title: "A Note" }, body: "Body" })), "Body");
	});
});

describe("VW-07: a page outside the note databases", () => {
	test("a page under the root gets the one finding that it is not a row, and no field finding", () => {
		assert.deepEqual(warnings(check(note({ place: { kind: "page" }, properties: { title: "A Note" } }))), ["The page is not a row of a note database"]);
	});

	test("a page of the setup has no properties by design, so it gets no finding", () => {
		assert.deepEqual(check(note({ place: { kind: "scaffold" }, properties: { title: "Home" } })).blocks, []);
	});
});

describe("VW-04 and VW-05: the pages that get no check", () => {
	const empty = { blocks: [], policyResults: [] };
	const long = "A sentence with no link in it. ".repeat(20);

	test("a page that the root page does not hold", () => {
		assert.deepEqual(check(note({ place: { kind: "outside" }, properties: {}, body: long })), empty);
	});

	test("a template row and a thinking note", () => {
		assert.deepEqual(check(note({ place: row("templates"), properties: {}, body: long })), empty);
		assert.deepEqual(check(note({ place: row("work"), properties: { Type: "Thinking" }, body: long })), empty);
	});

	test("the same body in a work note gets its findings, so the cases above are silent because of the place", () => {
		assert.ok(warnings(check(workNote({}, { body: long }))).length > 0);
	});
});

describe("VW-08: the global fields", () => {
	test("each empty global property is one finding, with the text of its field", () => {
		const found = warnings(check(note({ place: row("knowledge"), properties: { Type: "Reference" } })));
		assert.deepEqual(found, [
			"The property `Date` is empty",
			"The property `Description` is empty (~150 chars required by vault convention)",
			"The property `Tags` is empty",
		]);
	});

	test("a row with the three properties has none", () => {
		assert.deepEqual(check(note({ place: row("knowledge"), properties: { ...GLOBAL, Type: "Reference" } })).blocks, []);
	});

	test("a manifest with its own global set replaces the three", () => {
		const found = missingFields(note({ place: row("knowledge"), properties: {} }), { global: ["owner"] });
		assert.deepEqual(found, [{ field: "owner", property: "Owner" }]);
	});

	test("a manifest with no `frontmatter_required` leaves the three", () => {
		assert.deepEqual(missingFields(note({ place: row("knowledge"), properties: {} }), {}).map(({ field }) => field), ["date", "description", "tags"]);
	});
});

describe("VW-09: the typed fields", () => {
	const missing = (written: WrittenNote): string[] => missingFields(written, REQUIRED).map(({ property }) => property);

	test("a work note and a decision need `Status` and `Quarter`", () => {
		assert.deepEqual(missing(workNote({})), ["Status", "Quarter"]);
		assert.deepEqual(missing(workNote({ Type: "Decision", Status: "accepted" })), ["Quarter"]);
		assert.deepEqual(warnings(check(workNote({ Status: "active" }))), ["The property `Quarter` is empty (required by vault-manifest.json frontmatter_required)"]);
	});

	test("a 1:1 note needs `Quarter` and not the `Status` of a work note", () => {
		assert.deepEqual(missing(workNote({ Type: "1:1" })), ["Quarter"]);
	});

	test("an incident needs the incident set only with the tag `incident`", () => {
		assert.deepEqual(missing(workNote({ Type: "Incident", Tags: ["work-note", "incident"] })), ["Status", "Quarter", "Ticket", "Severity", "Role"]);
		assert.deepEqual(missing(workNote({ Type: "Incident" })), []);
	});

	test("a person needs `Role`, which holds the field `title`, and a team needs only the global set", () => {
		assert.deepEqual(missing(note({ place: row("people") })), ["Role"]);
		assert.deepEqual(missing(note({ place: row("people"), properties: { ...GLOBAL, Role: "Engineer" } })), []);
		assert.deepEqual(missing(note({ place: row("teams") })), []);
	});

	test("an inbox item and a row of a database with no typed set need only the global set", () => {
		assert.deepEqual(missing(workNote({ Type: "Inbox item" })), []);
		assert.deepEqual(missing(note({ place: row("knowledge"), properties: { ...GLOBAL, Type: "Reference" } })), []);
	});
});

describe("VW-10: a note with no link", () => {
	const NO_LINK = "No mentions or relations found — every note must link to at least one other note (vault convention)";
	const filler = (length: number): string => "x".repeat(length);
	const header = noteMarkdown(note({ place: row("knowledge"), properties: { ...GLOBAL, Type: "Reference" }, body: "" })).length;
	const reference = (body: string, properties: Properties = {}): WrittenNote => note({ place: row("knowledge"), properties: { ...GLOBAL, Type: "Reference", ...properties }, body });

	test("the limit is 300 characters of the note as Markdown: 301 gets the finding and 300 does not", () => {
		assert.deepEqual(warnings(check(reference(filler(301 - header)))), [NO_LINK]);
		assert.deepEqual(warnings(check(reference(filler(300 - header)))), []);
	});

	test("a mention with a name, a mention with no name, and a `[[` in the text each count as a link", () => {
		const long = filler(400);
		for (const link of [LINK, '<mention url="https://app.notion.com/p/00000000000040008000000000000002"/>', "[[PROJ-1]]"]) {
			assert.ok(!warnings(check(reference(`${long} ${link}`))).includes(NO_LINK), link);
		}
	});

	test("a relation that holds a page counts as a link", () => {
		assert.deepEqual(warnings(check(reference(filler(400), { Parent: ["00000000-0000-4000-8000-000000000009"] }))), []);
	});
});

describe("VW-11: a paragraph on more than one line", () => {
	const wrapped = "# Title\n\nA paragraph that\ncontinues here\nand here.\n";

	test("each line that continues a paragraph counts, and the finding names the first one by its line in the page content", () => {
		const [found] = warnings(check(workNote({ Status: "active", Quarter: "Q1-2026" }, { body: `${wrapped}\n${LINK}` })));
		assert.match(found ?? "", /^2 hard-wrapped paragraph line\(s\), first at line 4 — write each paragraph as one line/);
		const [onPage] = warnings(check(note({ place: { kind: "scaffold" }, properties: { title: "Home" }, body: `${wrapped}\n${LINK}` })));
		assert.match(onPage ?? "", /^2 hard-wrapped paragraph line\(s\), first at line 4 /);
	});

	test("a row with the `Verbatim` box set is a raw capture and gets no wrap finding, and the box with no mark does not help", () => {
		const transcript = (box: string): WrittenNote => workNote({ Status: "active", Quarter: "Q1-2026", Verbatim: box }, { body: `${wrapped}\n${LINK}` });
		assert.deepEqual(warnings(check(transcript("__YES__"))), []);
		assert.equal(warnings(check(transcript("__NO__"))).length, 1);
	});

	test("a code block is not prose", () => {
		assert.deepEqual(warnings(check(workNote({ Status: "active", Quarter: "Q1-2026" }, { body: `\`\`\`\none\ntwo\n\`\`\`\n\n${LINK}` }))), []);
	});
});

describe("VW-12: a ticket ID in a link", () => {
	test("the finding counts each one, and the policy result names the page", () => {
		const findings = check(workNote({ Status: "active", Quarter: "Q1-2026" }, { body: `See [[INFRA-123]] and [[OPS-9]] and ${LINK}.` }));
		assert.match(warnings(findings)[0] ?? "", /^2 ticket-ID wikilink\(s\)/);
		assert.deepEqual(findings.policyResults, [{ policy_id: "phantom-edge", path: URL, classification: "ticket-id-wikilink", action: "warn" }]);
	});
});

describe("VW-14: an oversized note", () => {
	const header = noteMarkdown(note({ place: row("knowledge"), properties: { ...GLOBAL, Type: "Reference" }, body: "[[x]]" })).length;
	const sized = (bytes: number, title = "A Note"): WrittenNote => note({ title, place: row("knowledge"), properties: { ...GLOBAL, Type: "Reference" }, body: `[[x]]${"y".repeat(bytes - header)}` });

	test("the limit is 25,000 bytes of the note as Markdown: 25,000 gets the flag and 24,999 does not", () => {
		const findings = check(sized(25_000));
		assert.match(findings.blocks[0] ?? "", /^📐 `A Note` is now 25KB — past the 25KB organization threshold\./);
		assert.deepEqual(findings.policyResults, [{ policy_id: "organization-threshold", path: URL, classification: "oversized-note", action: "flag" }]);
		assert.deepEqual(check(sized(24_999)).blocks, []);
	});

	test("a title with Archive in it gets no flag", () => {
		assert.deepEqual(check(sized(30_000, "Runbook Archive")).blocks, []);
	});

	test("the size counts bytes and not characters", () => {
		const written = note({ place: { kind: "scaffold" }, body: `[[x]]${"é".repeat(12_500)}` });
		assert.equal(check(written).blocks.length, 1);
	});
});

describe("VW-15: a topic cluster of the loose active rows", () => {
	const loose = ["Billing Export Pipeline", "Search Ranking", "Login Latency", "Checkout Flow"];
	const billing = workNote({ Status: "active", Quarter: "Q1-2026" }, { title: "Billing Retry Design" });

	test("a loose active row that shares a title word with one other row gets the hint and the policy result", () => {
		const findings = check(billing, loose);
		assert.equal(
			findings.blocks[0],
			[
				'🗂️  This note joins 1 active row(s) with no `Project` sharing "billing": Billing Export Pipeline, Billing Retry Design.',
				"Convention: once a workstream has >1 note it gets a `Project` value.",
				"Token overlap is BLIND — judge whether these genuinely share context before grouping; if they don't, say so and move on.",
			].join("\n"),
		);
		assert.deepEqual(findings.policyResults, [{ policy_id: "topic-cluster", path: URL, classification: "ungrouped-cluster", suggested_target: "a `Project` value", action: "flag" }]);
	});

	test("the written row counts also when the view returns it, and the result is the same", () => {
		assert.deepEqual(check(billing, [...loose, "Billing Retry Design"]), check(billing, loose));
	});

	test("fewer than 4 loose rows give no cluster", () => {
		assert.deepEqual(check(billing, ["Billing Export Pipeline", "Search Ranking"]).blocks, []);
	});

	test("a row with a `Project`, a row that is not active, and an incident are not loose active rows", () => {
		assert.equal(isLooseActive(billing), true);
		for (const properties of [{ Project: "Billing" }, { Status: "completed" }, { Type: "Incident" }]) {
			const written = workNote({ Status: "active", Quarter: "Q1-2026", ...properties }, { title: "Billing Retry Design" });
			assert.equal(isLooseActive(written), false, JSON.stringify(properties));
			assert.deepEqual(check(written, loose).blocks, []);
		}
	});

	test("a cluster of more than 10 rows names 10 of them and the number of the others, and the count stays whole", () => {
		const many = Array.from({ length: 12 }, (_, index) => `Billing Part ${String(index).padStart(2, "0")}`);
		const others = Array.from({ length: 14 }, (_, index) => `Zeta${index} Unique${index}`);
		const [hint] = check(billing, [...many, ...others]).blocks;
		assert.match(hint ?? "", /joins 12 active row\(s\)/);
		assert.match(hint ?? "", /Billing Part 09, … and 3 more\.\n/);
		assert.doesNotMatch(hint ?? "", /Billing Part 10/);
	});

	test("no view rows give no cluster finding", () => {
		assert.deepEqual(check(billing, null).blocks, []);
	});
});

describe("the derived properties of a row", () => {
	const SECTIONS = parseOpenLoopConfig(JSON.stringify({ open_loop_sections: ["action items"] })).sectionRe;
	const AT = new Date("2026-11-25T10:20:30.000Z");
	const body = "# Title\n\n## Action items\n\n- [ ] Call the vendor\n- [x] Done\n\n## Notes\n\n- [ ] A task under a different heading\n";

	test("a work row gets its size, its open tasks, its open loops, the time of the change, and the stamp, in one call", () => {
		const written = workNote({ Status: "active", Quarter: "Q1-2026" }, { body });
		assert.deepEqual(derivedUpdate(written, SECTIONS, AT), {
			page_id: written.id,
			command: "update_properties",
			properties: {
				Bytes: Buffer.byteLength(noteMarkdown(written)),
				"Open tasks": 2,
				"Open loops": 1,
				"date:Changed:start": "2026-11-25T10:20:30.000Z",
				"date:Changed:is_datetime": 1,
				"date:Hook stamp:start": "2026-11-25T10:20:30.000Z",
				"date:Hook stamp:is_datetime": 1,
			},
		});
	});

	test("a knowledge row gets `Has content` and no task counts, because the database has no such property", () => {
		const update = derivedUpdate(note({ place: row("knowledge"), properties: { ...GLOBAL, Type: "Brain topic" }, body: "- An entry\n" }), SECTIONS, AT);
		const properties = update?.["properties"] as Record<string, unknown>;
		assert.equal(properties["Has content"], "__YES__");
		assert.equal("Open tasks" in properties, false);
		assert.equal("Open loops" in properties, false);
	});

	test("a write that changed no body and no property of a person leaves `Changed` and sets the stamp", () => {
		const update = derivedUpdate(workNote({}, { changed: false }), SECTIONS, AT);
		const properties = update?.["properties"] as Record<string, unknown>;
		assert.equal("date:Changed:start" in properties, false);
		assert.equal(properties["date:Hook stamp:start"], "2026-11-25T10:20:30.000Z");
	});

	test("a page that is not a row gets no update", () => {
		for (const kind of ["page", "scaffold", "outside"] as const) assert.equal(derivedUpdate(note({ place: { kind } }), SECTIONS, AT), null);
	});

	test("a row that the check skips still gets its derived properties, because the views and the audit read them", () => {
		assert.notEqual(derivedUpdate(note({ place: row("work"), properties: { Type: "Thinking" } }), SECTIONS, AT), null);
	});
});
