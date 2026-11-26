/**
 * The text of the hook output, by kind. Part (d) of `NOTION-PORT-DESIGN.md`
 * lets the wording change only to name Notion objects. So each form gives
 * its own pattern for each kind and its own names for the objects, and the
 * harness compares the rest of the text. The finding of a kind is stated
 * here one time, and it is the same for both forms.
 */

import type { RowId } from "./rows.ts";

/**
 * A named group of a pattern, and what the harness makes of the text:
 *
 * - `note`: a reference to one note. `HookEnvironment.noteOf` gives the title.
 * - `notes`: references with ", " between them. Each becomes a title.
 * - `group`: a group of notes on one line. `HookEnvironment.notesIn` gives
 *   the titles, and each note gets one finding.
 * - `token`: the word that the notes of a cluster share.
 * - `field`: a frontmatter key or a Notion property. The finding names the property.
 * - `detail`: text that is equal in both forms.
 * - `count` and `sizeKb`: numbers.
 * - `items`: a list with " · " or a line break between the items. The count
 *   of the finding is the number of items.
 * - `formText`: text that the two forms cannot state in the same way. The
 *   harness does not compare it. Only a kind with `notCompared` has it.
 */
export type Capture = "note" | "notes" | "group" | "token" | "field" | "detail" | "count" | "sizeKb" | "items" | "formText";

/** The part of the hook output where a kind of text can occur. */
export type Place =
	| "session"
	| "section"
	| "date"
	| "north star"
	| "brain topics"
	| "recent changes"
	| "open tasks"
	| "active work"
	| "listing"
	| "context pointer"
	| "claim"
	| "item"
	| "report"
	| "preface"
	| "checklist"
	| "summary"
	| "summary item"
	| "write"
	| "warning"
	| "prompt"
	| "hint";

type Text = {
	/** The kinds of one place are tried in the order of this table. */
	readonly in: Place;
	/** The row of the finding. Text with no row gives no finding. It shows where a part of the output starts. */
	readonly row?: RowId;
	/** A fixed start of the detail of the finding. */
	readonly detail?: string;
	/** The named groups that the pattern of each form must have. */
	readonly captures?: readonly Exclude<Capture, "formText">[];
	/**
	 * The shape of the text that the harness does not compare. The pattern
	 * of each form has the group `formText` for it. This table states the
	 * shape, and not the form, so the pattern of a form cannot make the
	 * part larger: text of a different shape is not text of this kind.
	 * The kinds with this field are the full list of the text that is not
	 * compared.
	 */
	readonly notCompared?: RegExp;
	/** The place of each item of `items`, when an item gives a finding of its own. */
	readonly each?: Place;
	/** A start of the detail of each item, to tell this list from a different list of the same kinds. */
	readonly itemLabel?: string;
	/** The detail of the finding also gives the rows of the items in their order. */
	readonly ordered?: true;
	/** The detail of the finding ends with the position of the text in its list. */
	readonly numbered?: true;
	/**
	 * The text is only data. Each part is a field of the finding, and the
	 * rest is the syntax of the form: a link, a path, a list mark. So the
	 * finding has no instruction text.
	 */
	readonly data?: true;
};

