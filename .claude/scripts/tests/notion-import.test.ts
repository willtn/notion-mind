/**
 * notion-import.ts as a command: its options, and a dry run that reads a
 * vault and prints the plan with no Notion call.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "../notion-import.ts";
import { rmTemp } from "./_helpers.ts";

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "notion-import.ts");

describe("parseArgs", () => {
	test("reads each option, and needs --vault", () => {
		assert.deepEqual(parseArgs(["--vault", "v", "--root-title", "r", "--map", "m.json", "--ledger", "l", "--ledger-tag", "pr=11", "--verify"]), {
			vault: "v",
			"root-title": "r",
			map: "m.json",
			ledger: "l",
			"ledger-tag": "pr=11",
			verify: "true",
		});
		assert.throws(() => parseArgs(["--dry-run"]), /--vault <dir> is required/);
	});

	test("stops on an unknown option, a missing value, and --verify with --dry-run", () => {
		assert.throws(() => parseArgs(["--vault", "v", "--force"]), /Unknown option or missing value: --force/);
		assert.throws(() => parseArgs(["--vault"]), /Unknown option or missing value: --vault/);
		assert.throws(() => parseArgs(["--vault", "v", "--dry-run", "--verify"]), /Use one of them/);
	});
});

describe("notion-import.ts --dry-run", () => {
	test("prints the place of each note and each construct that loses form, with no mcporter on PATH", () => {
		const root = mkdtempSync(join(tmpdir(), "import-cli-"));
		try {
			mkdirSync(join(root, "vault", "work", "active"), { recursive: true });
			mkdirSync(join(root, "bin"));
			writeFileSync(join(root, "vault", "work", "active", "Billing.md"), "---\ntags: [work-note]\n---\n\n# Billing\n\nSee [[Missing Note]] and ==this==.\n");
			const run = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", "--experimental-strip-types", SCRIPT, "--vault", join(root, "vault"), "--dry-run"], {
				encoding: "utf8",
				env: { PATH: join(root, "bin") },
			});
			assert.equal(run.status, 0, run.stderr);
			assert.match(run.stdout, /notes read 1, pages planned 1, files left out 0/);
			assert.match(run.stdout, /\| work\/active\/Billing\.md \| Work \| Work note \| Billing \|/);
			assert.match(run.stdout, /\| unresolved link \| 1 \| 1 \| .* \| work\/active\/Billing\.md:7: `\[\[Missing Note\]\]` \|/);
			assert.equal(run.stderr, "");
		} finally {
			rmTemp(root);
		}
	});
});
