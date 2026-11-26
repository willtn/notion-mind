/**
 * Layout pin (#321): `AGENTS.md` is the vault's one instruction file.
 *
 * Claude Code reads it natively when no `CLAUDE.md` is present. Claude-only guidance
 * lives in `.claude/rules/*.md`, which Claude Code loads beside it.
 *
 * What would quietly undo that:
 * - a `CLAUDE.md` back at the root: Claude Code reads it and skips
 *   `AGENTS.md` without saying so;
 * - `AGENTS.md` turned back into a pointer at another file, which an agent
 *   never follows unless told to;
 * - `AGENTS.md` growing past what the agents read: Antigravity cuts it off
 *   silently past ~24,000 bytes (measured).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { AGENTS_MD_MAX_BYTES } from "../lib/instruction-files.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("AGENTS.md is the one instruction file (#321)", () => {
	const agentsPath = resolve(repoRoot, "AGENTS.md");

	test("AGENTS.md exists and carries the conventions itself, not a pointer to another file", () => {
		assert.ok(existsSync(agentsPath), "AGENTS.md is missing from the vault root");
		const text = readFileSync(agentsPath, "utf-8");
		// Headings every agent needs at the moment of acting (#321: these stay
		// inline because a skipped pointer means a misplaced note or a record
		// never written).
		for (const heading of ["## Vault Structure", "### Note Types", "### Decision Records", "## Write-Correctness Laws", "## Rules"]) {
			assert.ok(text.includes(`\n${heading}\n`), `AGENTS.md lost its "${heading}" section`);
		}
		assert.doesNotMatch(text, /Read `CLAUDE\.md` for all vault conventions/, "AGENTS.md is a pointer to CLAUDE.md again");
	});

	test(`AGENTS.md stays under ${AGENTS_MD_MAX_BYTES} bytes`, () => {
		const size = statSync(agentsPath).size;
		assert.ok(
			size < AGENTS_MD_MAX_BYTES,
			`AGENTS.md is ${size} bytes, at or over the ${AGENTS_MD_MAX_BYTES}-byte threshold. Antigravity silently stops reading it at ~24,000 bytes (measured). Move a section an agent can safely skip to a file it reads on demand, verbatim, and leave a one-line pointer (#321).`,
		);
	});

	test("AGENTS.md is LF-only, so its size is the same on every checkout", () => {
		// .gitattributes forces eol=lf; a CRLF checkout would add a byte per
		// line (~300) and move the file toward the cap on Windows only.
		assert.ok(!readFileSync(agentsPath, "utf-8").includes("\r"), "AGENTS.md has CRLF line endings");
	});

	test("no CLAUDE.md at the vault root", () => {
		// Claude Code reads a CLAUDE.md in place of AGENTS.md, silently.
		assert.ok(!existsSync(resolve(repoRoot, "CLAUDE.md")), "CLAUDE.md is back at the root: Claude Code reads it and skips AGENTS.md");
	});

	/** The `.claude/rules/*.md` files AGENTS.md's pointers name. */
	const pointerTargets = (): string[] => [
		...new Set([...readFileSync(agentsPath, "utf-8").matchAll(/`(\.claude\/rules\/[\w.-]+\.md)`/g)].map((m) => m[1]!)),
	];
	test("every rules file AGENTS.md points at exists and is non-empty", () => {
		const targets = pointerTargets();
		assert.ok(targets.length > 0, "AGENTS.md names no .claude/rules/ file: the moved sections have no pointer");
		for (const t of targets) {
			const p = resolve(repoRoot, t);
			assert.ok(existsSync(p), `AGENTS.md points at ${t}, which does not exist`);
			assert.ok(readFileSync(p, "utf-8").trim().length > 0, `${t} is empty`);
		}
	});

	test("AGENTS.md points at every rules file, so it is the index of the rules", () => {
		const targets = new Set(pointerTargets());
		const dir = resolve(repoRoot, ".claude/rules");
		for (const f of readdirSync(dir).filter((n) => n.endsWith(".md"))) {
			assert.ok(targets.has(`.claude/rules/${f}`), `.claude/rules/${f}: AGENTS.md never points at it`);
		}
	});

	test("every .claude/rules/*.md exists and is non-empty", () => {
		const dir = resolve(repoRoot, ".claude/rules");
		assert.ok(existsSync(dir), ".claude/rules/ is missing: the Claude-only guidance has nowhere to load from");
		const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
		for (const name of ["skills.md", "subagents.md", "memory.md", "hooks-and-mod.md"]) {
			assert.ok(files.includes(name), `.claude/rules/${name} is missing`);
		}
		for (const f of files) {
			assert.ok(readFileSync(resolve(dir, f), "utf-8").trim().length > 0, `.claude/rules/${f} is empty`);
		}
	});
});