export const TEXTS = {
	"session title": { in: "session", row: "SS-19", detail: "session title" },
	// The size of the context depends on the wording, so only the budget and the notes after it are compared.
	"size meter": { in: "session", row: "SS-19", detail: "size meter", notCompared: /^[\d.]+kB$/ },
	"section date": { in: "section", row: "SS-19", detail: "header of date" },
	"section north star": { in: "section", row: "SS-19", detail: "header of north star" },
	"section brain topics": { in: "section", row: "SS-19", detail: "header of brain topics" },
	"section recent changes": { in: "section", row: "SS-19", detail: "header of recent changes" },
	"section open tasks": { in: "section", row: "SS-19", detail: "header of open tasks" },
	"section active work": { in: "section", row: "SS-19", detail: "header of active work" },
	"section listing": { in: "section", row: "SS-19", detail: "header of listing" },
	"section context pointer": { in: "section", row: "SS-19", detail: "header of context pointer" },
	"section hygiene": { in: "section", row: "SS-17" },
	"date line": { in: "date", row: "SS-10", detail: "date line" },
	"north star hidden items": { in: "north star", row: "SS-11", detail: "completed items hidden", captures: ["count"] },
	"north star line": { in: "north star", row: "SS-11", captures: ["detail"], data: true },
	"brain topic": { in: "brain topics", row: "SS-12", captures: ["note", "detail"], data: true },
	"no recent changes": { in: "recent changes", row: "SS-13", detail: "no history" },
	"recent change": { in: "recent changes", row: "SS-13", detail: "entry", data: true },
	"open task": { in: "open tasks", row: "SS-14", captures: ["detail"], data: true },
	"no open tasks": { in: "open tasks" },
	"open tasks note": { in: "open tasks", captures: ["note"] },
	"no active work": { in: "active work" },
	"active note": { in: "active work", row: "SS-15", captures: ["note"], data: true },
	// The line names the search tools of the form, and the port has different tools.
	"listing collapsed": { in: "listing", row: "SS-16", detail: "collapsed", captures: ["group", "count"], notCompared: /^[^.!?()\n]{1,40}$/ },
	"listing note": { in: "listing", row: "SS-16", detail: "listed", captures: ["note"], data: true },
	"context pointer": { in: "context pointer", row: "SS-05", detail: "context pointer" },

	"claim HY-07": { in: "claim", row: "HY-07", captures: ["detail"] },
	// The line states where each agent stops reading the file, with the agent versions, and the port has fewer agents. The one-line summary has no such part.
	"claim HY-09": { in: "claim", row: "HY-09", captures: ["sizeKb"], notCompared: /^(?: — \S+ stopped reading it at [^.()\n]{1,80}\([^()\n]{1,80}\))?$/ },
	"claim HY-01": { in: "claim", row: "HY-01", captures: ["count"] },
	"claim HY-02": { in: "claim", row: "HY-02" },
	"claim HY-03": { in: "claim", row: "HY-03", captures: ["count"] },
	"claim HY-04": { in: "claim", row: "HY-04", captures: ["count"] },
	"claim HY-05": { in: "claim", row: "HY-05", captures: ["count"] },
	"more items": { in: "item", row: "HY-10", detail: "more", captures: ["count"] },
	"item HY-01": { in: "item", row: "HY-01", captures: ["note"] },
	"item HY-02": { in: "item", row: "HY-02", captures: ["token", "notes"] },
	"item HY-03": { in: "item", row: "HY-03", captures: ["note", "sizeKb"] },
	"item HY-04": { in: "item", row: "HY-04", captures: ["note", "count"] },

	"checklist header": { in: "report" },
	"hygiene header": { in: "report", row: "ST-04" },
	"hand-over preface": { in: "preface", row: "ST-09", detail: "preface" },
	"mod preface": { in: "preface", row: "ST-08", detail: "preface" },
	"feedback preface": { in: "preface", row: "ST-10", detail: "preface" },
	"checklist item": { in: "checklist", row: "ST-03", detail: "item", numbered: true },
	"checklist summary": { in: "summary", row: "ST-03", detail: "summary", captures: ["items"], each: "summary item" },
	"checklist summary item": { in: "summary item", row: "ST-03", detail: "summary item", numbered: true },
	"summary claims": { in: "summary", captures: ["items"], each: "claim", itemLabel: "summary claim" },
	"hand-over trailer": { in: "summary", row: "ST-09", detail: "trailer" },
	"feedback trailer": { in: "summary", row: "ST-10", detail: "trailer" },

	"memory file": { in: "write", row: "VW-03", captures: ["detail"] },
	"warnings": { in: "write", row: "VW-13", captures: ["note", "items"], each: "warning" },
	"oversized note": { in: "write", row: "VW-14", captures: ["note", "sizeKb"] },
	"topic cluster": { in: "write", row: "VW-15", captures: ["count", "token", "notes"] },
	"warning VW-07": { in: "warning", row: "VW-07" },
	"warning VW-08": { in: "warning", row: "VW-08", captures: ["field"] },
	"warning VW-09": { in: "warning", row: "VW-09", captures: ["field"] },
	"warning VW-10": { in: "warning", row: "VW-10" },
	// The line number counts the frontmatter lines, which only the Markdown form has.
	"warning VW-11": { in: "warning", row: "VW-11", captures: ["count"], notCompared: /^\d+$/ },
	"warning VW-12": { in: "warning", row: "VW-12", captures: ["count"] },

	"hints": { in: "prompt", row: "UP-12", captures: ["items"], each: "hint", ordered: true },
	"hint UP-03": { in: "hint", row: "UP-03" },
	"hint UP-04": { in: "hint", row: "UP-04" },
	"hint UP-05": { in: "hint", row: "UP-05" },
	"hint UP-06": { in: "hint", row: "UP-06" },
	"hint UP-07": { in: "hint", row: "UP-07" },
	"hint UP-08": { in: "hint", row: "UP-08" },
	"hint UP-09": { in: "hint", row: "UP-09" },
	"hint UP-10": { in: "hint", row: "UP-10" },
} as const satisfies Record<string, Text>;

