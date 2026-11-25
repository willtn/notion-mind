/**
 * The fixture set of the parity harness. Each note exists for a row of part
 * (d) of `NOTION-PORT-DESIGN.md`, and each scenario states the findings that
 * the conditions of that part give.
 */

import type { ExpectedFinding, FixtureNote, FixtureSpec, RepoFile, Scenario, Step } from "./spec.ts";

const LINE = "This line is filler text that keeps each paragraph on one line.";

function filler(title: string, bytes: number): string {
	const head = `# ${title}\n\nSee [[Patterns]] for the context.\n`;
	const paragraphs = Math.ceil((bytes - head.length) / (LINE.length + 2));
	return head + `\n${LINE}\n`.repeat(paragraphs);
}

const global = (description: string, tags: readonly string[]) => ({
	date: "2026-01-05",
	description,
	tags,
});

const workNote = (description: string) => ({
	...global(description, ["work-note"]),
	status: "active",
	quarter: "Q1-2026",
});

const linked = (title: string, text: string): string => `# ${title}\n\n${text} See [[Patterns]].\n`;

const notes: readonly FixtureNote[] = [
	{
		title: "Home",
		type: "Home",
		fields: {},
		body: "# Home\n\nStart at [[North Star]].\n\n- [ ] Review the quarter goals\n- [x] Set up the workspace\n",
		changedDaysAgo: 1,
	},
	{
		title: "North Star",
		type: "North Star",
		fields: global("The goals and the focus areas", ["north-star"]),
		body: [
			"# North Star",
			"",
			"An introduction that the hook does not inject.",
			"",
			"## Current Focus",
			"",
			"- Ship the billing export before the quarter ends.",
			"- ~~Close the search migration.~~",
			"  - A detail of the closed goal.",
			"- Keep the login latency under the budget.",
			"",
			"## Shifts Log",
			"",
			"- An old shift that the hook drops.",
			"",
			"## Longer Term",
			"",
			"- Grow the platform team.",
			"",
		].join("\n"),
		changedDaysAgo: 5,
	},

	{
		title: "Patterns",
		type: "Brain topic",
		fields: global("The patterns that repeat", ["brain"]),
		body: "# Patterns\n\n- Name the data shape first.\n",
		changedDaysAgo: 9,
	},
	{
		title: "Gotchas",
		type: "Brain topic",
		fields: global("The traps that cost time", ["brain"]),
		body: "# Gotchas\n\nNo entry yet.\n",
		changedDaysAgo: 9,
	},
	{
		title: "Key Decisions",
		type: "Brain topic",
		fields: { date: "2026-01-05", tags: ["brain"] },
		body: "# Key Decisions\n\n- Keep one store for the notes.\n",
		changedDaysAgo: 9,
	},

	{
		title: "Fixture Work Note",
		type: "Work note",
		fields: workNote("A work note with no finding"),
		body: linked("Fixture Work Note", "This note has each required field and one link."),
		changedDaysAgo: 2,
	},
	{
		title: "Billing Export Pipeline",
		type: "Work note",
		fields: workNote("The export of invoices to the ledger"),
		body:
			linked("Billing Export Pipeline", "The export runs each night.") +
			"\n- [ ] Write the export schema\n- [x] Pick the file format\n- [ ] Measure the run time\n",
		changedDaysAgo: 2,
	},
	{
		title: "Billing Retry Design",
		type: "Work note",
		fields: workNote("The retry rules for a failed charge"),
		body: linked("Billing Retry Design", "A failed charge gets three attempts."),
		changedDaysAgo: 3,
	},
	{
		title: "Search Ranking Tuning",
		type: "Work note",
		fields: workNote("The weights of the ranking signals"),
		body: linked("Search Ranking Tuning", "The weights come from the click data.") + "\n- [ ] Collect the click data\n",
		changedDaysAgo: 4,
	},
	{
		title: "Login Latency Budget",
		type: "Work note",
		fields: workNote("The time limits of the login path"),
		body: linked("Login Latency Budget", "The login path has a limit of 300 ms."),
		changedDaysAgo: 6,
	},
	{
		title: "Pricing Rollout",
		type: "Work note",
		fields: { ...workNote("The steps of the new price list"), project: "Pricing" },
		body: linked("Pricing Rollout", "The price list goes out by region.") + "\n- [ ] Tell the sales team\n",
		changedDaysAgo: 3,
	},
	{
		title: "Old Pricing Plan",
		type: "Work note",
		fields: { ...workNote("The price plan that the rollout replaced"), status: "completed", project: "Pricing" },
		body: linked("Old Pricing Plan", "This plan is done."),
		changedDaysAgo: 40,
		markdownFolder: "work/active/Pricing",
	},
	{
		title: "Legacy Importer",
		type: "Work note",
		fields: { ...workNote("The importer that the pipeline replaced"), status: "completed" },
		body: linked("Legacy Importer", "The importer is off."),
		changedDaysAgo: 90,
	},
	{
		title: "Search Migration",
		type: "Work note",
		fields: { ...workNote("The move to the new search cluster"), status: "archived" },
		body: linked("Search Migration", "The move is complete."),
		changedDaysAgo: 80,
	},

	...(
		[
			["Ada Park 2026-01-10", "Ada Park", 60],
			["Ada Park 2026-02-07", "Ada Park", 30],
			["Ben Ortiz 2026-01-15", "Ben Ortiz", 50],
			["Ben Ortiz 2026-03-01", "Ben Ortiz", 3],
		] as const
	).map(
		([title, person, changedDaysAgo]): FixtureNote => ({
			title,
			type: "1:1",
			fields: {
				...global(`A 1:1 meeting with ${person}`, ["work-note"]),
				quarter: "Q1-2026",
				person,
			},
			body: `# ${title}\n\nA meeting with [[${person}]].\n\n## Action Items\n\n- [ ] Send the notes\n- [ ] Book the next meeting\n- [x] Share the agenda\n`,
			changedDaysAgo,
		}),
	),

	{
		title: "Checkout Outage",
		type: "Incident",
		fields: {
			...global("The checkout failed for 40 minutes", ["incident", "work-note"]),
			status: "active",
			quarter: "Q1-2026",
			ticket: "OPS-41",
			severity: "high",
			role: "incident-lead",
		},
		body:
			linked("Checkout Outage", "The payment gateway refused each request.") +
			"\nWaiting on the vendor for the root cause.\n\n## What to Watch\n\n- [ ] The error rate of the gateway\n",
		changedDaysAgo: 25,
	},
	{
		title: "Checkout Outage RCA",
		type: "Incident",
		fields: global("The root cause analysis of the checkout outage", ["work-note"]),
		body: linked("Checkout Outage RCA", "The analysis sits beside [[Checkout Outage]]."),
		changedDaysAgo: 20,
	},
	{
		title: "Payments Latency",
		type: "Incident",
		fields: {
			...global("The payment calls were slow for one day", ["incident", "work-note"]),
			status: "active",
			quarter: "Q1-2026",
			ticket: "OPS-37",
			severity: "medium",
			role: "responder",
		},
		body: linked("Payments Latency", "The calls took 2 s.") + "\nWatch for a second spike after the release.\n",
		changedDaysAgo: 45,
	},

	...(
		[
			["Vendor Sync Export", "## Action Items", 10],
			["Planning Export", "## Follow Ups", 21],
			["Retro Export", "## Action Items", 18],
			["Offsite Export", "## Action Items", 16],
			["Fresh Standup Export", "## Action Items", 2],
		] as const
	).map(
		([title, heading, changedDaysAgo]): FixtureNote => ({
			title,
			type: "Inbox item",
			fields: { ...global("A raw meeting export", ["meeting"]), status: "inbox" },
			body: `${linked(title, "The raw export of one meeting.")}\n${heading}\n\n- [ ] Send the summary\n`,
			changedDaysAgo,
		}),
	),

	{
		title: "Ada Park",
		type: "Person",
		fields: { ...global("A staff engineer of the billing team", ["person"]), title: "Staff Engineer" },
		body: linked("Ada Park", "Ada leads the billing export."),
		changedDaysAgo: 30,
	},
	{
		title: "Ben Ortiz",
		type: "Person",
		fields: global("An engineer of the search team", ["person"]),
		body: linked("Ben Ortiz", "Ben owns the ranking service."),
		changedDaysAgo: 30,
	},

	{
		title: "Draft Thoughts",
		type: "Thinking",
		fields: global("A draft that the listing skips", ["thinking"]),
		body: linked("Draft Thoughts", "A first idea."),
		changedDaysAgo: 1,
	},

	{
		title: "Loose Draft",
		type: "Loose page",
		fields: {},
		body: linked("Loose Draft", "A page outside the databases."),
		changedDaysAgo: 1,
	},
	{
		title: "Missing Fields",
		type: "Reference",
		fields: { date: "2026-01-05" },
		body: linked("Missing Fields", "This note has no description and no tags."),
		changedDaysAgo: 1,
	},
	{
		title: "No Links",
		type: "Reference",
		fields: global("A long note with no link", ["reference"]),
		body: `# No Links\n\n${`${LINE} `.repeat(6).trim()}\n`,
		changedDaysAgo: 1,
	},
	{
		title: "Wrapped Prose",
		type: "Reference",
		fields: global("A note with a paragraph on three lines", ["reference"]),
		body: "# Wrapped Prose\n\nThis paragraph has a line break in the\nmiddle of a sentence, and a second\nline break after it. See [[Patterns]].\n",
		changedDaysAgo: 1,
	},
	{
		title: "Ticket Links",
		type: "Reference",
		fields: global("A note that links two ticket IDs", ["reference"]),
		body: "# Ticket Links\n\nThe work is in [[PROJ-123]] and [[OPS-9]]. See [[Patterns]].\n",
		changedDaysAgo: 1,
	},
	{
		title: "Runbook",
		type: "Reference",
		fields: global("A runbook past the size limit", ["reference"]),
		body: filler("Runbook", 26_000),
		changedDaysAgo: 12,
	},
	{
		title: "Near Limit Runbook",
		type: "Reference",
		fields: global("A runbook a little below the size limit", ["reference"]),
		body: filler("Near Limit Runbook", 24_400),
		changedDaysAgo: 12,
		nearSizeLimit: true,
	},
	{
		title: "Runbook Archive",
		type: "Archive note",
		fields: global("The old runbook entries", ["reference"]),
		body: filler("Runbook Archive", 30_000),
		changedDaysAgo: 100,
	},
	...[1, 2, 3, 4, 5].map(
		(n): FixtureNote => ({
			title: `Reference Card ${n}`,
			type: "Reference",
			fields: global(`The reference card number ${n}`, ["reference"]),
			body: linked(`Reference Card ${n}`, "A short reference."),
			changedDaysAgo: 15,
		}),
	),
];

