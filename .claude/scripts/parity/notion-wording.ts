/**
 * The wording of the ported hooks. The pull request that ports a hook adds
 * the patterns of that hook here. A kind with no pattern gives `UNMAPPED`
 * findings, so the parity run of a hook fails until its wording is here.
 */

import type { Wording } from "./wording.ts";

export const NOTION_WORDING: Wording = {
	// Part d.2 gives this line: `- Name — description`, with " (empty)" as a part of the description.
	"brain topic": /^- (?<note>.+?) — (?<detail>.+)$/,
};