export type TextKind = keyof typeof TEXTS;

/**
 * The neutral names. Both forms share one of them for each object that the
 * instruction text names. The set is closed: it holds the objects that the
 * Markdown wording names, and a form can map a name only to one of them.
 */
export const NEUTRAL_NAMES = [
	"{hygiene}",
	"{North Star}",
	"{brain topics}",
	"{listing}",
	"{loose active notes}",
	"{a topic group}",
	"{oversized notes}",
	"{old open loops}",
	"{old inbox items}",
	"{notes + counts}",
	"{no properties}",
	"{missing field}",
	"{no links}",
	"{verbatim mark}",
	"{the archive move}",
	"{indexes}",
	"{active work}",
	"{decisions log}",
	"{superseded mark}",
	"{incident notes}",
	"{1:1 notes}",
	"{people notes}",
	"{brag doc}",
	"{links}",
	"{patterns note}",
	"{gotchas note}",
	"{decisions note}",
	"{recent context}",
	"{new brain topic}",
	"{reference notes}",
] as const;

export type NeutralName = (typeof NEUTRAL_NAMES)[number];

/**
 * An object name of one form, and the neutral name that both forms share
 * for the object. Example: `["Vault Hygiene", "{hygiene}"]` in the Markdown
 * form and `["Workspace Hygiene", "{hygiene}"]` in the Notion form. A name
 * is plain text and not a pattern.
 */
export type ObjectName = readonly [name: string, neutral: NeutralName];

/** The most characters that an object name can have. The longest name of the Markdown wording has 72. */
export const NAME_MAX_LENGTH = 80;

/**
 * Why `entry` is not an object name, or `null` when it is one. A name can
 * rename an object, and it must not carry an instruction. So the neutral
 * name is one of the closed set, and the name is short, on one line, and
 * not a sentence. The harness applies no entry that has a problem.
 */
export function nameProblem([name, neutral]: readonly [string, string]): string | null {
	if (!(NEUTRAL_NAMES as readonly string[]).includes(neutral)) return "the neutral name is not one of the closed set";
	if (name === "") return "the name is empty";
	if (name.length > NAME_MAX_LENGTH) return `the name has more than ${NAME_MAX_LENGTH} characters`;
	if (/[\r\n]/.test(name)) return "the name has a line break";
	if (/[.!?](?:\s|$)/.test(name)) return "the name holds the end of a sentence";
	return null;
}

/**
 * The wording of one form.
 *
 * `patterns` has the pattern of each kind of text. A pattern matches one
 * line, or one block when the kind is a block of lines. Text that no
 * pattern of its place matches becomes an `UNMAPPED` finding, so a kind
 * with no pattern shows as a difference and never as agreement.
 *
 * `names` has the object names of the form. The harness compares the text
 * of each matched line after it puts the neutral name in the place of each
 * object name. A longer name goes before a shorter name that it contains.
 * An entry that `nameProblem` rejects becomes an `UNMAPPED` finding.
 */
export type Wording = {
	readonly patterns: Readonly<Partial<Record<TextKind, RegExp>>>;
	readonly names: readonly ObjectName[];
};

const textOf = (kind: TextKind): Text => TEXTS[kind];

/** The named groups that the pattern of `kind` must have. */
export const capturesOf = (kind: TextKind): readonly Capture[] => {
	const { captures = [], notCompared } = textOf(kind);
	return notCompared === undefined ? captures : [...captures, "formText"];
};

/** The shape of the text of `kind` that the harness does not compare, when the kind has such text. */
export const notComparedOf = (kind: TextKind): RegExp | undefined => textOf(kind).notCompared;

/** The kinds of `place`, in the order in which the harness tries them. */
export const kindsIn = (place: Place): TextKind[] => (Object.keys(TEXTS) as TextKind[]).filter((kind) => textOf(kind).in === place);

/** The row of `kind` and the fixed parts of its finding. */
export const findingOf = (kind: TextKind): Pick<Text, "row" | "detail" | "itemLabel" | "ordered" | "numbered" | "data"> => textOf(kind);

/** The place of each item of the list that `kind` captures. */
export const itemPlaceOf = (kind: TextKind): Place | undefined => textOf(kind).each;
