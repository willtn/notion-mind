/**
 * The derived properties of a note. A hook computes them from the note text
 * and stores them, so that a saved view can filter on a value that Notion
 * cannot compute from a page body.
 */

import { countOpenLoops } from "./active-hygiene.ts";
import { hasBrainContent, stripFrontmatter } from "./session-start.ts";

export interface DerivedValues {
	/** `Bytes`: the UTF-8 size of the text. */
	readonly bytes: number;
	/** `Open tasks`: the unchecked task lines. */
	readonly openTasks: number;
	/** `Open loops`: the unchecked tasks under a follow-up heading, and the waiting-on and watch-for lines. */
	readonly openLoops: number;
	/** `Has content`: the body has a list item with text. */
	readonly hasContent: boolean;
}

/**
 * `text` is the note as Markdown: the properties as a YAML block, then the
 * body. `openLoopSections` is the heading test of `parseOpenLoopConfig`.
 */
export function derivedValues(text: string, openLoopSections: RegExp): DerivedValues {
	return {
		bytes: Buffer.byteLength(text, "utf-8"),
		openTasks: text.split(/\r?\n/).filter((line) => /^\s*- \[ \]/.test(line)).length,
		openLoops: countOpenLoops(text, openLoopSections),
		hasContent: hasBrainContent(stripFrontmatter(text)),
	};
}