const repoFiles: readonly RepoFile[] = [
	{
		path: "vault-manifest.json",
		content: `${JSON.stringify(
			{
				template: "obsidian-mind",
				version: "10.0.0",
				open_loop_dirs: ["work/1-1", "work/meetings", "work/incidents"],
				// "follow ups" is not a default, so a finding under that heading shows that the hook read this file.
				open_loop_sections: ["action items", "what to watch", "follow ups"],
				listing_collapse_threshold: 12,
				infrastructure: ["AGENTS.md", "CLAUDE.md", "vault-manifest.json"],
				frontmatter_required: {
					global: ["date", "description", "tags"],
					"work-note": ["date", "status", "quarter"],
					incident: ["date", "status", "quarter", "ticket", "severity", "role"],
					person: ["date", "title"],
					team: ["date"],
					"1-1": ["date", "quarter"],
				},
			},
			null,
			2,
		)}\n`,
	},
	{ path: "AGENTS.md", content: filler("AGENTS", 23_500) },
	{ path: "CLAUDE.md", content: "Read AGENTS.md.\n" },
];

const payload = (hook: Step["hook"], fields: Readonly<Record<string, unknown>> = {}): Step => ({
	hook,
	input: { kind: "payload", fields },
});
const prompt = (text: string, fields: Readonly<Record<string, unknown>> = {}): Step =>
	payload("classify-message", { prompt: text, ...fields });
