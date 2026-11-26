/**
 * lib/notion-options.ts: the schema statements that add the options that a
 * write needs, and lib/notion-derived.ts and the map path of
 * lib/notion-map.ts, which the write path shares.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { parseOpenLoopConfig } from "../lib/active-hygiene.ts";
import type { NotionClient, NotionReply } from "../lib/notion-client.ts";
import { derivedValues } from "../lib/notion-derived.ts";
import { NOTION_MAP_ENV, notionMapPath } from "../lib/notion-map.ts";
import { ensureSelectOptions, optionStatements } from "../lib/notion-options.ts";
import type { LiveProperty } from "../lib/notion-parse.ts";

const property = (name: string, type: string, options: readonly string[] = []): LiveProperty => ({
	name,
	type,
	options: options.map((option) => ({ name: option, color: "gray" })),
	target: undefined,
});
const live = { Quarter: property("Quarter", "select"), Tags: property("Tags", "multi_select", ["brain", "person"]), Role: property("Role", "text") };

describe("optionStatements", () => {
	test("adds each option that the schema lacks, after the live options", () => {
		const plan = optionStatements(live, { Quarter: ["Q1-2026"], Tags: ["meeting", "brain", "reference", "meeting"] });
		assert.equal(plan.added, 3);
		assert.deepEqual(plan.statements, [
			`ALTER COLUMN "Quarter" SET SELECT('Q1-2026':blue)`,
			`ALTER COLUMN "Tags" SET MULTI_SELECT('brain':gray, 'person':gray, 'meeting':purple, 'reference':orange)`,
		]);
	});

	test("gives no statement when the schema holds each value", () => {
		assert.deepEqual(optionStatements(live, { Tags: ["person", "brain"] }), { statements: [], added: 0 });
	});

	test("stops on a property that is not a select, and on a property that the schema does not have", () => {
		assert.throws(() => optionStatements(live, { Role: ["Staff"] }), /"Role" is not a select/);
		assert.throws(() => optionStatements(live, { Project: ["Pricing"] }), /"Project" is not a select/);
	});

	test("stops on a value that Notion cannot keep as one option", () => {
		assert.throws(() => optionStatements(live, { Tags: ["a,b"] }), /"a,b" cannot be an option of "Tags"/);
		assert.throws(() => optionStatements(live, { Quarter: [" "] }), /cannot be an option of "Quarter"/);
	});
});

describe("ensureSelectOptions", () => {
	const databaseReply = (options: readonly string[]): NotionReply => {
		const schema = { schema: { Name: { type: "title" }, Tags: { type: "multi_select", options: options.map((name) => ({ name, color: "gray" })) } } };
		const text = [
			`<database url="https://app.notion.com/p/00000000000000000000000000000001">`,
			"The title of this Database is: Work",
			`<data-source url="collection://00000000-0000-0000-0000-000000000002">`,
			"<data-source-state>",
			JSON.stringify(schema),
			"</data-source-state>",
			"</data-source>",
			"</database>",
		].join("\n");
		return { text, json: undefined };
	};
	const fakeClient = (options: string[]): { client: NotionClient; calls: { tool: string; args: unknown }[] } => {
		const calls: { tool: string; args: unknown }[] = [];
		const client: NotionClient = {
			call: async (tool, args = {}) => {
				calls.push({ tool, args });
				if (tool === "notion-update-data-source") options.push(...[...String(args["statements"]).matchAll(/'([^']+)':/g)].map((m) => m[1] ?? "").filter((name) => !options.includes(name)));
				return databaseReply(options);
			},
			close: async () => {},
		};
		return { client, calls };
	};
	const database = { id: "00000000-0000-0000-0000-000000000001", data_source: "collection://00000000-0000-0000-0000-000000000002" };

	test("the first call adds the options in one schema update, and the second call makes no update", async () => {
		const { client, calls } = fakeClient(["brain"]);
		assert.equal(await ensureSelectOptions(client, database, { Tags: ["meeting", "reference"] }), 2);
		assert.deepEqual(calls.map((call) => call.tool), ["notion-fetch", "notion-update-data-source"]);
		assert.deepEqual(calls[1]?.args, { data_source_id: database.data_source, statements: `ALTER COLUMN "Tags" SET MULTI_SELECT('brain':gray, 'meeting':green, 'reference':purple)` });

		assert.equal(await ensureSelectOptions(client, database, { Tags: ["meeting", "reference"] }), 0);
		assert.deepEqual(calls.slice(2).map((call) => call.tool), ["notion-fetch"]);
	});
});

describe("derivedValues", () => {
	const sections = parseOpenLoopConfig(JSON.stringify({ open_loop_sections: ["action items", "follow ups"] })).sectionRe;
	const text = "---\ndate: 2026-01-05\n---\n\n# Note\n\nWaiting on the vendor.\n\n- [ ] A task outside a section\n\n## Follow Ups\n\n- [ ] Send the summary\n- [x] Done\n";

	test("counts the bytes of the whole text, the open tasks, and the open loops of the configured sections", () => {
		assert.deepEqual(derivedValues(text, sections), { bytes: Buffer.byteLength(text), openTasks: 2, openLoops: 2, hasContent: true });
	});

	test("counts bytes, not characters, and sees no content in a body without a list item", () => {
		const plain = "---\ndescription: é\n---\n\n# Gotchas\n\nNo entry yet.\n";
		assert.deepEqual(derivedValues(plain, sections), { bytes: plain.length + 1, openTasks: 0, openLoops: 0, hasContent: false });
	});

	test("a list item in the properties block is not content", () => {
		assert.equal(derivedValues("---\ntags:\n  - brain\n---\n\nNo entry yet.\n", sections).hasContent, false);
	});
});

describe("notionMapPath", () => {
	test("is notion-map.json in the project directory, and the variable replaces it", () => {
		assert.equal(notionMapPath("/project", {}), join("/project", "notion-map.json"));
		assert.equal(notionMapPath("/project", { [NOTION_MAP_ENV]: "" }), join("/project", "notion-map.json"));
		assert.equal(notionMapPath("/project", { [NOTION_MAP_ENV]: "/elsewhere/map.json" }), "/elsewhere/map.json");
	});
});
