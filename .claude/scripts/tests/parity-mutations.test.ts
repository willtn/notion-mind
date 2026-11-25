/**
 * The harness sees a change of a hook: each mutation of a copy of the
 * reference hooks gives differences with the rows that the mutation names.
 */

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { MUTATIONS, runMutations, type MutationResult } from "../parity/mutations.ts";
import { REFERENCE_COMMIT, referenceCommitExists } from "../parity/runner.ts";

const skip = referenceCommitExists() ? false : `this clone does not hold the reference commit ${REFERENCE_COMMIT}`;

describe("the parity harness on mutated copies of the original hooks", { skip }, () => {
	let results: readonly MutationResult[];

	before(() => {
		results = runMutations();
	});

	for (const [index, mutation] of MUTATIONS.entries()) {
		test(`${mutation.id}: ${mutation.change}`, () => {
			const { rows, lines } = results[index]!;
			assert.deepEqual(rows, [...mutation.rows].sort(), lines.join("\n"));
		});
	}

	test("a mutation names a row, or it gives the reason why the harness cannot see it", () => {
		const unexplained = MUTATIONS.filter(({ rows, notSeen }) => (rows.length === 0) !== (notSeen !== undefined)).map(({ id }) => id);
		assert.deepEqual(unexplained, []);
	});

	test("no two mutations share an ID", () => {
		const ids = MUTATIONS.map(({ id }) => id);
		assert.deepEqual(ids.filter((id, index) => ids.indexOf(id) !== index), []);
	});
});
