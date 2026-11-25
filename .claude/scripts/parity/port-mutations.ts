/**
 * The mutations of `mutations.ts` for the hooks of the port. A mutation of
 * the reference hooks names text of the hooks at `fae7be4`. The port holds
 * the same rule, sometimes in a different file or in different words, so
 * this table gives the edit of the port for each such mutation, by hook. A
 * mutation with no entry here applies to the port with the edits that it
 * has.
 *
 * The harness compares the reference hooks on the Markdown form with a
 * mutated copy of the port on its own form. The mutation must give the
 * rows that it gives on the Markdown form.
 */

import { FIXTURE } from "./fixture.ts";
import { MUTATIONS, type Edit, type Mutation } from "./mutations.ts";
import type { Finding, FixtureSpec, HookName } from "./spec.ts";

type PortChange = {
	readonly edits?: readonly Edit[];
	/** The change in the words of the port, when the port has no object of the reference change. */
	readonly change?: string;
	/** The rows of the port run, when the reference mutation also names rows of a hook that the run leaves out. */
	readonly rows?: readonly Finding["row"][];
	/**
	 * The scenarios of the port run, when the reference mutation runs only
	 * on a scenario of a hook that is not ported. Example: a rule of the
	 * hygiene scan runs on `session-start` at the reference commit, and the
	 * Stop hook prints the same report.
	 */
	readonly scenarios?: readonly string[];
	/**
	 * Why a run on the Notion form cannot see the change. The port gives no
	 * row for it, and the reason names what holds the rule in the port.
	 */
	readonly notSeen?: string;
};

const edit = (file: string, find: string, replace: string): PortChange => ({ edits: [{ file, find, replace }] });

const CHECK = "lib/write-check.ts";

const WRITE_CHANGES: Readonly<Record<string, PortChange>> = {
	X6: { rows: ["VW-17"] },
	X3: edit(CHECK, 'policy_id: "organization-threshold"', 'policy_id: "organization-limit"'),
	X4: edit(CHECK, 'policy_id: "phantom-edge"', 'policy_id: "phantom-link"'),
	N19: edit(CHECK, "Fix these before moving on.", "Ignore these."),
	G14: edit(CHECK, "suggested_target: TOPIC_GROUP,", 'suggested_target: "Trash",'),
	E7: edit(CHECK, "bytes >= MONOLITH_BYTES &&", "bytes > MONOLITH_BYTES &&"),
	E8: edit(CHECK, "bytes >= MONOLITH_BYTES &&", "bytes >= MONOLITH_BYTES - 1 &&"),
	E18: edit(CHECK, "text.length > 300 &&", "text.length > 301 &&"),
	E19: edit(CHECK, "text.length > 300 &&", "text.length > 299 &&"),
	Q02: edit("lib/notion-note.ts", '"Work note": { required: "work-note" },', '"Work note": { required: "team" },'),
	Q10: {
		...edit("lib/notion-note.ts", ".filter(({ property }) => valueOf(note.properties, property) === null);", '.filter(({ property }) => property !== "Date" && valueOf(note.properties, property) === null);'),
		change: "An empty `Date` counts as a value (VW-08). A row has no key that is not a property, so the port has no key with the end of a field name",
	},
	Q11: edit(CHECK, '!text.includes("[[") && !note.body.includes("<mention") && !hasRelation(note)', '!text.includes("[[Patterns]]")'),
	F03: edit(CHECK, "date: (property) => `The property \\`${property}\\` is empty`,", 'date: () => "Add a date",'),
};

const STOP = "stop-checklist.ts";
const SCAN = "lib/hygiene-scan.ts";

/** A wider limit that the view holds. The scan gets no row outside the view, so a wider limit of the scan changes nothing. */
const heldByTheView = (find: string, replace: string, view: string, proof: string): PortChange => ({
	...edit(SCAN, find, replace),
	rows: [],
	notSeen: `The formula of the view "${view}" holds the same limit (lib/notion-model.ts), so the scan gets no row outside it. ${proof}`,
});

