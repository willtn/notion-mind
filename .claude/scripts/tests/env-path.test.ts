/**
 * Paths the environment may override for the hooks' state files (#360). An
 * empty or blank value counts as unset: passed through as the path "", a state
 * file could be neither read nor written, and a dedupe or debounce built on it
 * stopped working with no sign. The Stop checklist's dedupe store, the
 * classifier's hint store and the Stop handoff folder are all read this way.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { envPath } from "../lib/env-path.ts";

const SCRIPTS = dirname(dirname(fileURLToPath(import.meta.url)));

describe("envPath", () => {
	const fallback = join("scripts", "dir", ".state.json");

	test("unset is the fallback", () => {
		assert.equal(envPath({}, "SOME_STATE", fallback), fallback);
	});

	test("empty or blank is unset too, not the path \"\"", () => {
		assert.equal(envPath({ SOME_STATE: "" }, "SOME_STATE", fallback), fallback);
		assert.equal(envPath({ SOME_STATE: "  " }, "SOME_STATE", fallback), fallback);
	});

	test("a set value is honoured as given", () => {
		const mine = join("elsewhere", "my.state");
		assert.equal(envPath({ SOME_STATE: mine }, "SOME_STATE", fallback), mine);
	});
});

// Every one of these is read through envPath, never with a bare `??` again.
test("no script reads a state-path variable directly", () => {
	const names = ["STOP_CHECKLIST_STATE", "CLASSIFY_HINT_STATE", "STOP_HANDOFF_DIR"];
	const direct = new RegExp(`process\\.env(?:\\[["'](?:${names.join("|")})["']\\]|\\.(?:${names.join("|")})\\b)`);
	const walk = (dir: string): string[] =>
		readdirSync(dir).flatMap((name) => {
			if (name === "node_modules" || name === "tests") return [];
			const path = join(dir, name);
			return statSync(path).isDirectory() ? walk(path) : /\.(ts|mjs)$/.test(name) ? [path] : [];
		});
	const offenders = walk(SCRIPTS).filter((file) => direct.test(readFileSync(file, "utf8")));
	assert.deepEqual(offenders.map((f) => relative(SCRIPTS, f)), []);
});
