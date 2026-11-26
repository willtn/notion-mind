/**
 * Drift guard: the historical rule has THREE statements of one rule.
 *
 * `lib/correction-sweep.ts` holds the predicate. `.claude/commands/om-correct.md`
 * and `.claude/agents/correction-sweep.md` restate it in prose, and prose is
 * what the agent actually reads and acts on. Nothing in the runtime imports
 * the predicate, because the sweep is executed by an agent following the
 * command, not by TypeScript calling a function.
 *
 * The cheap fix applies: keep the prose, since the agent needs it inline, and
 * FAIL when it stops matching the predicate so the two cannot drift silently.
 *
 * The failure this prevents is not cosmetic. The type list and the status list
 * ARE the safety property, because they decide which pages may never be edited.
 * A doc that lists one type fewer than the predicate is an agent that will
 * rewrite a record that the tests believe is protected.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HISTORICAL_STATUS, HISTORICAL_TYPES } from "../lib/correction-sweep.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

interface DocRule {
	readonly types: string[];
	readonly statuses: string[];
	readonly dated: boolean;
}

/** Both docs write the rule as bullets: "- its `Work.Type` is `1:1`, `Inbox item`, or `Incident`". */
function docRule(relPath: string): DocRule {
	const lines = readFileSync(join(root, relPath), "utf-8").split("\n");
	const values = (property: "Type" | "Status"): string[] =>
		lines
			.filter((line) => new RegExp(`^- its \`[A-Za-z]+\\.${property}\` is `).test(line))
			.flatMap((line) => [...line.replace(/^[^ ]+ [^ ]+ [^ ]+ [^ ]+ /, "").matchAll(/`([^`]+)`/g)].map((m) => m[1]!))
			.sort();
	return {
		types: values("Type"),
		statuses: values("Status"),
		dated: lines.some((line) => /^- (its title carries a date|a date in the title)/.test(line)),
	};
}

const predicate = { types: [...HISTORICAL_TYPES].sort(), statuses: [...HISTORICAL_STATUS].sort() };

describe("correction-sweep: predicate and prose state one rule", () => {
	test("the predicate lists a non-trivial set", () => {
		// Guards the guard: a parse that silently matched nothing would make
		// every comparison below pass by being empty on both sides.
		assert.ok(predicate.types.length >= 5, JSON.stringify(predicate.types));
		assert.ok(predicate.statuses.includes("archived"), "archived is the one that must never be missing");
	});

	for (const [name, path] of [
		["command", ".claude/commands/om-correct.md"],
		["agent", ".claude/agents/correction-sweep.md"],
	] as const) {
		test(`the ${name} doc lists the same types as the predicate`, () => {
			assert.deepEqual(docRule(path).types, predicate.types, `${path}: the type list drifted from lib/correction-sweep.ts`);
		});

		test(`the ${name} doc lists the same statuses as the predicate`, () => {
			assert.deepEqual(docRule(path).statuses, predicate.statuses, `${path}: the status list drifted from lib/correction-sweep.ts`);
		});

		test(`the ${name} doc names the dated title rule`, () => {
			assert.equal(docRule(path).dated, true, `${path}: the dated title rule is missing`);
		});
	}
});