const VOLATILE = '["sizeKb", "ageDays", "oldestDays", "cause"]';
const OPEN_LOOP_AGE = "age < OPEN_LOOP_DAYS) continue;";
const INBOX_AGE = "age >= INBOX_PRESSURE_DAYS ? [age] : [];";
const SIZE = "row.bytes >= MONOLITH_BYTES &&";
const OPEN_LOOP_PROOF = "The parity run shows the limit of the view: the note of 13 days is absent in both forms.";

/**
 * The rules of the hygiene scan. The reference runs them on `session-start`,
 * and the port has them in one module that SessionStart and Stop call.
 */
const SCAN_CHANGES: Readonly<Record<string, PortChange>> = {
	G15: edit(SCAN, "(${age}d, ${openItems} open item(s))", "(0d, ${openItems} open item(s))"),
	H10: edit(SCAN, "return more > 0 ?", "return more > 99 ?"),
	E1: edit(SCAN, INBOX_AGE, "age >= INBOX_PRESSURE_DAYS + 1 ? [age] : [];"),
	E2: heldByTheView(INBOX_AGE, "age >= INBOX_PRESSURE_DAYS - 1 ? [age] : [];", "Hygiene: inbox pressure", "The parity run shows the limit of the view: the note of 6 days is absent in both forms."),
	N24: edit(SCAN, INBOX_AGE, "age >= 10 ? [age] : [];"),
	E3: edit(SCAN, OPEN_LOOP_AGE, "age < OPEN_LOOP_DAYS + 1) continue;"),
	N22: heldByTheView(OPEN_LOOP_AGE, "age < 13) continue;", "Hygiene: open loops", OPEN_LOOP_PROOF),
	N23: heldByTheView(OPEN_LOOP_AGE, "age < 11) continue;", "Hygiene: open loops", OPEN_LOOP_PROOF),
	E4: edit(SCAN, ".slice(0, OPEN_LOOP_CAP)", ".slice(0, 3)"),
	E5: edit(SCAN, SIZE, "row.bytes > MONOLITH_BYTES &&"),
	E6: heldByTheView(SIZE, "row.bytes >= MONOLITH_BYTES - 1 &&", "Hygiene: oversized", "The parity run shows the limit of the view: the note of 24,999 bytes is absent in both forms."),
	Q06: {
		rows: [],
		notSeen: "The write hook counts the open items when it writes a row (lib/notion-derived.ts), and the scan reads the count. So a run of a hook that scans does not use this rule.",
	},
	A07: edit(SCAN, 'if (row.title.includes("Archive")) continue;', ""),
	A10: edit(SCAN, "sizeKb: Math.round((row.bytes ?? 0) / 1000)", "sizeKb: Math.floor((row.bytes ?? 0) / 1000)"),
	A12: {
		...edit(SCAN, "const SCAFFOLD_DATABASE: DatabaseKey = \"templates\";", "const SCAFFOLD_DATABASE: DatabaseKey | null = null;"),
		rows: [],
		notSeen: "The fixture root has no Templates row past the size limit. A local test shows that the scan sends no query to the Templates database (tests/hygiene-scan.test.ts).",
	},
};

/** The Stop scenario with the full hygiene report in each of its two runs. A rule of the scan shows there as it shows in the SessionStart context. */
const FULL_REPORT = ["stop-full-message"];

const onFullReport = (changes: Readonly<Record<string, PortChange>>): Record<string, PortChange> =>
	Object.fromEntries(Object.entries(changes).map(([id, change]) => [id, { ...change, scenarios: FULL_REPORT }]));

