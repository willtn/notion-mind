/**
 * The wording of the hooks at `fae7be4`. Each pattern names Markdown and
 * Obsidian objects: a path, a folder, a `[[wikilink]]`, the frontmatter.
 */

import type { ObjectName, TextKind } from "./wording.ts";

const patterns: Readonly<Record<TextKind, RegExp>> = {
	"session title": /^## Session Context$/,
	"size meter": /^_context injected: (?<formText>[\d.]+kB) \/ .+_$/,
	"section date": /^### Date$/,
	"section north star": /^### North Star \(current goals\)$/,
	"section brain topics": /^### Brain Topics \(read on demand\)$/,
	"section recent changes": /^### Recent Changes \(last 48h\)$/,
	"section open tasks": /^### Open Tasks$/,
	"section active work": /^### Active Work$/,
	"section listing": /^### Vault File Listing$/,
	"section context pointer": /^### Context Pointer$/,
	"section hygiene": /^### Vault Hygiene \(drift detected\)$/,
	"date line": /^\d{4}-\d{2}-\d{2} \(\w+\)$/,
	"north star hidden items": /^_\((?<count>\d+) completed items? hidden/,
	"north star line": /^(?<detail>.+)$/,
	"brain topic": /^- \[\[(?<note>[^\]]+)\]\] — (?<detail>.+)$/,
	"no recent changes": /^\(no git history\)$/,
	"recent change": /^.+$/,
	"open task": /^\s*- \[ \] (?<detail>.+)$/,
	"no open tasks": /^\(no open tasks\)$/,
	"open tasks note": /^(?<note>.+\.md)$/,
	"no active work": /^\(none\)$/,
	"active note": /^(?<note>.+)$/,
	"listing collapsed": /^(?<group>\.\/.+\/) — (?<count>\d+) notes \(listing collapsed — (?<formText>.+) on demand\)$/,
	"listing note": /^\.\/(?<note>.+)$/,
	"context pointer": /^\(Re-entry via resume\/compact /,

	"claim HY-07": /^(?<detail>\S+) present beside AGENTS\.md/,
	"claim HY-09": /^AGENTS\.md is (?<sizeKb>\d+)KB(?<formText>(?: — [^.(]+\([^)]+\))?)/,
	"claim HY-01": /^(?<count>\d+) note\(s\) marked done but still in active\//,
	"claim HY-02": /^Loose active\/ notes that look like one topic/,
	"claim HY-03": /^(?<count>\d+) note\(s\) past the 25KB organization threshold/,
	"claim HY-04": /^(?<count>\d+) note\(s\) with open follow-ups untouched 14\+ days/,
	"claim HY-05": /^(?<count>\d+) raw export\(s\) sitting in work\/meetings\/ for 7\+ days/,
	"more items": /^… and (?<count>\d+) more$/,
	"item HY-01": /^(?<note>.+)$/,
	"item HY-02": /^"(?<token>[^"]+)": (?<notes>.+)$/,
	"item HY-03": /^(?<note>.+) \((?<sizeKb>\d+)KB\)$/,
	"item HY-04": /^(?<note>.+) \(\d+d, (?<count>\d+) open item\(s\)\)$/,

	"checklist header": /^Wrap-up checklist:$/,
	"hygiene header": /^Vault Hygiene \(drift detected\):$/,
	"hand-over preface": /^Stop hook report, handed over with this message: when your previous response ended/,
	"mod preface": /^Stop hook report, handed over with this message: when one of your earlier responses/,
	"feedback preface": /^Stop hook report: your response just ended/,
	"checklist item": /^- .+$/,
	"checklist summary": /^Wrap-up checklist: (?<items>.+)$/,
	"checklist summary item": /^.+$/,
	"summary claims": /^Hygiene: (?<items>.+)$/,
	"hand-over trailer": /^The full report reaches the agent with your next message\.$/,
	"feedback trailer": /^The full report went to the agent now, as Stop hook feedback\.$/,

	"memory file": /^⚠️ {2}Memory location violation: `(?<detail>[^`]+)`[\s\S]*brain note\(s\)\.$/,
	"warnings": /^Vault hygiene warnings for `(?<note>[^`]+)`:\n(?<items>(?: {2}- .+\n)+).+$/,
	"oversized note": /^📐 `(?<note>[^`]+)` is now (?<sizeKb>\d+)KB .+$/,
	"topic cluster":
		/^🗂️ {2}This note joins (?<count>\d+) loose sibling\(s\) in active\/ sharing "(?<token>[^"]+)": (?<notes>.+)\.\nConvention: .+\nToken overlap .+$/,
	"warning VW-07": /^Missing YAML frontmatter$/,
	"warning VW-08": /^Missing `(?<field>date|description|tags)` in frontmatter/,
	"warning VW-09": /^Missing `(?<field>[^`]+)` in frontmatter \(required by/,
	"warning VW-10": /^No \[\[wikilinks\]\] found/,
	"warning VW-11": /^(?<count>\d+) hard-wrapped paragraph line\(s\), first at line (?<formText>\d+) /,
	"warning VW-12": /^(?<count>\d+) ticket-ID wikilink\(s\)/,

	"hints": /^Content classification hints .+\n(?<items>(?:- .+\n)+)\nRemember: .+$/,
	"hint UP-03": /^DECISION detected/,
	"hint UP-04": /decision REVERSAL/,
	"hint UP-05": /^INCIDENT detected/,
	"hint UP-06": /^1:1 CONTENT detected/,
	"hint UP-07": /^WIN detected/,
	"hint UP-08": /^ARCHITECTURE discussion/,
	"hint UP-09": /^PERSON CONTEXT detected/,
	"hint UP-10": /^PROJECT UPDATE detected/,
};

/**
 * The names of the Markdown objects in the instruction text. Part (d) gives
 * the Notion object for each one: the vault is the workspace, a folder is a
 * database, a `Type`, or a property, and the frontmatter is the properties.
 */
const names: readonly ObjectName[] = [
	["note(s) past the 25KB organization threshold", "{oversized notes}"],
	["note(s) with open follow-ups untouched 14+ days", "{old open loops}"],
	["raw export(s) sitting in work/meetings/ for 7+ days", "{old inbox items}"],
	["paths + counts", "{notes + counts}"],
	["Loose active/ notes", "{loose active notes}"],
	["loose sibling(s) in active/", "{loose active notes}"],
	["a folder (active/<Topic>/, `git mv`, mirror the folder in archive/ later)", "{a topic group}"],
	["a folder (active/<Topic>/)", "{a topic group}"],
	["work/active/<Topic>/", "{a topic group}"],
	["Missing `{field}` in frontmatter", "{missing field}"],
	["Missing YAML frontmatter", "{no properties}"],
	["No [[wikilinks]] found", "{no links}"],
	["`verbatim: true` in frontmatter", "{verbatim mark}"],
	["Vault Hygiene", "{hygiene}"],
	["Vault hygiene", "{hygiene}"],
	["Vault File Listing", "{listing}"],
	["work/active/ -> work/archive/YYYY/", "{the archive move}"],
	["Index.md, Memories.md, People & Context, Brag Doc", "{indexes}"],
	["brain/North Star.md", "{North Star}"],
	["brain/", "{brain topics}"],
];

export const MARKDOWN_WORDING = { patterns, names };
