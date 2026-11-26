/**
 * The wording of the ported hooks. The pull request that ports a hook adds
 * the patterns of that hook here, and the Notion names of the objects in
 * its instruction text. A kind with no pattern gives `UNMAPPED` findings,
 * so the parity run of a hook fails until its wording is here.
 */

import { MARKDOWN_WORDING } from "./markdown-wording.ts";
import type { TextKind, Wording } from "./wording.ts";

/**
 * The kinds whose text names no note store: the report of a local file and
 * the Stop report around the findings. The port must print the text of
 * `fae7be4` for each one, so the pattern is the pattern of the Markdown form.
 */
const SAME_TEXT = [
	"claim HY-07",
	"claim HY-09",
	"more items",
	"checklist header",
	"hand-over preface",
	"mod preface",
	"feedback preface",
	"checklist item",
	"checklist summary",
	"checklist summary item",
	"summary claims",
	"hand-over trailer",
	"feedback trailer",
	// A Stop scenario ends with a prompt that gets the report. One such prompt also gets this hint, and the prompt hook is not ported yet.
	"hints",
	"hint UP-03",
] as const satisfies readonly TextKind[];

export const NOTION_WORDING: Wording = {
	patterns: {
		...Object.fromEntries(SAME_TEXT.map((kind) => [kind, MARKDOWN_WORDING.patterns[kind]] as const)),

		// HY-01 has no pattern: `Status` is the only place for state, so the port has no such line (part d.3).
		"claim HY-02": /^Active rows with no `Project` that look like one topic/,
		"claim HY-03": /^(?<count>\d+) note\(s\) past the 25KB organization threshold/,
		"claim HY-04": /^(?<count>\d+) note\(s\) with open follow-ups untouched 14\+ days/,
		"claim HY-05": /^(?<count>\d+) inbox item\(s\) unchanged for 7\+ days/,
		"item HY-02": /^"(?<token>[^"]+)": (?<notes>.+)$/,
		"item HY-03": /^(?<note>.+) \((?<sizeKb>\d+)KB\)$/,
		"item HY-04": /^(?<note>.+) \(\d+d, (?<count>\d+) open item\(s\)\)$/,
		"hygiene header": /^Workspace Hygiene \(drift detected\):$/,

		// Part d.2 gives this line: `- Name — description`, with " (empty)" as a part of the description.
		"brain topic": /^- (?<note>.+?) — (?<detail>.+)$/,

		// The check of the memory directory reads a local file, so its text is the text of the Markdown form.
		"memory file": /^⚠️ {2}Memory location violation: `(?<detail>[^`]+)`[\s\S]*brain note\(s\)\.$/,
		"warnings": /^Workspace hygiene warnings for `(?<note>[^`]+)`:\n(?<items>(?: {2}- .+\n)+).+$/,
		"oversized note": /^📐 `(?<note>[^`]+)` is now (?<sizeKb>\d+)KB .+$/,
		"topic cluster":
			/^🗂️ {2}This note joins (?<count>\d+) active row\(s\) with no `Project` sharing "(?<token>[^"]+)": (?<notes>.+)\.\nConvention: .+\nToken overlap .+$/,
		"warning VW-07": /^The page is not a row of a note database$/,
		"warning VW-08": /^The property `(?<field>Date|Description|Tags)` is empty/,
		"warning VW-09": /^The property `(?<field>[^`]+)` is empty \(required by/,
		"warning VW-10": /^No mentions or relations found/,
		"warning VW-11": /^(?<count>\d+) hard-wrapped paragraph line\(s\), first at line (?<formText>\d+) /,
		"warning VW-12": /^(?<count>\d+) ticket-ID wikilink\(s\)/,
	},
	names: [
		["Workspace Hygiene", "{hygiene}"],
		["Active rows with no `Project`", "{loose active notes}"],
		["note(s) past the 25KB organization threshold", "{oversized notes}"],
		["note(s) with open follow-ups untouched 14+ days", "{old open loops}"],
		["inbox item(s) unchanged for 7+ days", "{old inbox items}"],
		["titles + counts", "{notes + counts}"],
		["`Status` active -> completed or archived", "{the archive move}"],
		["Home, North Star, People & Context", "{indexes}"],
		["Workspace hygiene", "{hygiene}"],
		["The page is not a row of a note database", "{no properties}"],
		["The property `{field}` is empty", "{missing field}"],
		["No mentions or relations found", "{no links}"],
		["the checkbox `Verbatim`", "{verbatim mark}"],
		["active row(s) with no `Project`", "{loose active notes}"],
		["a `Project` value", "{a topic group}"],
		["brain/", "{brain topics}"],
	],
};