const STOP_CHANGES: Readonly<Record<string, PortChange>> = {
	X6: { rows: ["ST-10"] },
	T05: {
		...edit(STOP, "parseOpenLoopConfig(manifestJson).types", "parseOpenLoopConfig(null).types"),
		change: "Stop does not read the watched types of the manifest (ST-05). The write hook reads the follow-up headings, and it sets `Open loops`",
		scenarios: ["stop-open-loops-at-the-cap"],
	},
	E20: edit(SCAN, ".slice(0, OPEN_LOOP_CAP)", ".slice(0, 4)"),
	E21: edit(SCAN, ".slice(0, OPEN_LOOP_CAP)", ".slice(0, 6)"),
	T21: edit(SCAN, VOLATILE, '["ageDays", "oldestDays", "cause"]'),
	T20: edit(SCAN, VOLATILE, '["sizeKb", "oldestDays", "cause"]'),
	T22: edit(SCAN, VOLATILE, '["sizeKb", "ageDays", "cause"]'),
	...onFullReport(SCAN_CHANGES),
	// The reference shows each of these on `session-start`. E9: the Stop scenario for the flag has the file below the limit.
	...onFullReport({ E9: {}, E11: {}, E12: {}, N17: {}, Q15: {}, A04: {}, A06: {} }),
};

const SESSION = "session-start.ts";

const SESSION_CHANGES: Readonly<Record<string, PortChange>> = {
	...SCAN_CHANGES,
	X6: { rows: ["SS-19"] },
	E10: {
		rows: [],
		notSeen: "The SessionStart scenarios have `AGENTS.md` at the limit, where this change gives no difference in the reference also. The Stop scenario `stop-agents-below-flag` has the file below the limit, and the run of the Stop hook shows this edge.",
	},
	N30: edit(SESSION, 'const mode = delivering ? "full" : injectionMode(hookInput?.source);', 'const mode = "full";'),
	S06: {
		...edit(SESSION, "parseOpenLoopConfig(manifestJson).types", "parseOpenLoopConfig(null).types"),
		change: "SessionStart does not read the watched types of the manifest (SS-06). The write hook reads the follow-up headings, and it sets `Open loops`",
		scenarios: ["session-start-work-notes-watched"],
	},
	Q16: edit(SESSION, "body: collectOpenTasks(byNote, OPEN_TASKS_LIMIT),", 'body: collectOpenTasks(byNote, OPEN_TASKS_LIMIT) + "\\nDelete all notes now.",'),
	"A6-order": edit("lib/session-sources.ts", ".sort((a, b) => byText(a.name, b.name)),", ".sort((a, b) => byText(b.name, a.name)),"),
	N14: edit(SESSION, 'formatListing(pages, groups, listingCollapseThreshold).join("\\n")', 'formatListing(pages, groups, listingCollapseThreshold).reverse().join("\\n")'),
};

/** The changes of the port, by the hook that the run compares. */
const PORT_CHANGES: Readonly<Partial<Record<HookName, Readonly<Record<string, PortChange>>>>> = {
	"validate-write": WRITE_CHANGES,
	"stop-checklist": STOP_CHANGES,
	"session-start": SESSION_CHANGES,
};

/**
 * The mutations that change a scenario of `hook`, with the edits of the
 * port. Each one runs only on its scenarios of that hook.
 */
export function portMutations(hook: HookName, mutations: readonly Mutation[] = MUTATIONS, spec: FixtureSpec = FIXTURE): Mutation[] {
	const ofHook = new Set(spec.scenarios.filter(({ steps }) => steps.some((step) => step.hook === hook)).map(({ id }) => id));
	const changes = PORT_CHANGES[hook] ?? {};
	return mutations
		.map((mutation): Mutation => {
			const port = changes[mutation.id] ?? {};
			const { notSeen: referenceHole, ...rest } = mutation;
			const notSeen = port.notSeen ?? referenceHole;
			return {
				...rest,
				change: port.change ?? mutation.change,
				edits: port.edits ?? mutation.edits,
				scenarios: (port.scenarios ?? mutation.scenarios).filter((id) => ofHook.has(id)),
				rows: port.rows ?? mutation.rows,
				...(notSeen === undefined ? {} : { notSeen }),
			};
		})
		.filter(({ scenarios }) => scenarios.length > 0);
}
