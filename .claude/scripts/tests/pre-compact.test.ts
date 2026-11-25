/**
 * Unit tests for pre-compact helpers: timestamp format and retention-based pruning.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, readdirSync, utimesSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
	formatTimestamp,
	listBackups,
	pruneBackups,
} from "../pre-compact.ts";

import { rmTemp, runScript } from "./_helpers.ts";

const PRE_COMPACT = resolve(dirname(fileURLToPath(import.meta.url)), "../pre-compact.ts");

describe("pre-compact hook run with a Claude PreCompact payload", () => {
	const withVault = (run: (vault: string, transcript: string) => void): void => {
		const root = mkdtempSync(join(tmpdir(), "pre-compact-hook-"));
		try {
			const vault = join(root, "vault");
			mkdirSync(vault);
			const transcript = join(root, "transcript.jsonl");
			writeFileSync(transcript, '{"role":"user"}\n');
			run(vault, transcript);
		} finally {
			rmTemp(root);
		}
	};
	const payload = (transcript: string) => ({
		hook_event_name: "PreCompact",
		session_id: "cc-backup",
		trigger: "auto",
		transcript_path: transcript,
	});

	test("copies the transcript into thinking/session-logs and exits 0", () => {
		withVault((vault, transcript) => {
			const r = runScript(PRE_COMPACT, payload(transcript), { CLAUDE_PROJECT_DIR: vault });
			assert.equal(r.code, 0);
			const logs = join(vault, "thinking", "session-logs");
			const files = existsSync(logs) ? readdirSync(logs) : [];
			assert.equal(files.length, 1, "one backup lands");
			assert.match(files[0]!, /^session_auto_\d{8}_\d{6}\.jsonl$/);
			assert.equal(readFileSync(join(logs, files[0]!), "utf8"), '{"role":"user"}\n', "the backup holds the transcript");
		});
	});

	test("a backup that throws still exits 0", () => {
		withVault((vault, transcript) => {
			// A file where the backup folder goes, so its mkdir throws.
			writeFileSync(join(vault, "thinking"), "");
			const r = runScript(PRE_COMPACT, payload(transcript), { CLAUDE_PROJECT_DIR: vault });
			assert.equal(r.code, 0);
		});
	});

	test("a missing transcript exits 0 and leaves no backup", () => {
		withVault((vault, transcript) => {
			const r = runScript(PRE_COMPACT, payload(join(transcript, "gone")), { CLAUDE_PROJECT_DIR: vault });
			assert.equal(r.code, 0);
			const logs = join(vault, "thinking", "session-logs");
			assert.equal(existsSync(logs) ? readdirSync(logs).length : 0, 0);
		});
	});
});

describe("formatTimestamp", () => {
	test("pads single digits (YYYYMMDD_HHMMSS)", () => {
		const d = new Date(2026, 3, 5, 9, 7, 3); // month is 0-indexed → April
		assert.equal(formatTimestamp(d), "20260405_090703");
	});
	test("two-digit components pass through", () => {
		const d = new Date(2026, 9, 31, 23, 59, 59); // October 31
		assert.equal(formatTimestamp(d), "20261031_235959");
	});
});

describe("listBackups + pruneBackups", () => {
	let dir = "";

	before(() => {
		dir = mkdtempSync(join(tmpdir(), "pre-compact-test-"));
	});

	after(() => {
		rmTemp(dir);
	});

	function makeBackup(name: string, ageSeconds: number): void {
		const path = join(dir, name);
		writeFileSync(path, "stub");
		const t = Date.now() / 1000 - ageSeconds;
		utimesSync(path, t, t);
	}

	test("lists only session_*.jsonl, sorted newest-first", () => {
		makeBackup("session_a_20260101_000000.jsonl", 100);
		makeBackup("session_b_20260102_000000.jsonl", 50);
		makeBackup("session_c_20260103_000000.jsonl", 10);
		writeFileSync(join(dir, "unrelated.txt"), "nope");
		writeFileSync(join(dir, "session_missing_suffix"), "nope");

		const ordered = listBackups(dir);
		assert.deepEqual(ordered, [
			"session_c_20260103_000000.jsonl",
			"session_b_20260102_000000.jsonl",
			"session_a_20260101_000000.jsonl",
		]);
	});

	test("prune keeps N newest by mtime", () => {
		pruneBackups(dir, 2);
		const remaining = readdirSync(dir)
			.filter((f) => f.startsWith("session_") && f.endsWith(".jsonl"))
			.sort();
		assert.deepEqual(remaining, [
			"session_b_20260102_000000.jsonl",
			"session_c_20260103_000000.jsonl",
		]);
	});

	test("prune with retain ≥ count is a no-op", () => {
		const before = readdirSync(dir).length;
		pruneBackups(dir, 100);
		const after = readdirSync(dir).length;
		assert.equal(before, after);
	});

	test("listBackups on missing dir returns []", () => {
		assert.deepEqual(listBackups("/nonexistent/dir/xyz"), []);
	});
});
