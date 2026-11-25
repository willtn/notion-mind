/**
 * lib/notion-synced.ts: the Current Focus section of Home. The page texts
 * follow replies of the hosted Notion MCP server for the North Star scaffold
 * and for a synced block, with the IDs replaced. The live runs in the pull
 * request prove the same steps against Notion itself.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { NotionClient, NotionReply } from "../lib/notion-client.ts";
import { NotionError } from "../lib/notion-client.ts";
import { SYNCED_SECTIONS } from "../lib/notion-model.ts";
import { notionId } from "../lib/notion-parse.ts";
import { ensureSyncedSection, referenceInsert, sectionBody, syncedBlockUrl, wrapSection, type CreatedBlock } from "../lib/notion-synced.ts";

const NORTH_STAR = `A living document of goals.

## Current Focus

<i>What am I working toward right now?</i>

<ul>
<li></li>
</ul>

## Goals

### Short-term (This Quarter)

<ul>
<li></li>
</ul>
`;

const BLOCK_URL = "https://app.notion.com/p/aaaaaaaabbbb4ccc8dddeeeeeeeeeeee#11111111222233334444555555555555";
const SYNCED_NORTH_STAR = NORTH_STAR.replace(
	"<i>What am I working toward right now?</i>\n\n<ul>\n<li></li>\n</ul>",
	`<synced-block url="${BLOCK_URL}">\n<i>What am I working toward right now?</i>\n\n<ul>\n<li></li>\n</ul>\n</synced-block>`,
);

describe("sectionBody", () => {
	test("is the text under the heading, up to the next section", () => {
		assert.equal(sectionBody(NORTH_STAR, "Current Focus"), "<i>What am I working toward right now?</i>\n\n<ul>\n<li></li>\n</ul>");
	});

	test("keeps a subheading and stops at the next heading of the same level", () => {
		assert.equal(sectionBody(NORTH_STAR, "Goals"), "### Short-term (This Quarter)\n\n<ul>\n<li></li>\n</ul>");
	});

	test("is undefined when the page has no such section", () => {
		assert.equal(sectionBody(NORTH_STAR, "Anti-goals"), undefined);
	});
});

describe("syncedBlockUrl", () => {
	test("finds the URL of the original block, and nothing in a section without one", () => {
		assert.equal(syncedBlockUrl(SYNCED_NORTH_STAR, "Current Focus"), BLOCK_URL);
		assert.equal(syncedBlockUrl(NORTH_STAR, "Current Focus"), undefined);
	});

	test("does not take a reference for the original", () => {
		const home = `## Current Focus\n\n<synced-block-reference url="${BLOCK_URL}">\ntext\n</synced-block-reference>\n`;
		assert.equal(syncedBlockUrl(home, "Current Focus"), undefined);
	});
});

describe("wrapSection", () => {
	test("replaces the section with the same text inside a synced block", () => {
		const wrap = wrapSection(NORTH_STAR, "Current Focus");
		assert.ok(wrap);
		assert.equal(wrap.old_str, "## Current Focus\n\n<i>What am I working toward right now?</i>\n\n<ul>\n<li></li>\n</ul>");
		assert.equal(wrap.new_str, "## Current Focus\n\n<synced-block>\n\t<i>What am I working toward right now?</i>\n\n\t<ul>\n\t<li></li>\n\t</ul>\n</synced-block>");
		assert.equal(NORTH_STAR.split(wrap.old_str).length - 1, 1);
	});

	test("does nothing for a section that is a synced block already", () => {
		assert.equal(wrapSection(SYNCED_NORTH_STAR, "Current Focus"), undefined);
	});

	test("stops with a clear error when the section is missing or empty", () => {
		assert.throws(() => wrapSection("## Goals\n\ntext\n", "Current Focus"), /no "## Current Focus" section/);
		assert.throws(() => wrapSection("## Current Focus\n\n## Goals\n", "Current Focus"), /no text/);
	});
});

describe("referenceInsert", () => {
	const home = "## Open Questions\n\n<ul>\n<li></li>\n</ul>\n";

	test("gives the section with the reference to a page that lacks it", () => {
		assert.equal(referenceInsert(home, "Current Focus", BLOCK_URL), `## Current Focus\n\n<synced-block-reference url="${BLOCK_URL}"></synced-block-reference>\n`);
	});

	test("gives nothing to a page that shows the original, with the children that Notion adds", () => {
		const shown = `## Current Focus\n\n<synced-block-reference url="${BLOCK_URL}">\ntext\n</synced-block-reference>\n\n${home}`;
		assert.equal(referenceInsert(shown, "Current Focus", BLOCK_URL), undefined);
	});

	test("stops when the page has the section but it does not show this original", () => {
		assert.throws(() => referenceInsert("## Current Focus\n\nplain text\n", "Current Focus", BLOCK_URL), /does not show the original/);
		const other = `## Current Focus\n\n<synced-block-reference url="${BLOCK_URL.replace("aaaaaaaa", "bbbbbbbb")}"></synced-block-reference>\n`;
		assert.throws(() => referenceInsert(other, "Current Focus", BLOCK_URL), /does not show the original/);
	});
});

/** Two pages in memory. Only the three calls of the step exist, and a reference shows the children of its original. */
function fakeNotion(original: string, copy: string) {
	const pages = new Map<string, string>([
		["aaaaaaaa-0000-4000-8000-000000000001", original],
		["aaaaaaaa-0000-4000-8000-000000000002", copy],
	]);
	const writes: string[] = [];
	let blocks = 0;
	const originalOf = (url: string): string => {
		for (const text of pages.values()) {
			const match = text.match(new RegExp(`<synced-block url="${url.replace(/[#.]/g, "\\$&")}">\\n([\\s\\S]*?)\\n</synced-block>`));
			if (match !== null) return match[1] ?? "";
		}
		return "";
	};
	const reply = (text: string): NotionReply => ({ text: JSON.stringify({ text }), json: { text } });
	const client: NotionClient = {
		async call(tool, args = {}) {
			const id = String(args["id"] ?? args["page_id"]);
			const text = pages.get(id);
			if (text === undefined) throw new NotionError("tool_error", `no page ${id}`, tool);
			if (tool === "notion-fetch") {
				const shown = text.replace(/<synced-block-reference url="([^"]+)"><\/synced-block-reference>/g, (_, url: string) => `<synced-block-reference url="${url}">\n${originalOf(url)}\n</synced-block-reference>`);
				return reply(`<page url="https://app.notion.com/p/${id.replace(/-/g, "")}">\n<content>\n${shown}\n</content>\n</page>`);
			}
			assert.equal(tool, "notion-update-page");
			writes.push(`${args["command"]} ${id.slice(-1)}`);
			if (args["command"] === "update_content") {
				let next = text;
				for (const update of args["content_updates"] as { old_str: string; new_str: string }[]) {
					if (next.split(update.old_str).length !== 2) throw new NotionError("tool_error", "old_str did not match once", tool);
					const url = `https://app.notion.com/p/${id.replace(/-/g, "")}#${String(++blocks).padStart(32, "0")}`;
					next = next.replace(update.old_str, update.new_str.replace("<synced-block>", `<synced-block url="${url}">`).replace(/^\t/gm, ""));
				}
				pages.set(id, next);
			} else {
				assert.deepEqual(args["position"], { type: "start" });
				pages.set(id, `${String(args["content"])}\n${text}`);
			}
			return reply(JSON.stringify({ page_id: id }));
		},
		async close() {},
	};
	return { client, writes, pages };
}

