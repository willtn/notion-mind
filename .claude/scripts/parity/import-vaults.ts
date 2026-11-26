/**
 * The fixture vaults of the import proof, written as directories. The
 * import reads a vault from disk, so each fixture becomes one.
 *
 *     node --experimental-strip-types parity/import-vaults.ts --out <dir> [--now 2026-11-26T00:00:00Z]
 *
 * - `<dir>/fixture`: the Markdown form of the parity fixture set, the same
 *   files that the hooks at the reference commit read.
 * - `<dir>/constructs`: the note of part a.5 of the design record, which
 *   holds each Obsidian construct that the vault rules use, and the notes
 *   that it links to.
 *
 * Each file has the time of `--now`, less the age that the fixture gives
 * it. The same `--now` gives the same files and times, so a second import
 * of a vault that this script wrote again finds nothing to change.
 *
 * The third vault of the proof is the template scaffold at the reference
 * commit: `git worktree add --detach <dir>/scaffold fae7be4`.
 */

import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainModule } from "../lib/main-guard.ts";
import { FIXTURE } from "./fixture.ts";
import { markdownForm } from "./markdown-form.ts";

/** The source body of part a.5, as the record gives it. */
export const A5_BODY = [
	"# Construct Fixture",
	"",
	"## Context",
	"",
	"This note links to [[North Star]], to [[Key Decisions|the decision log]], and to [[Patterns#Error handling]].",
	"It also links to a block with [[Gotchas#^hook-timeout]].",
	"",
	"A paragraph line that the hygiene check calls hard-wrapped",
	"continues on the next line",
	"and on one more line.",
	"",
	"> [!warning] Footgun",
	"> A callout with **bold** and `code`.",
	"",
	"## What",
	"",
	"- [ ] An open task",
	"- [x] A closed task",
	"- A bullet with a tag #inline-tag",
	"- A ==highlight== and a %%hidden comment%%",
	"",
	"| Column A | Column B |",
	"| --- | --- |",
	"| one | two |",
	"",
	"```ts",
	"const x: number = 1;",
	"```",
	"",
	"```mermaid",
	"graph TD; A-->B;",
	"```",
	"",
	"A line with a block id. ^fixture-block",
	"",
	"![[Patterns]]",
	"",
	"## Related",
	"",
	"- [[Index]]",
	"- [[Platform]]",
	"",
].join("\n");

const frontmatter = (lines: readonly string[]): string => `---\n${lines.join("\n")}\n---\n\n`;

/** The constructs vault: the note of part a.5 and each note that it names. */
export const CONSTRUCTS_VAULT: Readonly<Record<string, string>> = {
	"work/active/Construct Fixture.md": frontmatter(["date: 2026-01-05", "description: Each construct of part a.5", "status: active", "quarter: Q1-2026", "tags:", "  - work-note"]) + A5_BODY,
	"brain/North Star.md": frontmatter(["tags:", "  - brain", "  - north-star"]) + "# North Star\n\n## Current Focus\n\n- Prove the import of each construct\n",
	"brain/Key Decisions.md": frontmatter(["tags:", "  - brain"]) + "# Key Decisions\n\n- Use one Notion workspace\n",
	"brain/Patterns.md": frontmatter(["tags:", "  - brain"]) + "# Patterns\n\n## Error handling\n\n- Fail at the boundary\n",
	"brain/Gotchas.md": frontmatter(["tags:", "  - brain"]) + "# Gotchas\n\n- A hook has a timeout. ^hook-timeout\n",
	"work/Index.md": frontmatter(["tags:", "  - index"]) + "# Work Notes\n\n## Open Questions\n\n- Does each construct convert?\n",
	"org/teams/Platform.md": frontmatter(["date: 2026-01-05", "description: The platform team", "tags:", "  - team"]) + "# Platform\n\nThe team that owns the hooks.\n",
};

const CONSTRUCTS_AGE_DAYS = 3;

/** Write both vaults under `out`. */
export function writeImportVaults(out: string, now: Date): { readonly fixture: string; readonly constructs: string } {
	const fixture = join(out, "fixture");
	markdownForm(FIXTURE, { scriptsDir: fileURLToPath(new URL("..", import.meta.url)), now })(fixture);
	const constructs = join(out, "constructs");
	const changed = new Date(now.getTime() - CONSTRUCTS_AGE_DAYS * 86_400_000);
	for (const [path, content] of Object.entries(CONSTRUCTS_VAULT)) {
		const full = join(constructs, path);
		mkdirSync(dirname(full), { recursive: true });
		writeFileSync(full, content);
		utimesSync(full, changed, changed);
	}
	return { fixture, constructs };
}

if (isMainModule(import.meta.url)) {
	const args = process.argv.slice(2);
	const value = (name: string): string | undefined => {
		const index = args.indexOf(name);
		return index === -1 ? undefined : args[index + 1];
	};
	const out = value("--out");
	const now = new Date(value("--now") ?? "2026-11-26T00:00:00Z");
	if (out === undefined || Number.isNaN(now.getTime())) {
		console.error("import-vaults: --out <dir> is required, and --now must be an instant.");
		process.exit(1);
	}
	const written = writeImportVaults(resolve(out), now);
	console.log(`fixture vault: ${written.fixture}\nconstructs vault: ${written.constructs}`);
}
