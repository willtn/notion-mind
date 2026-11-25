/**
 * Unit tests for the pure functions in .github/scripts/generate-changelog.ts —
 * commit classification, section generation, version normalization. The file-
 * system mutations and git invocations are exercised separately by the
 * release workflow on dry-run tags; these tests lock the parsing logic.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	classifyCommit,
	generateSection,
	normalizeVersion,
	bumpPluginJsonVersion,
	PLUGIN_JSON,
	insertChangelogSection,
} from "../../../.github/scripts/generate-changelog.ts";

describe("classifyCommit", () => {
	test("feat: → Added", () => {
		const r = classifyCommit("feat: add new hook");
		assert.equal(r.category, "Added");
		assert.equal(r.description, "add new hook");
	});

	test("fix: → Fixed", () => {
		const r = classifyCommit("fix: crash on empty input");
		assert.equal(r.category, "Fixed");
		assert.equal(r.description, "crash on empty input");
	});

	test("revert: → Fixed", () => {
		const r = classifyCommit("revert: broken migration");
		assert.equal(r.category, "Fixed");
	});

	test("docs: / refactor: / perf: / chore: / build: / style: → Changed", () => {
		for (const prefix of ["docs", "refactor", "perf", "chore", "build", "style"]) {
			const r = classifyCommit(`${prefix}: update something`);
			assert.equal(r.category, "Changed", `${prefix} should map to Changed`);
		}
	});

	test("ci: / test: / release: → null (skipped)", () => {
		for (const prefix of ["ci", "test", "release"]) {
			const r = classifyCommit(`${prefix}: noisy change`);
			assert.equal(r.category, null, `${prefix} should be skipped`);
		}
	});

	test("scoped prefix — feat(hooks): → Added", () => {
		const r = classifyCommit("feat(hooks): add stop-checklist");
		assert.equal(r.category, "Added");
		assert.equal(r.description, "add stop-checklist");
	});

	test("strips PR reference suffix (#25)", () => {
		const r = classifyCommit("feat: add thing (#25)");
		assert.equal(r.description, "add thing");
	});

	test("no prefix — capitalizes and goes to Changed", () => {
		const r = classifyCommit("some freeform commit");
		assert.equal(r.category, "Changed");
		assert.equal(r.description, "Some freeform commit");
	});

	test("unknown prefix falls through to Changed", () => {
		const r = classifyCommit("wizardry: mysterious change");
		assert.equal(r.category, "Changed");
	});
});

describe("generateSection", () => {
	test("groups commits by category in SECTION_ORDER", () => {
		const out = generateSection("v5.0", [
			"feat: add A",
			"fix: fix B",
			"docs: update C",
			"feat: add D",
		]);
		// Added section precedes Changed precedes Fixed per SECTION_ORDER
		const addedIdx = out.indexOf("### Added");
		const changedIdx = out.indexOf("### Changed");
		const fixedIdx = out.indexOf("### Fixed");
		assert.ok(addedIdx >= 0 && changedIdx >= 0 && fixedIdx >= 0);
		assert.ok(addedIdx < changedIdx);
		assert.ok(changedIdx < fixedIdx);
		assert.match(out, /- add A\n/);
		assert.match(out, /- add D\n/);
		assert.match(out, /- fix B\n/);
		assert.match(out, /- update C\n/);
	});

	test("skipped categories are not emitted", () => {
		const out = generateSection("v5.0", ["ci: flake fix", "test: coverage"]);
		assert.doesNotMatch(out, /### Added/);
		assert.doesNotMatch(out, /### Changed/);
		assert.doesNotMatch(out, /### Fixed/);
	});

	test("header carries the version", () => {
		const out = generateSection("v5.0", ["feat: add thing"]);
		assert.match(out, /^## v5\.0 — \d{4}-\d{2}-\d{2}/);
	});
});

describe("normalizeVersion", () => {
	// release.yml normalizes bare 'v5' → 'v5.0' before invoking this script,
	// so the input shape is always vX.Y or vX.Y.Z by contract.
	test("v5.2 → 5.2.0", () => {
		assert.equal(normalizeVersion("v5.2"), "5.2.0");
	});
	test("v5.2.3 → 5.2.3", () => {
		assert.equal(normalizeVersion("v5.2.3"), "5.2.3");
	});
	test("5.2 (no v) → 5.2.0", () => {
		assert.equal(normalizeVersion("5.2"), "5.2.0");
	});
	test("5.2.3 (no v) → 5.2.3", () => {
		assert.equal(normalizeVersion("5.2.3"), "5.2.3");
	});
});

describe("bumpPluginJsonVersion", () => {
	const FIXTURE = JSON.stringify({ name: "obsidian-mind", version: "8.6.0", description: "d", types: "./types/index.d.ts" }, null, 2) + "\n";

	test("sets the mod's version to the normalized release version, keeping key order", () => {
		const out = bumpPluginJsonVersion(FIXTURE, "v9.0");
		assert.equal(JSON.parse(out).version, "9.0.0");
		assert.deepEqual(Object.keys(JSON.parse(out)), ["name", "version", "description", "types"]);
		assert.ok(out.endsWith("}\n"));
	});

	test("refuses a plugin.json without a version", () => {
		assert.throws(() => bumpPluginJsonVersion('{"name":"obsidian-mind"}', "v9.0"), /no string `version`/);
	});

	test("the shipped mod carries the template's version", () => {
		const repo = join(dirname(fileURLToPath(import.meta.url)), "../../..");
		const plugin = JSON.parse(readFileSync(join(repo, PLUGIN_JSON), "utf-8")) as { version: string };
		const manifest = JSON.parse(readFileSync(join(repo, "vault-manifest.json"), "utf-8")) as { version: string };
		assert.equal(plugin.version, manifest.version, "a release bumps both; between releases they must agree");
	});
});

describe("insertChangelogSection", () => {
	test("inserts exactly one blank line after the header on first use", () => {
		const content = "# Changelog\n";
		const section = "## v1.0.0 — 2026-01-01\n\n### Added\n- first release\n";
		const out = insertChangelogSection(content, section, "v1.0.0");
		assert.equal(
			out,
			"# Changelog\n\n## v1.0.0 — 2026-01-01\n\n### Added\n- first release\n\n",
		);
	});

	test("does not accumulate blank lines across repeated releases", () => {
		// Regression test: prependToChangelog used to compute the post-header
		// insertion point correctly but then slice from index 0 up to that
		// point — which *keeps* every blank line already separating the
		// header from the first entry — before adding one more of its own.
		// Each simulated release used to grow the gap by one blank line.
		let content = "# Changelog\n";
		for (let i = 1; i <= 5; i++) {
			const version = `v1.${i}.0`;
			const section = `## ${version} — 2026-01-0${i}\n\n### Added\n- release ${i}\n`;
			content = insertChangelogSection(content, section, version);
		}
		assert.match(content, /^# Changelog\n\n## v1\.5\.0/);
		assert.doesNotMatch(content, /\n{3,}## v1\.5\.0/);
	});

	test("replaces an existing version's section in place instead of duplicating it", () => {
		const content = [
			"# Changelog",
			"",
			"## v2.0.0 — 2026-02-01",
			"",
			"### Added",
			"- old entry",
			"",
			"## v1.0.0 — 2026-01-01",
			"",
			"### Added",
			"- first release",
			"",
		].join("\n");
		const section = "## v2.0.0 — 2026-02-02\n\n### Added\n- corrected entry\n";
		const out = insertChangelogSection(content, section, "v2.0.0");
		assert.match(out, /- corrected entry/);
		assert.doesNotMatch(out, /- old entry/);
		assert.match(out, /- first release/);
		assert.equal((out.match(/## v2\.0\.0/g) ?? []).length, 1);
	});

	test("falls back to prepending a fresh header when none exists", () => {
		const out = insertChangelogSection("", "## v1.0.0 — 2026-01-01\n", "v1.0.0");
		assert.equal(out, "# Changelog\n\n## v1.0.0 — 2026-01-01\n\n");
	});
});