describe("ensureSyncedSection", () => {
	const [sync] = SYNCED_SECTIONS;
	assert.ok(sync);
	const ids = { original: "aaaaaaaa-0000-4000-8000-000000000001", copy: "aaaaaaaa-0000-4000-8000-000000000002" };
	const HOME = "## Open Questions\n\n<ul>\n<li></li>\n</ul>\n";

	test("the model makes Home show the Current Focus of North Star", () => {
		assert.deepEqual(sync, { section: "Current Focus", original: "north_star", copy: "home" });
	});

	test("makes the block and the reference, then a second run makes nothing", async () => {
		const { client, writes, pages } = fakeNotion(NORTH_STAR, HOME);
		const created: CreatedBlock[] = [];
		await ensureSyncedSection(client, sync, ids, (block) => created.push(block), () => {});
		const originalBlock = notionId(`${"0".repeat(31)}1`);
		assert.deepEqual(created.slice(), [
			{ id: originalBlock, title: "synced block: Current Focus", parentId: ids.original },
			{ id: undefined, title: "synced block reference: Current Focus", parentId: ids.copy, syncedFrom: originalBlock },
		]);
		assert.deepEqual(writes, ["update_content 1", "insert_content 2"]);
		assert.match(pages.get(ids.copy) ?? "", /^## Current Focus\n\n<synced-block-reference url="[^"]+"><\/synced-block-reference>\n/);

		await ensureSyncedSection(client, sync, ids, (block) => created.push(block), () => {});
		assert.equal(created.length, 2);
		assert.equal(writes.length, 2);
	});

	test("never reports the ID of the page that holds a block as the ID of the block", async () => {
		const { client } = fakeNotion(NORTH_STAR, HOME);
		const created: CreatedBlock[] = [];
		await ensureSyncedSection(client, sync, ids, (block) => created.push(block), () => {});
		for (const block of created) assert.ok(block.id !== ids.original && block.id !== ids.copy, `${block.title} has the ID of a page`);
	});

	test("keeps the text that the user wrote in the section, and Home shows it", async () => {
		const edited = NORTH_STAR.replace("<ul>\n<li></li>\n</ul>\n\n## Goals", "<ul>\n<li>Ship the Notion port</li>\n</ul>\n\n## Goals");
		const { client, pages } = fakeNotion(edited, HOME);
		await ensureSyncedSection(client, sync, ids, () => {}, () => {});
		assert.match(pages.get(ids.original) ?? "", /<synced-block url="[^"]+">\n<i>What am I working toward right now\?<\/i>\n\n<ul>\n<li>Ship the Notion port<\/li>\n<\/ul>\n<\/synced-block>/);
		const shown = await client.call("notion-fetch", { id: ids.copy });
		assert.match(shown.text, /<li>Ship the Notion port<\/li>/);
	});

	test("makes only the reference when the block exists, and nothing for a page that has both", async () => {
		const withReference = `## Current Focus\n\n<synced-block-reference url="${BLOCK_URL}"></synced-block-reference>\n\n${HOME}`;
		const { client, writes } = fakeNotion(SYNCED_NORTH_STAR, HOME);
		const created: CreatedBlock[] = [];
		await ensureSyncedSection(client, sync, ids, (block) => created.push(block), () => {});
		assert.deepEqual(created, [{ id: undefined, title: "synced block reference: Current Focus", parentId: ids.copy, syncedFrom: notionId(BLOCK_URL.split("#")[1] ?? "") }]);
		assert.deepEqual(writes, ["insert_content 2"]);

		const complete = fakeNotion(SYNCED_NORTH_STAR, withReference);
		const existing: CreatedBlock[] = [];
		await ensureSyncedSection(complete.client, sync, ids, () => assert.fail("made a block"), (block) => existing.push(block));
		assert.deepEqual(complete.writes, []);
		const originalBlock = notionId(BLOCK_URL.split("#")[1] ?? "");
		assert.deepEqual(existing, [
			{ id: originalBlock, title: "synced block: Current Focus", parentId: ids.original },
			{ id: undefined, title: "synced block reference: Current Focus", parentId: ids.copy, syncedFrom: originalBlock },
		]);
	});

	test("reports the original block that exists when it makes the reference, and never reports a block that it made as existing", async () => {
		const existing: CreatedBlock[] = [];
		const made: CreatedBlock[] = [];
		await ensureSyncedSection(fakeNotion(SYNCED_NORTH_STAR, HOME).client, sync, ids, (block) => made.push(block), (block) => existing.push(block));
		assert.deepEqual(existing.map((block) => block.title), ["synced block: Current Focus"]);
		assert.deepEqual(made.map((block) => block.title), ["synced block reference: Current Focus"]);

		const fresh: CreatedBlock[] = [];
		await ensureSyncedSection(fakeNotion(NORTH_STAR, HOME).client, sync, ids, () => {}, (block) => fresh.push(block));
		assert.deepEqual(fresh, []);
	});
});
