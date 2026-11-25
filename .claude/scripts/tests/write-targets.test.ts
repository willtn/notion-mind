/**
 * writeTargets: the files a write hook's payload says were written. Claude
 * Code names one `file_path`.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";

import { writeTargets } from "../lib/write-targets.ts";

const PROJECT = resolve("/vault");

describe("writeTargets — file_path (Claude Code)", () => {
	test("a file_path is the one target, as given", () => {
		assert.deepEqual(writeTargets({ tool_input: { file_path: join(PROJECT, "a.md") } }), [join(PROJECT, "a.md")]);
	});

	test("no tool_input, or neither field, gives no target", () => {
		assert.deepEqual(writeTargets(null), []);
		assert.deepEqual(writeTargets({}), []);
		assert.deepEqual(writeTargets({ tool_input: { file_path: "" } }), []);
	});

	test("a payload that carries only a command names no target", () => {
		assert.deepEqual(writeTargets({ tool_name: "apply_patch", tool_input: { command: "echo hello" } }), []);
	});
});
