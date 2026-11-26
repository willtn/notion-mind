/**
 * A small fixture spec for the tests of the Notion form. It has one note
 * for each place that a note can have in Notion, and it does not change
 * when the parity fixture set gets a note.
 */

import type { FixtureNote, FixtureSpec } from "../parity/spec.ts";

const LINE = "This line is filler text that keeps each paragraph on one line.";
const filler = (title: string, bytes: number): string => `# ${title}\n\nSee [[Patterns]].\n${`\n${LINE}\n`.repeat(Math.ceil(bytes / (LINE.length + 2)))}`;
const global = (description: string, tags: readonly string[]) => ({ date: "2026-01-05", description, tags });

const notes: readonly FixtureNote[] = [
	{ title: "Home", type: "Home", fields: {}, body: "# Home\n\nStart at [[North Star]].\n\n- [ ] Review the goals\n", changedDaysAgo: 1 },
	{
		title: "North Star",
		type: "North Star",
		fields: global("The goals", ["north-star"]),
		body: "# North Star\n\nAn introduction.\n\n## Current Focus\n\n- Ship the export.\n- ~~Close the migration.~~\n\n## Longer Term\n\n- Grow the team.\n",
		changedDaysAgo: 5,
	},
	{ title: "Patterns", type: "Brain topic", fields: { date: "2026-01-05", tags: ["brain"] }, body: "# Patterns\n\n- Name the data shape first.\n", changedDaysAgo: 9 },
	{ title: "Gotchas", type: "Brain topic", fields: global("The traps", ["brain"]), body: "# Gotchas\n\nNo entry yet.\n", changedDaysAgo: 9 },
	{
		title: "Export Pipeline",
		type: "Work note",
		fields: { ...global("The export of invoices", ["work-note"]), status: "active", quarter: "Q1-2026" },
		body: "# Export Pipeline\n\nThe export runs each night. See [[Patterns]].\n\n- [ ] Write the schema\n- [x] Pick the format\n- [ ] Measure the run time\n",
		changedDaysAgo: 2,
	},
	{
		title: "Pricing Rollout",
		type: "Work note",
		fields: { ...global("The new price list", ["work-note"]), status: "active", quarter: "Q1-2026", project: "Pricing" },
		body: "# Pricing Rollout\n\nThe list goes out by region. See [[Patterns]].\n\n- [ ] Tell the sales team\n",
		changedDaysAgo: 3,
	},
	{
		title: "Outage",
		type: "Incident",
		fields: { ...global("The checkout failed", ["incident", "work-note"]), status: "active", quarter: "Q1-2026", ticket: "OPS-41", severity: "high", role: "incident-lead" },
		body: "# Outage\n\nThe gateway refused each request. See [[Patterns]].\n\nWaiting on the vendor for the root cause.\n\n## What to Watch\n\n- [ ] The error rate\n",
		changedDaysAgo: 25,
	},
	{ title: "Outage RCA", type: "Incident", fields: global("The root cause analysis", ["work-note"]), body: "# Outage RCA\n\nThe analysis sits beside [[Outage]].\n", changedDaysAgo: 20 },
	{
		title: "Ada Park 2026-02-07",
		type: "1:1",
		fields: { ...global("A 1:1 meeting", ["work-note"]), quarter: "Q1-2026", person: "Ada Park" },
		body: "# Ada Park 2026-02-07\n\nA meeting with [[Ada Park]].\n\n## Action Items\n\n- [ ] Send the notes\n- [ ] Book the next meeting\n",
		changedDaysAgo: 14,
	},
	{
		title: "Planning Export",
		type: "Inbox item",
		fields: { ...global("A raw meeting export", ["meeting"]), status: "inbox" },
		body: "# Planning Export\n\nThe raw export. See [[Patterns]].\n\n## Follow Ups\n\n- [ ] Send the summary\n",
		changedDaysAgo: 7,
	},
	{
		title: "Fresh Export",
		type: "Inbox item",
		fields: { ...global("A raw meeting export", ["meeting"]), status: "inbox" },
		body: "# Fresh Export\n\nThe raw export. See [[Patterns]].\n\n## Action Items\n\n- [ ] Send the summary\n",
		changedDaysAgo: 6,
	},
	{ title: "Ada Park", type: "Person", fields: { ...global("A staff engineer", ["person"]), title: "Staff Engineer" }, body: "# Ada Park\n\nAda leads the export. See [[Patterns]].\n", changedDaysAgo: 30 },
	{ title: "Runbook", type: "Reference", fields: global("A runbook past the size limit", ["reference"]), body: filler("Runbook", 26_000), changedDaysAgo: 12 },
	{ title: "Runbook Archive", type: "Archive note", fields: global("The old entries", ["reference"]), body: filler("Runbook Archive", 30_000), changedDaysAgo: 100 },
	{ title: "Ticket Links", type: "Reference", fields: global("A note with two ticket IDs", ["reference"]), body: "# Ticket Links\n\nThe work is in [[PROJ-123]] and [[OPS-9]]. See [[Patterns]].\n", changedDaysAgo: 1 },
	{ title: "Loose Draft", type: "Loose page", fields: {}, body: "# Loose Draft\n\nA page outside the databases. See [[Patterns]].\n", changedDaysAgo: 1 },
];

export const SPEC: FixtureSpec = {
	notes,
	repoFiles: [
		{
			path: "vault-manifest.json",
			content: JSON.stringify({ open_loop_dirs: ["work/1-1", "work/meetings", "work/incidents"], open_loop_sections: ["action items", "what to watch", "follow ups"] }),
		},
	],
	scenarios: [],
};

export const note = (title: string): FixtureNote => {
	const found = notes.find((candidate) => candidate.title === title);
	if (found === undefined) throw new Error(`The test spec has no note "${title}".`);
	return found;
};
