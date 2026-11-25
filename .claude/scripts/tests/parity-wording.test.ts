/**
 * A correct port words its output for Notion objects, and the harness must
 * read that wording as the same findings. The Notion text in this file is
 * written by hand for the fixture, with the wording of part (d) of
 * `NOTION-PORT-DESIGN.md`. It runs no ported hook and makes no Notion call.
 */

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { compareFindings, type Comparison } from "../parity/compare.ts";
import { findingsOf } from "../parity/findings.ts";
import { FIXTURE } from "../parity/fixture.ts";
import { markdownForm } from "../parity/markdown-form.ts";
import { MARKDOWN_WORDING } from "../parity/markdown-wording.ts";
import { NOTION_WORDING } from "../parity/notion-wording.ts";
import { REFERENCE_COMMIT, referenceCommitExists, runScenarios, withReferenceWorktree, type ScenarioRun } from "../parity/runner.ts";
import { NOTE_TYPES, type Finding, type HookEnvironment } from "../parity/spec.ts";
import type { Wording } from "../parity/wording.ts";

/** The patterns of a port. `NOTION_WORDING` gives the line of part d.2, and the other lines name the objects of parts d.1 to d.3. */
const PORT_WORDING: Wording = {
	...MARKDOWN_WORDING,
	...NOTION_WORDING,
	"section listing": /^### Workspace Listing$/,
	"section hygiene": /^### Workspace Hygiene \(drift detected\)$/,
	"north star hidden items": /^_\((?<count>\d+) completed items? hidden — full history in the North Star page\)_$/,
	"listing collapsed": /^(?<group>.+) — (?<count>\d+) notes \(listing collapsed\)$/,
	"listing note": /^(?:.+ \/ )?(?<note>[^/]+)$/,
	"claim HY-02": /^Active Work rows with an empty `Project` that look like one topic/,
	"claim HY-03": /^(?<count>\d+) row\(s\) with `Bytes` of 25,000 or more/,
	"claim HY-04": /^(?<count>\d+) row\(s\) with open loops and `Changed` older than 14 days/,
	"claim HY-05": /^(?<count>\d+) `Inbox item` row\(s\) with `Changed` older than 7 days/,
	"topic cluster":
		/^🗂️ {2}This row joins (?<count>\d+) active Work row\(s\) with an empty `Project` sharing "(?<token>[^"]+)": (?<notes>.+)\.\nConvention: .+$/,
	"warning VW-08": /^The `(?<field>Date|Description|Tags)` property is empty/,
};

/** The groups that the port collapses, and the folder that the Markdown form collapses for the same notes. */
const FOLDER_OF_GROUP: Readonly<Record<string, string>> = {
	"Knowledge / Reference": "reference",
	"Work / Archived": "work/archive",
};

const HYGIENE = [
	"⚠️  CLAUDE.md present beside AGENTS.md — Claude Code reads CLAUDE.md and skips AGENTS.md.",
	"",
	"⚠️  AGENTS.md is 24KB — keep it under 23KB.",
	"⚠️  Active Work rows with an empty `Project` that look like one topic — consider one `Project` for them:",
	'   - "billing": Billing Export Pipeline, Billing Retry Design',
	"",
	"⚠️  1 row(s) with `Bytes` of 25,000 or more — do NOT trim content; SPLIT the page:",
	"   - Runbook (26KB)",
	"",
	"⚠️  5 row(s) with open loops and `Changed` older than 14 days — close, chase, or consciously park:",
	"   - Payments Latency (45d, 1 open item(s))",
	"   - Ada Park 2026-02-07 (30d, 2 open item(s))",
	"   - Checkout Outage (25d, 2 open item(s))",
	"   - Planning Export (21d, 1 open item(s))",
	"   - Retro Export (18d, 1 open item(s))",
	"",
	"⚠️  4 `Inbox item` row(s) with `Changed` older than 7 days (oldest 21d) — ask the agent to run om-intake.",
];

