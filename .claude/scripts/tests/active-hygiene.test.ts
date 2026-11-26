/**
 * Unit tests for lib/active-hygiene.ts: the rules and the wording that the
 * hygiene scan of Notion and the write check share.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	HYGIENE_LIST_CAP,
	agentsMdLine,
	agentsMdPastFlag,
	countOpenLoops,
	formatMonolithHint,
	instructionFileFindings,
	leftoverLine,
	namesCapped,
	isMonolithExempt,
	topicClusters,
	parseOpenLoopConfig,
} from "../lib/active-hygiene.ts";

import { AGENTS_MD_FLAG_BYTES, AGENTS_MD_MAX_BYTES } from "../lib/instruction-files.ts";
import { rmTemp } from "./_helpers.ts";

const DEFAULTS = parseOpenLoopConfig(null);

describe("parseOpenLoopConfig", () => {
	test("defaults when manifest is null or lacks the fields", () => {
		const cfg = parseOpenLoopConfig(null);
		assert.equal(cfg.sectionRe.test("## Action Items"), true);
		assert.equal(cfg.sectionRe.test("### What to Watch"), true);
		assert.equal(cfg.sectionRe.test("## Notes"), false);
	});
	test("manifest overrides the sections", () => {
		const cfg = parseOpenLoopConfig(
			JSON.stringify({
				open_loop_sections: ["next steps"],
			}),
		);
		assert.equal(cfg.sectionRe.test("## Next Steps"), true);
		assert.equal(cfg.sectionRe.test("## Action Items"), false);
	});
	test("malformed values fall back to defaults (incl. regex metachars escaped)", () => {
		const cfg = parseOpenLoopConfig(
			JSON.stringify({ open_loop_sections: [42] }),
		);
		assert.equal(cfg.sectionRe.test("## Action Items"), true);
		const meta = parseOpenLoopConfig(
			JSON.stringify({ open_loop_sections: ["a.b (c)"] }),
		);
		assert.equal(meta.sectionRe.test("## a.b (c)"), true);
		assert.equal(meta.sectionRe.test("## aXb (c)"), false);
	});
});

describe("countOpenLoops", () => {
	test("counts unchecked boxes only inside configured sections", () => {
		const note = [
			"# 1:1",
			"## Action Items",
			"- [ ] chase reply",
			"- [x] done thing",
			"## Notes",
			"- [ ] checkbox outside a follow-up section",
		].join("\n");
		assert.equal(countOpenLoops(note, DEFAULTS.sectionRe), 1);
	});
	test("counts waiting-on / watch-for phrase lines anywhere", () => {
		assert.equal(
			countOpenLoops("waiting on legal\nWatch for the rollout\n", DEFAULTS.sectionRe),
			2,
		);
	});
	test("clean note counts zero", () => {
		assert.equal(countOpenLoops("# all wrapped\n", DEFAULTS.sectionRe), 0);
	});
});

describe("write-time detectors", () => {
	test("topicClusters gives the cluster of each title word that 2 or more names share, and none for fewer than 4 names", () => {
		const names = ["Payments Migration", "Payments Ledger", "Search Ranking", "Login Latency"];
		assert.deepEqual(topicClusters(names), [{ token: "payments", files: ["Payments Ledger", "Payments Migration"] }]);
		assert.deepEqual(topicClusters(names.slice(0, 3)), []);
	});

	test("a word in more than half of the names is not a topic", () => {
		assert.deepEqual(topicClusters(["Payments A1", "Payments B2", "Payments C3", "Login Latency"]), []);
	});

	test("the size hint carries the judgment framing", () => {
		const mono = formatMonolithHint("work/Fat.md", 42_000);
		assert.match(mono, /Do NOT trim/);
		assert.match(mono, /42KB/);
	});

	test("isMonolithExempt covers Archive names only", () => {
		assert.equal(isMonolithExempt("Delivery Log Archive.md"), true);
		assert.equal(isMonolithExempt("Delivery Log.md"), false);
	});

	test("a cluster's file names are capped on its line (#254)", () => {
		const files = Array.from({ length: HYGIENE_LIST_CAP + 3 }, (_, i) => `n${i}.md`);
		assert.equal(namesCapped(files.slice(0, HYGIENE_LIST_CAP)), files.slice(0, HYGIENE_LIST_CAP).join(", "));
		assert.match(namesCapped(files), /, n9\.md, … and 3 more$/);
	});
});

describe("leftover CLAUDE.md beside AGENTS.md (#321)", () => {
	// A vault upgraded past the single-instruction-file release keeps a
	// CLAUDE.md the user edited (their bytes survive the update). Claude Code
	// then reads CLAUDE.md and silently skips AGENTS.md, so the hygiene scan
	// says so at every session boundary until it is moved out.
	const withFiles = (names: readonly string[], run: (root: string) => void): void => {
		const root = mkdtempSync(join(tmpdir(), "leftover-claude-md-"));
		try {
			for (const n of names) writeFileSync(join(root, n), "# Vault\n");
			run(root);
		} finally {
			rmTemp(root);
		}
	};

	test("flags a CLAUDE.md sitting beside AGENTS.md, with what to do about it", () => {
		withFiles(["AGENTS.md", "CLAUDE.md"], (root) => {
			assert.equal(instructionFileFindings(root).leftoverInstructionFiles.includes("CLAUDE.md"), true);
			assert.match(
				leftoverLine("CLAUDE.md"),
				/CLAUDE\.md present beside AGENTS\.md — Claude Code reads CLAUDE\.md and skips AGENTS\.md; move your additions to \.claude\/rules\/ and delete it\./,
			);
		});
	});

	test("silent with AGENTS.md alone", () => {
		withFiles(["AGENTS.md"], (root) => {
			assert.equal(instructionFileFindings(root).leftoverInstructionFiles.includes("CLAUDE.md"), false);
			assert.equal(agentsMdPastFlag(root), null);
		});
	});

	test("a differently cased claude.md flags exactly where the filesystem resolves it as CLAUDE.md", () => {
		// Windows and macOS resolve names case-insensitively, so Claude Code
		// finds a `claude.md` there as CLAUDE.md, and the flag must say so; on
		// a case-sensitive filesystem neither finds it.
		withFiles(["AGENTS.md", "claude.md"], (root) => {
			const resolves = existsSync(join(root, "CLAUDE.md"));
			assert.equal(instructionFileFindings(root).leftoverInstructionFiles.includes("CLAUDE.md"), resolves);
		});
	});

	test("AGENTS.md near where Antigravity stops reading is flagged, with the agent that cuts it off", () => {
		withFiles([], (root) => {
			writeFileSync(join(root, "AGENTS.md"), "x".repeat(AGENTS_MD_FLAG_BYTES));
			assert.deepEqual(agentsMdPastFlag(root), { sizeKb: 23 });
			assert.match(agentsMdLine(23), /AGENTS\.md is 23KB[\s\S]*Antigravity stopped reading it at ~24,000 bytes/);
		});
		withFiles([], (root) => {
			writeFileSync(join(root, "AGENTS.md"), "x".repeat(AGENTS_MD_FLAG_BYTES - 1));
			assert.equal(agentsMdPastFlag(root), null);
		});
	});

	test("a vault's AGENTS.md has room to grow past the template's own cap before it is flagged", () => {
		// The template's test holds the shipped file under AGENTS_MD_MAX_BYTES;
		// the vault flag sits nearer the measured cutoff (byte 23,860 was still
		// read), so a user's first additions are not a finding.
		assert.ok(AGENTS_MD_FLAG_BYTES >= AGENTS_MD_MAX_BYTES + 1000);
		assert.ok(AGENTS_MD_FLAG_BYTES < 23_860);
	});

	test("silent for a vault that has not upgraded yet (CLAUDE.md, no AGENTS.md)", () => {
		withFiles(["CLAUDE.md"], (root) => {
			assert.equal(instructionFileFindings(root).leftoverInstructionFiles.includes("CLAUDE.md"), false);
		});
	});
});