const write = (note: string): Step => ({ hook: "validate-write", input: { kind: "write", note } });

const BILLING_CLUSTER = "billing: Billing Export Pipeline, Billing Retry Design";

const hygieneClaims = (step: number): ExpectedFinding[] => [
	{ row: "HY-07", step, detail: "CLAUDE.md" },
	{ row: "HY-09", step, sizeKb: 24 },
	{ row: "HY-01", step, detail: "claim", count: 1 },
	{ row: "HY-02", step, detail: "claim" },
	{ row: "HY-03", step, detail: "claim", count: 1 },
	{ row: "HY-04", step, detail: "claim", count: 5 },
	{ row: "HY-05", step, detail: "claim", count: 4 },
];

/** Six notes have open items, and the report keeps the five oldest. */
const hygiene = (step: number): ExpectedFinding[] => [
	...hygieneClaims(step),
	{ row: "HY-01", step, note: "Old Pricing Plan" },
	{ row: "HY-02", step, detail: BILLING_CLUSTER, count: 2 },
	{ row: "HY-03", step, note: "Runbook", sizeKb: 26 },
	{ row: "HY-04", step, note: "Payments Latency", count: 1 },
	{ row: "HY-04", step, note: "Ada Park 2026-02-07", count: 2 },
	{ row: "HY-04", step, note: "Checkout Outage", count: 2 },
	{ row: "HY-04", step, note: "Planning Export", count: 1 },
	{ row: "HY-04", step, note: "Retro Export", count: 1 },
];