function sessionContext(listing: readonly string[]): string {
	return [
		"## Session Context",
		"",
		"### Date",
		"2026-06-15 (Monday)",
		"",
		"### North Star (current goals)",
		"## Current Focus",
		"_(1 completed item hidden — full history in the North Star page)_",
		"",
		"- Ship the billing export before the quarter ends.",
		"- Keep the login latency under the budget.",
		"",
		"## Longer Term",
		"",
		"- Grow the platform team.",
		"",
		"### Brain Topics (read on demand)",
		"- Gotchas — The traps that cost time (empty)",
		"- Key Decisions — (no description)",
		"- Patterns — The patterns that repeat",
		"",
		"### Recent Changes (last 48h)",
		"Home",
		"Draft Thoughts",
		"",
		"### Open Tasks",
		"Billing Export Pipeline",
		"- [ ] Write the export schema",
		"- [ ] Measure the run time",
		"",
		"Search Ranking Tuning",
		"- [ ] Collect the click data",
		"",
		"Home",
		"- [ ] Review the quarter goals",
		"",
		"### Active Work",
		"Billing Export Pipeline",
		"Billing Retry Design",
		"Fixture Work Note",
		"Login Latency Budget",
		"Search Ranking Tuning",
		"",
		"### Workspace Listing",
		...listing,
		"",
		"### Workspace Hygiene (drift detected)",
		...HYGIENE,
		"",
		"_context injected: 3.1kB / 9.0kB budget_",
		"",
	].join("\n");
}

const CLUSTER_CONTEXT =
	'🗂️  This row joins 1 active Work row(s) with an empty `Project` sharing "billing": Billing Export Pipeline, Billing Retry Design.\n' +
	"Convention: once a workstream has more than one row, give each row the same `Project`.";

const envelope = (event: string, context: string, policyResults?: readonly unknown[]): string =>
	JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: context, ...(policyResults ? { policyResults } : {}) } });

const skip = referenceCommitExists() ? false : `this clone does not hold the reference commit ${REFERENCE_COMMIT}`;

