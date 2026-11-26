/**
 * The wording of the ported hooks. The pull request that ports a hook adds
 * the patterns of that hook here, and the Notion names of the objects in
 * its instruction text. A kind with no pattern gives `UNMAPPED` findings,
 * so the parity run of a hook fails until its wording is here.
 */

import type { Wording } from "./wording.ts";

export const NOTION_WORDING: Wording = {
	patterns: {
		// Part d.2 gives this line: `- Name — description`, with " (empty)" as a part of the description.
		"brain topic": /^- (?<note>.+?) — (?<detail>.+)$/,

		// The check of the memory directory reads a local file, and its text names the Knowledge rows that take the content.
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
		["Workspace hygiene", "{hygiene}"],
		["The page is not a row of a note database", "{no properties}"],
		["The property `{field}` is empty", "{missing field}"],
		["No mentions or relations found", "{no links}"],
		["the checkbox `Verbatim`", "{verbatim mark}"],
		["active row(s) with no `Project`", "{loose active notes}"],
		["a `Project` value", "{a topic group}"],
		["brain/", "{brain topics}"],
		["the brain topic rows of `Knowledge`", "{brain topics}"],
		["the `Patterns` row of `Knowledge`", "{patterns note}"],
		["the `Gotchas` row of `Knowledge`", "{gotchas note}"],
		["the `Key Decisions` row of `Knowledge`", "{decisions note}"],
		["the Recent Context section of `North Star`", "{recent context}"],
		["a new `Knowledge` row with `Type` Brain topic", "{new brain topic}"],
		["a `Knowledge` row with `Type` Reference", "{reference notes}"],
	],
};
