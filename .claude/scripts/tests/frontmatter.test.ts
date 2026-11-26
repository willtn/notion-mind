/**
 * Unit tests for the frontmatter module: the declaration of the required
 * fields, the path test of the memory directory, and the ticket ID count.
 * The checks that read these are in write-check.test.ts.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { countTicketIdWikilinks, isBlockedMemoryPath, parseFrontmatterRequired } from "../lib/frontmatter.ts";
import { SCAFFOLD_SOURCES } from "../lib/notion-model.ts";

const VAULT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

describe("parseFrontmatterRequired", () => {
	test("each list of strings of the declaration is a field set", () => {
		const required = parseFrontmatterRequired({ frontmatter_required: { global: ["date", "owner"], "work-note": ["status"] } });
		assert.deepEqual(required, { global: ["date", "owner"], "work-note": ["status"] });
	});

	test("a set that is not a list, and a field that is not a text, are left out", () => {
		const required = parseFrontmatterRequired({ frontmatter_required: { global: "date", person: ["title", 7, ""], team: null } });
		assert.deepEqual(required, { person: ["title"] });
	});

	test("a manifest with no declaration, or with one that is not an object, gives no set", () => {
		for (const manifest of [null, {}, { frontmatter_required: ["date"] }, { frontmatter_required: "date" }]) {
			assert.deepEqual(parseFrontmatterRequired(manifest), {}, JSON.stringify(manifest));
		}
	});

	test("the shipped Work Note template declares every field the shipped manifest requires of a work note", () => {
		const manifest = JSON.parse(readFileSync(join(VAULT, "vault-manifest.json"), "utf-8"));
		const required = parseFrontmatterRequired(manifest);
		const template = readFileSync(join(VAULT, SCAFFOLD_SOURCES.template_work_note), "utf-8");
		const block = template.split(/\r?\n/).slice(1, template.split(/\r?\n/).indexOf("---", 1));
		const keys = new Set(block.flatMap((line) => /^([A-Za-z_][\w-]*)\s*:/.exec(line)?.[1] ?? []));
		const missing = [...(required["global"] ?? []), ...(required["work-note"] ?? [])].filter((field) => !keys.has(field));
		assert.deepEqual(missing, []);
	});
});

describe("isBlockedMemoryPath", () => {
	test("blocks non-MEMORY.md files in the auto-memory dir", () => {
		assert.equal(
			isBlockedMemoryPath("/u/x/.claude/projects/-p/memory/notes.md"),
			true,
		);
		assert.equal(
			isBlockedMemoryPath("C:\\u\\x\\.claude\\projects\\-p\\memory\\n.md"),
			true,
		);
	});
	test("allows MEMORY.md itself", () => {
		assert.equal(
			isBlockedMemoryPath("/u/x/.claude/projects/-p/memory/MEMORY.md"),
			false,
		);
	});
	test("requires both .claude and memory segments", () => {
		assert.equal(isBlockedMemoryPath("/vault/brain/Memories.md"), false);
		assert.equal(isBlockedMemoryPath("/u/x/.claude/projects/-p/transcripts/t.md"), false);
		assert.equal(isBlockedMemoryPath("/u/memory/notes.md"), false);
	});
	test("normalizes dot-dot segments before matching, both directions", () => {
		assert.equal(
			isBlockedMemoryPath("/u/.claude/projects/-p/transcripts/../memory/x.md"),
			true,
		);
		assert.equal(
			isBlockedMemoryPath("/u/.claude/projects/-p/memory/../transcripts/x.md"),
			false,
		);
	});
	test("collapses backslash-spelled dot-dot segments on any host", () => {
		// Separator unification must precede normalization, or this Windows
		// spelling would false-positive on POSIX hosts.
		assert.equal(
			isBlockedMemoryPath(
				"C:\\u\\.claude\\projects\\-p\\memory\\..\\transcripts\\x.md",
			),
			false,
		);
	});
});

describe("countTicketIdWikilinks", () => {
	test("counts a bare ticket ID, one with an alias, and one with an escaped pipe of a table", () => {
		assert.equal(countTicketIdWikilinks("See [[PROJ-1234]] and [[ABC-77|the ticket]]."), 2);
		assert.equal(countTicketIdWikilinks("| [[OPS-9\\|ops]] | [[OPS-10&#124;ops]] |"), 2);
	});

	test("a link to a note and a ticket ID in plain text do not count", () => {
		assert.equal(countTicketIdWikilinks("See PROJ-1234 (plain) and [[Architecture Notes]]."), 0);
	});

	test("a key has 2 to 10 capital letters", () => {
		assert.equal(countTicketIdWikilinks("[[A-1]] [[ABCDEFGHIJK-1]] [[ABCDEFGHIJ-1]] [[ab-1]]"), 1);
	});
});
