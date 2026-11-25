/**
 * The fixture spec of the parity harness: one description of a note set and
 * of the hook runs on it. The Markdown form and the Notion form both read
 * this data, so the two forms cannot hold different notes.
 */

import type { RowId } from "./rows.ts";

/** The Notion database of each note type. `null` is a page outside the databases. */
export const NOTE_TYPES = {
	"Work note": { database: "Work" },
	Incident: { database: "Work" },
	"1:1": { database: "Work" },
	"Inbox item": { database: "Work" },
	Thinking: { database: "Work" },
	Person: { database: "People" },
	"Brain topic": { database: "Knowledge" },
	Reference: { database: "Knowledge" },
	"Archive note": { database: "Knowledge" },
	"North Star": { database: null },
	Home: { database: null },
	"Loose page": { database: null },
} as const satisfies Record<string, { readonly database: string | null }>;

export type NoteType = keyof typeof NOTE_TYPES;

/** The Notion property of each frontmatter field. */
export const PROPERTY_OF_FIELD = {
	date: "Date",
	description: "Description",
	tags: "Tags",
	status: "Status",
	quarter: "Quarter",
	project: "Project",
	person: "Person",
	ticket: "Ticket",
	severity: "Severity",
	role: "Role",
	title: "Role",
} as const satisfies Record<string, string>;

export type Field = keyof typeof PROPERTY_OF_FIELD;

/**
 * A fixture note. A field that is absent is an absent frontmatter key and an
 * empty Notion property. No field holds an empty value, because Notion has
 * no "present but empty" state.
 */
export type FixtureNote = {
	/** The note title, and the note identity in a finding. No two notes share a title. */
	readonly title: string;
	readonly type: NoteType;
	readonly fields: Readonly<Partial<Record<Field, string | readonly string[]>>>;
	/** The Markdown body, with no frontmatter. A `[[Title]]` link names another fixture note. */
	readonly body: string;
	/** The age of the last change, in days. It is the file mtime and the `Changed` property. */
	readonly changedDaysAgo: number;
	/**
	 * A folder that the properties do not give. Only HY-01 needs it: a
	 * completed note that stays under `work/active/` is a state that the
	 * Notion form cannot hold.
	 */
	readonly markdownFolder?: string;
	/** The one note that sits outside the zero-difference gate for VW-14. */
	readonly nearSizeLimit?: true;
};

/**
 * The instant of the last change of `note` for a run that starts at `now`.
 * Both forms use it, so an age rule sees one age.
 */
export const changedAt = (note: FixtureNote, now: Date): Date => new Date(now.getTime() - note.changedDaysAgo * 86_400_000);

/** A file of the repository that stays local in both forms. */
export type RepoFile = { readonly path: string; readonly content: string };

export const HOOKS = {
	"session-start": { script: "session-start.ts", event: "SessionStart" },
	"classify-message": { script: "classify-message.ts", event: "UserPromptSubmit" },
	"validate-write": { script: "validate-write.ts", event: "PostToolUse" },
	"pre-compact": { script: "pre-compact.ts", event: "PreCompact" },
	"stop-checklist": { script: "stop-checklist.ts", event: "Stop" },
} as const;

export type HookName = keyof typeof HOOKS;

export type StepInput =
	/** Fields that go on top of the base payload (session, transcript, directory, event). */
	| { readonly kind: "payload"; readonly fields: Readonly<Record<string, unknown>> }
	/** A write of one fixture note. The form builds the tool fields. */
	| { readonly kind: "write"; readonly note: string }
	/** A `Write` under the automatic memory directory of the home directory. */
	| { readonly kind: "memory-write"; readonly file: string }
	/** Bytes that go to stdin as they are. */
	| { readonly kind: "raw"; readonly stdin: string };

export type Step = { readonly hook: HookName; readonly input: StepInput };

/**
 * One finding of one hook run, in a form that does not depend on the wording
 * or on the store. Two findings are the same finding when `row`, `step`,
 * `note`, and `detail` are equal. `count` is the number that the finding
 * states. `sizeKb` is a measure and not a part of the identity.
 */
export type Finding = {
	readonly row: RowId | "UNMAPPED";
	/** The index of the step in the scenario. */
	readonly step: number;
	/** The title of the fixture note, or `null` when the finding names no note. */
	readonly note: string | null;
	readonly detail: string | null;
	readonly count: number | null;
	readonly sizeKb?: number;
};

/** A finding as a scenario states it, with defaults for the fields that do not apply. */
export type ExpectedFinding = Pick<Finding, "row"> & Partial<Omit<Finding, "row">>;

/**
 * A sequence of hook runs that share one session and one hook state. The
 * state is new at the start of each scenario.
 */
export type Scenario = {
	readonly id: string;
	/** The rows of part (d) that the scenario exercises. */
	readonly rows: readonly RowId[];
	readonly steps: readonly Step[];
	/** The findings that the conditions of part (d) give for this fixture. */
	readonly expect: readonly ExpectedFinding[];
	/** Makes the Stop hand-over file impossible to write (ST-10). */
	readonly blockHandoff?: true;
	/** The number of old transcript copies that exist before the first step (PC-04). */
	readonly oldSessionLogs?: number;
};

export type FixtureSpec = {
	readonly notes: readonly FixtureNote[];
	readonly repoFiles: readonly RepoFile[];
	readonly scenarios: readonly Scenario[];
};

/**
 * Where and how one form runs the hooks. The runner knows only this shape,
 * so the Markdown form and the Notion form are equal to it.
 */
export type HookEnvironment = {
	/** The directory that holds the five hook entry scripts. */
	readonly scriptsDir: string;
	/** The project directory of the hook process. */
	readonly projectDir: string;
	/** Environment variables that only this form needs. */
	readonly env: Readonly<Record<string, string>>;
	/** The directory where the PreCompact hook keeps the transcript copies. */
	readonly sessionLogDir: string;
	/** The PostToolUse payload fields for a write of `note`. */
	readonly writePayload: (note: FixtureNote) => Readonly<Record<string, unknown>>;
	/**
	 * The fixture note that a reference in hook output names. A reference is
	 * a path or a file name in the Markdown form and a title in the Notion
	 * form. `null` means that the reference names no fixture note.
	 */
	readonly noteOf: (reference: string) => string | null;
	/**
	 * The fixture notes of a group that the listing shows as one line. A
	 * group is a folder in the Markdown form.
	 */
	readonly notesIn: (group: string) => readonly string[];
};

/**
 * A form of the fixture. It gives each scenario its environment. `dir` is an
 * empty directory that the scenario owns, for the local files of the form.
 */
export type HookForm = (dir: string) => HookEnvironment;
