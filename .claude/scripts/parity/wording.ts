/**
 * The text of the hook output, by kind. Part (d) of `NOTION-PORT-DESIGN.md`
 * lets the wording change to name Notion objects, so each form gives its own
 * pattern for each kind. The finding of a kind is stated here one time, and
 * it is the same for both forms.
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
 */
export type Capture = "note" | "notes" | "group" | "token" | "field" | "detail" | "count" | "sizeKb" | "items";

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
	| "claim"
	| "item"
	| "report"
	| "preface"
	| "summary"
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
	readonly captures?: readonly Capture[];
	/** The place of each item of `items`, when an item gives a finding of its own. */
	readonly each?: Place;
};

export const TEXTS = {
	"session title": { in: "session", row: "SS-19", detail: "session title" },
	"size meter": { in: "session", row: "SS-19", detail: "size meter" },
	"section date": { in: "section" },
	"section north star": { in: "section" },
	"section brain topics": { in: "section" },
	"section recent changes": { in: "section" },
	"section open tasks": { in: "section" },
	"section active work": { in: "section" },
	"section listing": { in: "section" },
	"section hygiene": { in: "section", row: "SS-17" },
	"date line": { in: "date", row: "SS-10", detail: "date line" },
	"north star hidden items": { in: "north star", row: "SS-11", detail: "completed items hidden", captures: ["count"] },
	"north star line": { in: "north star", row: "SS-11", captures: ["detail"] },
	"brain topic": { in: "brain topics", row: "SS-12", captures: ["note", "detail"] },
	"no recent changes": { in: "recent changes", row: "SS-13", detail: "no history" },
	"recent change": { in: "recent changes", row: "SS-13", detail: "entry" },
	"open task": { in: "open tasks", row: "SS-14", captures: ["detail"] },
	"no open tasks": { in: "open tasks" },
	"open tasks note": { in: "open tasks", captures: ["note"] },
	"no active work": { in: "active work" },
	"active note": { in: "active work", row: "SS-15", captures: ["note"] },
	"listing collapsed": { in: "listing", row: "SS-16", detail: "collapsed", captures: ["group", "count"] },
	"listing note": { in: "listing", row: "SS-16", detail: "listed", captures: ["note"] },

	"claim HY-07": { in: "claim", row: "HY-07", captures: ["detail"] },
	"claim HY-09": { in: "claim", row: "HY-09", captures: ["sizeKb"] },
	"claim HY-01": { in: "claim", row: "HY-01", captures: ["count"] },
	"claim HY-02": { in: "claim", row: "HY-02" },
	"claim HY-03": { in: "claim", row: "HY-03", captures: ["count"] },
	"claim HY-04": { in: "claim", row: "HY-04", captures: ["count"] },
	"claim HY-05": { in: "claim", row: "HY-05", captures: ["count"] },
	"more items": { in: "item", captures: ["count"] },
	"item HY-01": { in: "item", row: "HY-01", captures: ["note"] },
	"item HY-02": { in: "item", row: "HY-02", captures: ["token", "notes"] },
	"item HY-03": { in: "item", row: "HY-03", captures: ["note", "sizeKb"] },
	"item HY-04": { in: "item", row: "HY-04", captures: ["note", "count"] },

	"checklist header": { in: "report" },
	"hygiene header": { in: "report", row: "ST-04" },
	"hand-over preface": { in: "preface", row: "ST-09", detail: "preface" },
	"mod preface": { in: "preface", row: "ST-08", detail: "preface" },
	"feedback preface": { in: "preface", row: "ST-10", detail: "preface" },
	"checklist summary": { in: "summary", row: "ST-03", detail: "summary", captures: ["items"] },
	"summary claims": { in: "summary", captures: ["items"], each: "claim" },
	"hand-over trailer": { in: "summary", row: "ST-09", detail: "trailer" },
	"feedback trailer": { in: "summary", row: "ST-10", detail: "trailer" },

	"memory file": { in: "write", row: "VW-03", captures: ["detail"] },
	"warnings": { in: "write", captures: ["note", "items"], each: "warning" },
	"oversized note": { in: "write", row: "VW-14", captures: ["note", "sizeKb"] },
	"topic cluster": { in: "write", row: "VW-15", captures: ["count", "token", "notes"] },
	"warning VW-07": { in: "warning", row: "VW-07" },
	"warning VW-08": { in: "warning", row: "VW-08", captures: ["field"] },
	"warning VW-09": { in: "warning", row: "VW-09", captures: ["field"] },
	"warning VW-10": { in: "warning", row: "VW-10" },
	"warning VW-11": { in: "warning", row: "VW-11", captures: ["count"] },
	"warning VW-12": { in: "warning", row: "VW-12", captures: ["count"] },

	"hints": { in: "prompt", row: "UP-12", captures: ["items"], each: "hint" },
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
 * The wording of one form: the pattern of each kind of text. A pattern
 * matches one line, or one block when the kind is a block of lines. Text
 * that no pattern of its place matches becomes an `UNMAPPED` finding, so a
 * kind with no pattern shows as a difference and never as agreement.
 */
export type Wording = Readonly<Partial<Record<TextKind, RegExp>>>;

const textOf = (kind: TextKind): Text => TEXTS[kind];

/** The named groups that the pattern of `kind` must have. */
export const capturesOf = (kind: TextKind): readonly Capture[] => textOf(kind).captures ?? [];

/** The kinds of `place`, in the order in which the harness tries them. */
export const kindsIn = (place: Place): TextKind[] => (Object.keys(TEXTS) as TextKind[]).filter((kind) => textOf(kind).in === place);

/** The row and the fixed detail of `kind`. */
export const findingOf = (kind: TextKind): Pick<Text, "row" | "detail"> => textOf(kind);

/** The place of each item of the list that `kind` captures. */
export const itemPlaceOf = (kind: TextKind): Place | undefined => textOf(kind).each;
