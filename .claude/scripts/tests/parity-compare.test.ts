/**
 * The comparator applies the rule that part (d) of the design record gives
 * each row, and it names the row of each difference.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { compareFindings, formatDifference } from "../parity/compare.ts";
import type { Finding, FixtureSpec } from "../parity/spec.ts";

const finding = (row: Finding["row"], fields: Partial<Omit<Finding, "row">> = {}): Finding => ({
	row,
	step: 0,
	note: null,
	detail: null,
	count: null,
	...fields,
});

const SPEC: FixtureSpec = {
	notes: [
		{ title: "Near", type: "Reference", fields: {}, body: "", changedDaysAgo: 0, nearSizeLimit: true },
		{ title: "Big", type: "Reference", fields: {}, body: "", changedDaysAgo: 0 },
	],
	repoFiles: [],
	scenarios: [],
};

const compare = (original: readonly Finding[], port: readonly Finding[]) => compareFindings("scenario", original, port, SPEC);

describe("compareFindings", () => {
	test("the same findings in a different order are equal", () => {
		const a = finding("VW-08", { note: "Big", detail: "tags" });
		const b = finding("VW-10", { note: "Big" });
		assert.deepEqual(compare([a, b], [b, a]), { differences: [], tolerated: [], notApplicable: [] });
	});

	test("a finding that one form does not have is a difference with its row", () => {
		const tags = finding("VW-08", { note: "Big", detail: "tags" });
		const description = finding("VW-08", { note: "Big", detail: "description" });
		const { differences } = compare([tags, description], [description]);
		assert.deepEqual(differences, [{ scenario: "scenario", row: "VW-08", kind: "only in the original", original: tags, port: null }]);
	});

	test("a finding that only the port has is a difference", () => {
		const extra = finding("VW-10", { note: "Big" });
		assert.deepEqual(compare([], [extra]).differences, [
			{ scenario: "scenario", row: "VW-10", kind: "only in the port", original: null, port: extra },
		]);
	});

	test("the same finding on another note is two differences", () => {
		const { differences } = compare([finding("VW-10", { note: "Big" })], [finding("VW-10", { note: "Near" })]);
		assert.deepEqual(differences.map((d) => d.kind).sort(), ["only in the original", "only in the port"]);
	});

	test("the same finding at another step is two differences", () => {
		const { differences } = compare([finding("UP-03", { step: 0 })], [finding("UP-03", { step: 1 })]);
		assert.equal(differences.length, 2);
	});

	test("a different count is a difference", () => {
		const { differences } = compare([finding("VW-11", { note: "Big", count: 2 })], [finding("VW-11", { note: "Big", count: 3 })]);
		assert.deepEqual(differences.map((d) => [d.row, d.kind]), [["VW-11", "count differs"]]);
	});

	test("a finding that occurs two times in one form and one time in the other is one difference", () => {
		const line = finding("SS-11", { detail: "- A goal" });
		assert.equal(compare([line, line], [line]).differences.length, 1);
	});

	test("text that no recognizer knows is a difference", () => {
		const { differences } = compare([], [finding("UNMAPPED", { detail: "### New Section" })]);
		assert.deepEqual(differences.map((d) => d.row), ["UNMAPPED"]);
	});

	test("a different size is a difference for a row with no tolerance", () => {
		const { differences } = compare([finding("HY-03", { note: "Big", sizeKb: 26 })], [finding("HY-03", { note: "Big", sizeKb: 27 })]);
		assert.deepEqual(differences.map((d) => [d.row, d.kind]), [["HY-03", "size differs"]]);
	});
});

describe("rows that part (d) marks not applicable", () => {
	test("an HY-01 finding in the original only is not a difference", () => {
		const done = finding("HY-01", { note: "Big" });
		assert.deepEqual(compare([done], []), {
			differences: [],
			tolerated: [],
			notApplicable: [{ scenario: "scenario", form: "original", finding: done }],
		});
	});

	test("SS-13 entries that differ are not a difference", () => {
		const { differences, notApplicable } = compare(
			[finding("SS-13", { detail: "no history" })],
			[finding("SS-13", { detail: "entries", count: 4 })],
		);
		assert.deepEqual(differences, []);
		assert.deepEqual(notApplicable.map((n) => n.form), ["original", "port"]);
	});
});

describe("the VW-14 size tolerance", () => {
	const flagged = (note: string, sizeKb: number): Finding => finding("VW-14", { note, sizeKb });

	test("the near-limit note can have the finding in one form only", () => {
		const { differences, tolerated } = compare([], [flagged("Near", 26)]);
		assert.deepEqual(differences, []);
		assert.deepEqual(tolerated.map((d) => [d.row, d.kind]), [["VW-14", "only in the port"]]);
	});

	test("the policy result of the near-limit note follows its size finding", () => {
		const policy = finding("VW-14", { note: "Near", detail: "policy organization-threshold, oversized-note, flag" });
		assert.deepEqual(compare([], [flagged("Near", 26), policy]).differences, []);
		assert.deepEqual(compare([policy], []).differences, []);
		assert.equal(compare([], [{ ...policy, note: "Big" }]).differences.length, 1);
	});

	test("the near-limit note is a difference when the size is more than 10 percent above the limit", () => {
		assert.equal(compare([], [flagged("Near", 28)]).differences.length, 1);
		assert.equal(compare([], [flagged("Near", 27)]).differences.length, 0);
	});

	test("a different note cannot have the finding in one form only", () => {
		assert.deepEqual(compare([flagged("Big", 26)], []).differences.map((d) => [d.row, d.kind]), [["VW-14", "only in the original"]]);
	});

	test("two sizes of the near-limit note inside 10 percent are a tolerated pair that the result lists", () => {
		const original = flagged("Near", 25);
		const port = flagged("Near", 27);
		assert.deepEqual(compare([original], [port]), {
			differences: [],
			tolerated: [{ scenario: "scenario", row: "VW-14", kind: "size differs", original, port }],
			notApplicable: [],
		});
	});

	test("two sizes of the near-limit note outside 10 percent are a difference", () => {
		const { differences, tolerated } = compare([flagged("Near", 25)], [flagged("Near", 28)]);
		assert.deepEqual(differences.map((d) => d.kind), ["size differs"]);
		assert.deepEqual(tolerated, []);
	});

	test("two different sizes of a different note are a difference, also inside 10 percent", () => {
		const { differences, tolerated } = compare([flagged("Big", 40)], [flagged("Big", 41)]);
		assert.deepEqual(differences.map((d) => [d.row, d.kind]), [["VW-14", "size differs"]]);
		assert.deepEqual(tolerated, []);
	});
});

test("a difference line starts with the row ID and names the scenario", () => {
	const [difference] = compare([finding("VW-08", { note: "Big", detail: "tags" })], []).differences;
	assert.equal(
		formatDifference(difference!),
		'VW-08 scenario step 0: only in the original. original: note "Big", detail "tags". port: none.',
	);
});