describe("output with the wording of a port", { skip }, () => {
	const SCENARIOS = ["session-start", "write-missing-global-fields", "write-joins-cluster"];
	let original: readonly ScenarioRun[];
	let port: HookEnvironment;
	let listing: string[];

	before(() => {
		const spec = { ...FIXTURE, scenarios: FIXTURE.scenarios.filter(({ id }) => SCENARIOS.includes(id)) };
		original = withReferenceWorktree(({ scriptsDir, workDir }) =>
			runScenarios(spec, workDir, markdownForm(spec, { scriptsDir, now: new Date() })),
		);
		const markdown = original[0]!.environment;
		const titles = new Set(FIXTURE.notes.map((note) => note.title));
		port = {
			...markdown,
			wording: PORT_WORDING,
			noteOf: (reference) => (titles.has(reference) ? reference : null),
			notesIn: (group) => markdown.notesIn(FOLDER_OF_GROUP[group] ?? "no such group"),
		};
		const collapsed = new Set(Object.keys(FOLDER_OF_GROUP).flatMap((group) => port.notesIn(group)));
		listing = [
			...FIXTURE.notes
				.filter((note) => note.type !== "Thinking" && !collapsed.has(note.title))
				.map(({ title, type }) => (NOTE_TYPES[type].database === null ? title : `${NOTE_TYPES[type].database} / ${type} / ${title}`)),
			"Knowledge / Reference — 13 notes (listing collapsed)",
			"Work / Archived — 2 notes (listing collapsed)",
		];
	});

	const compare = (scenarioId: string, stdout: string, environment: HookEnvironment = port): Comparison => {
		const run = original.find(({ scenario }) => scenario.id === scenarioId)!;
		const ported: ScenarioRun = { ...run, environment, runs: [{ ...run.runs[0]!, stdout }] };
		return compareFindings(scenarioId, findingsOf(run, FIXTURE), findingsOf(ported, FIXTURE), FIXTURE);
	};

	const brief = ({ differences }: Comparison): string[] =>
		differences.map(({ row, kind, original: a, port: b }) => {
			const finding = (a ?? b) as Finding;
			return `${row} ${kind}: ${finding.note ?? finding.detail}`;
		});

	test("the SessionStart context of a port gives the findings of the original", () => {
		const comparison = compare("session-start", envelope("SessionStart", sessionContext(listing)));
		assert.deepEqual(brief(comparison), []);
		assert.deepEqual(comparison.tolerated, []);
	});

	test("the rows with no Notion form are the only findings that the comparison leaves out", () => {
		const { notApplicable } = compare("session-start", envelope("SessionStart", sessionContext(listing)));
		assert.deepEqual([...new Set(notApplicable.map(({ form, finding }) => `${form} ${finding.row}`))].sort(), [
			"original HY-01",
			"original SS-13",
			"port SS-13",
		]);
	});

	test("the cluster warning of a port gives the VW-15 findings of the original", () => {
		const policy = { policy_id: "topic-cluster", path: "Billing Retry Design", classification: "ungrouped-cluster", suggested_target: "Project", action: "flag" };
		assert.deepEqual(brief(compare("write-joins-cluster", envelope("PostToolUse", CLUSTER_CONTEXT, [policy]))), []);
	});

	test("a port that names the properties gives the VW-08 findings of the frontmatter keys", () => {
		const warnings =
			"Vault hygiene warnings for `Missing Fields`:\n  - The `Description` property is empty (about 150 characters)\n  - The `Tags` property is empty\nFix these before moving on.";
		assert.deepEqual(brief(compare("write-missing-global-fields", envelope("PostToolUse", warnings))), []);
	});

	test("a port that drops the empty marker of a brain topic gives the SS-12 row", () => {
		const context = sessionContext(listing).replace("The traps that cost time (empty)", "The traps that cost time");
		assert.deepEqual(brief(compare("session-start", envelope("SessionStart", context))), [
			"SS-12 only in the original: Gotchas",
			"SS-12 only in the port: Gotchas",
		]);
	});

	test("a port that collapses a different number of notes gives the SS-16 row", () => {
		const context = sessionContext(listing).replace("Knowledge / Reference — 13 notes", "Knowledge / Reference — 12 notes");
		assert.deepEqual(brief(compare("session-start", envelope("SessionStart", context))), ["SS-16 only in the port: collapsed count"]);
	});

	test("a port that counts a different number of inbox rows gives the HY-05 row", () => {
		const context = sessionContext(listing).replace("4 `Inbox item` row(s)", "3 `Inbox item` row(s)");
		assert.deepEqual(brief(compare("session-start", envelope("SessionStart", context))), ["HY-05 count differs: claim"]);
	});

	test("a port that joins a different cluster gives the VW-15 row", () => {
		const policy = { policy_id: "topic-cluster", path: "Billing Retry Design", classification: "ungrouped-cluster", suggested_target: "Project", action: "flag" };
		const context = CLUSTER_CONTEXT.replace("Billing Export Pipeline, Billing Retry Design", "Billing Retry Design, Pricing Rollout");
		assert.deepEqual(brief(compare("write-joins-cluster", envelope("PostToolUse", context, [policy]))).map((line) => line.slice(0, 5)), [
			"VW-15",
			"VW-15",
		]);
	});

	test("the same output read with the Markdown wording is not the findings of the original", () => {
		const markdown = { ...port, wording: MARKDOWN_WORDING };
		const rows = new Set(compare("session-start", envelope("SessionStart", sessionContext(listing)), markdown).differences.map(({ row }) => row));
		assert.deepEqual(["SS-12", "SS-16", "HY-05", "UNMAPPED"].filter((row) => !rows.has(row as Finding["row"])), []);
	});
});