const checklist = (step: number): ExpectedFinding => ({ row: "ST-03", step, count: 5 });

const HYGIENE_ROWS = ["HY-01", "HY-02", "HY-03", "HY-04", "HY-05", "HY-07", "HY-09"] as const;

const LISTED = [
	"Home",
	"North Star",
	"Patterns",
	"Gotchas",
	"Key Decisions",
	"Fixture Work Note",
	"Billing Export Pipeline",
	"Billing Retry Design",
	"Search Ranking Tuning",
	"Login Latency Budget",
	"Pricing Rollout",
	"Old Pricing Plan",
	"Ada Park 2026-01-10",
	"Ada Park 2026-02-07",
	"Ben Ortiz 2026-01-15",
	"Ben Ortiz 2026-03-01",
	"Checkout Outage",
	"Checkout Outage RCA",
	"Payments Latency",
	"Vendor Sync Export",
	"Planning Export",
	"Retro Export",
	"Offsite Export",
	"Fresh Standup Export",
	"Ada Park",
	"Ben Ortiz",
];
const COLLAPSED = [
	"Legacy Importer",
	"Search Migration",
	"Loose Draft",
	"Missing Fields",
	"No Links",
	"Wrapped Prose",
	"Ticket Links",
	"Runbook",
	"Near Limit Runbook",
	"Runbook Archive",
	"Reference Card 1",
	"Reference Card 2",
	"Reference Card 3",
	"Reference Card 4",
	"Reference Card 5",
];

const scenarios: readonly Scenario[] = [
	{
		id: "session-start",
		rows: ["SS-10", "SS-11", "SS-12", "SS-13", "SS-14", "SS-15", "SS-16", "SS-17", "SS-19", ...HYGIENE_ROWS],
		steps: [payload("session-start", { source: "startup" })],
		expect: [
			{ row: "SS-19", detail: "additional context" },
			{ row: "SS-10", detail: "date line" },
			{ row: "SS-11", detail: "## Current Focus" },
			{ row: "SS-11", detail: "completed items hidden", count: 1 },
			{ row: "SS-11", detail: "- Ship the billing export before the quarter ends." },
			{ row: "SS-11", detail: "- Keep the login latency under the budget." },
			{ row: "SS-11", detail: "## Longer Term" },
			{ row: "SS-11", detail: "- Grow the platform team." },
			{ row: "SS-12", note: "Patterns", detail: "The patterns that repeat" },
			{ row: "SS-12", note: "Gotchas", detail: "The traps that cost time (empty)" },
			{ row: "SS-12", note: "Key Decisions", detail: "(no description)" },
			{ row: "SS-13", detail: "no history" },
			{ row: "SS-14", note: "Billing Export Pipeline", detail: "Write the export schema" },
			{ row: "SS-14", note: "Billing Export Pipeline", detail: "Measure the run time" },
			{ row: "SS-14", note: "Search Ranking Tuning", detail: "Collect the click data" },
			{ row: "SS-14", note: "Home", detail: "Review the quarter goals" },
			...["Fixture Work Note", "Billing Export Pipeline", "Billing Retry Design", "Search Ranking Tuning", "Login Latency Budget"].map(
				(note): ExpectedFinding => ({ row: "SS-15", note }),
			),
			...LISTED.map((note): ExpectedFinding => ({ row: "SS-16", note, detail: "listed" })),
			...COLLAPSED.map((note): ExpectedFinding => ({ row: "SS-16", note, detail: "collapsed" })),
			{ row: "SS-17" },
			...hygiene(0),
		],
	},

	{
		id: "write-clean",
		rows: ["VW-17"],
		steps: [write("Fixture Work Note")],
		expect: [{ row: "VW-17", detail: "silent" }],
	},
	{
		id: "write-memory-file",
		rows: ["VW-03"],
		steps: [{ hook: "validate-write", input: { kind: "memory-write", file: "lesson.md" } }],
		expect: [
			{ row: "VW-17", detail: "additional context" },
			{ row: "VW-03", detail: "lesson.md" },
		],
	},
	{
		id: "write-no-frontmatter",
		rows: ["VW-07"],
		steps: [write("Loose Draft")],
		expect: [
			{ row: "VW-17", detail: "additional context" },
			{ row: "VW-07", note: "Loose Draft" },
		],
	},
	{
		id: "write-missing-global-fields",
		rows: ["VW-08"],
		steps: [write("Missing Fields")],
		expect: [
			{ row: "VW-17", detail: "additional context" },
			{ row: "VW-08", note: "Missing Fields", detail: "description" },
			{ row: "VW-08", note: "Missing Fields", detail: "tags" },
		],
	},
	{
		id: "write-missing-typed-field",
		rows: ["VW-09"],
		steps: [write("Ben Ortiz")],
		expect: [
			{ row: "VW-17", detail: "additional context" },
			{ row: "VW-09", note: "Ben Ortiz", detail: "title" },
		],
	},
	{
		id: "write-incident-without-tag",
		rows: ["VW-09"],
		steps: [write("Checkout Outage RCA")],
		expect: [{ row: "VW-17", detail: "silent" }],
	},
	{
		id: "write-no-links",
		rows: ["VW-10"],
		steps: [write("No Links")],
		expect: [
			{ row: "VW-17", detail: "additional context" },
			{ row: "VW-10", note: "No Links" },
		],
	},
	{
		id: "write-hard-wrap",
		rows: ["VW-11"],
		steps: [write("Wrapped Prose")],
		expect: [
			{ row: "VW-17", detail: "additional context" },
			{ row: "VW-11", note: "Wrapped Prose", count: 2 },
		],
	},
	{
		id: "write-ticket-links",
		rows: ["VW-12"],
		steps: [write("Ticket Links")],
		expect: [
			{ row: "VW-17", detail: "additional context" },
			{ row: "VW-12", note: "Ticket Links", count: 2 },
		],
	},
	{
		id: "write-oversized",
		rows: ["VW-14"],
		steps: [write("Runbook")],
		expect: [
			{ row: "VW-17", detail: "additional context" },
			{ row: "VW-14", note: "Runbook", sizeKb: 26 },
		],
	},
	{
		id: "write-near-size-limit",
		rows: ["VW-14"],
		steps: [write("Near Limit Runbook")],
		expect: [{ row: "VW-17", detail: "silent" }],
	},
	{
		id: "write-oversized-archive",
		rows: ["VW-14"],
		steps: [write("Runbook Archive")],
		expect: [{ row: "VW-17", detail: "silent" }],
	},
	{
		id: "write-joins-cluster",
		rows: ["VW-15"],
		steps: [write("Billing Retry Design")],
		expect: [
			{ row: "VW-17", detail: "additional context" },
			{ row: "VW-15", note: "Billing Retry Design", detail: BILLING_CLUSTER, count: 1 },
		],
	},

	{
		id: "prompt-signals",
		rows: ["UP-03", "UP-05", "UP-06", "UP-07", "UP-08", "UP-09", "UP-10", "UP-12", "UP-14"],
		steps: [
			prompt("We decided to keep the nightly export."),
			prompt("There was an outage on the checkout page."),
			prompt("Notes of my 1:1 are below."),
			prompt("The sales team gave us kudos."),
			prompt("Here is the system design of the queue."),
			prompt("Ada told me about the plan."),
			prompt("The sprint ends on Friday."),
		],
		expect: (["UP-03", "UP-05", "UP-06", "UP-07", "UP-08", "UP-09", "UP-10"] as const).flatMap(
			(row, step): ExpectedFinding[] => [
				{ row: "UP-14", step, detail: "additional context" },
				{ row: "UP-12", step, count: 1 },
				{ row, step },
			],
		),
	},
	{
		id: "prompt-decision-reversal",
		rows: ["UP-03", "UP-04"],
		steps: [prompt("We decided to drop the cache, so the old choice is superseded.")],
		expect: [
			{ row: "UP-14", detail: "additional context" },
			{ row: "UP-12", count: 2 },
			{ row: "UP-03" },
			{ row: "UP-04" },
		],
	},
	{
		id: "prompt-hint-once-per-session",
		rows: ["UP-11"],
		steps: [prompt("We decided to keep the nightly export."), prompt("We decided to keep the weekly export.")],
		expect: [
			{ row: "UP-14", step: 0, detail: "additional context" },
			{ row: "UP-12", step: 0, count: 1 },
			{ row: "UP-03", step: 0 },
			{ row: "UP-14", step: 1, detail: "silent" },
		],
	},
	{
		id: "prompt-hint-without-session",
		rows: ["UP-11"],
		steps: [
			prompt("We decided to keep the nightly export.", { session_id: "" }),
			prompt("We decided to keep the weekly export.", { session_id: "" }),
		],
		expect: [0, 1].flatMap((step): ExpectedFinding[] => [
			{ row: "UP-14", step, detail: "additional context" },
			{ row: "UP-12", step, count: 1 },
			{ row: "UP-03", step },
		]),
	},
	{
		id: "prompt-no-signal",
		rows: ["UP-14"],
		steps: [prompt("What is the time in Lisbon?")],
		expect: [{ row: "UP-14", detail: "silent" }],
	},
	{
		id: "prompt-bad-stdin",
		rows: ["UP-01"],
		steps: [
			{ hook: "classify-message", input: { kind: "raw", stdin: "" } },
			{ hook: "classify-message", input: { kind: "raw", stdin: "{not json" } },
		],
		expect: [
			{ row: "UP-01", step: 0, detail: "silent" },
			{ row: "UP-01", step: 1, detail: "silent" },
		],
	},

	{
		id: "stop-then-prompt",
		rows: ["ST-03", "ST-04", "ST-05", "ST-09", "UP-02", ...HYGIENE_ROWS],
		steps: [payload("stop-checklist"), prompt("What is the time in Lisbon?")],
		expect: [
			{ row: "ST-09", step: 0, detail: "system message" },
			...hygieneClaims(0),
			{ row: "UP-14", step: 1, detail: "additional context" },
			{ row: "UP-02", step: 1 },
			checklist(1),
			{ row: "ST-04", step: 1 },
			...hygiene(1),
		],
	},
	{
		id: "stop-twice",
		rows: ["ST-06", "ST-07", "ST-09"],
		steps: [payload("stop-checklist"), payload("stop-checklist")],
		expect: [
			{ row: "ST-09", step: 0, detail: "system message" },
			...hygieneClaims(0),
			{ row: "ST-07", step: 1, detail: "empty envelope" },
		],
	},
	{
		id: "stop-standdown",
		rows: ["ST-01"],
		steps: [payload("stop-checklist", { om_mod: "standdown" })],
		expect: [{ row: "ST-01", detail: "empty envelope" }],
	},
	{
		id: "stop-reentry",
		rows: ["ST-02"],
		steps: [payload("stop-checklist", { stop_hook_active: true })],
		expect: [{ row: "ST-02", detail: "empty envelope" }],
	},
	{
		id: "stop-report-data",
		rows: ["ST-03", "ST-04", "ST-06", "ST-08", ...HYGIENE_ROWS],
		steps: [payload("stop-checklist", { om_mod: "report" })],
		expect: [
			{ row: "ST-08", detail: "report data" },
			{ row: "ST-06", detail: "key" },
			checklist(0),
			{ row: "ST-04" },
			...hygiene(0),
		],
	},
	{
		id: "stop-handoff-blocked",
		rows: ["ST-03", "ST-04", "ST-10", ...HYGIENE_ROWS],
		steps: [payload("stop-checklist")],
		blockHandoff: true,
		expect: [
			{ row: "ST-10", detail: "system message and feedback" },
			checklist(0),
			{ row: "ST-04" },
			...hygiene(0),
		],
	},
	{
		id: "stop-full-message",
		rows: ["ST-03", "ST-04", "ST-11", ...HYGIENE_ROWS],
		steps: [payload("stop-checklist", { hook_event_name: "SessionEnd" }), payload("stop-checklist", { session_id: "" })],
		expect: [0, 1].flatMap((step): ExpectedFinding[] => [
			{ row: "ST-11", step, detail: "system message" },
			checklist(step),
			{ row: "ST-04", step },
			...hygiene(step),
		]),
	},

	{
		id: "pre-compact-backup",
		rows: ["PC-03", "PC-04"],
		steps: [payload("pre-compact", { trigger: "auto", custom_instructions: "" })],
		expect: [
			{ row: "PC-01", detail: "silent" },
			{ row: "PC-03", detail: "auto", count: 1 },
			{ row: "PC-04", count: 1 },
		],
	},
	{
		id: "pre-compact-retention",
		rows: ["PC-03", "PC-04"],
		steps: [payload("pre-compact", { trigger: "manual", custom_instructions: "" })],
		oldSessionLogs: 31,
		expect: [
			{ row: "PC-01", detail: "silent" },
			{ row: "PC-03", detail: "manual", count: 1 },
			{ row: "PC-04", count: 30 },
		],
	},
	{
		id: "pre-compact-bad-stdin",
		rows: ["PC-01"],
		steps: [{ hook: "pre-compact", input: { kind: "raw", stdin: "{not json" } }],
		expect: [
			{ row: "PC-01", detail: "silent" },
			{ row: "PC-04", count: 0 },
		],
	},
];

export const FIXTURE: FixtureSpec = { notes, repoFiles, scenarios };
