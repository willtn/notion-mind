/**
 * What the write check reads from local files: the path test of the
 * automatic memory directory, the `frontmatter_required` declaration of
 * the manifest, and the count of ticket IDs in links.
 */

import { basename, posix } from "node:path";

/**
 * Return true if the path is an auto-memory file in ~/.claude/ that should
 * be flagged (#81). Only MEMORY.md (the auto-loaded index) is allowed there
 * — all durable knowledge goes to the brain topic rows of Knowledge per .claude/rules/memory.md.
 *
 * The path is lexically normalized first (separators unified, `.`/`..`
 * segments collapsed) so a path can't dodge the check by spelling the
 * memory dir indirectly. Callers should additionally pass a
 * realpath-resolved path when the file exists, so symlinked spellings are
 * caught too — see the guard in validate-write.ts.
 *
 * The predicate requires BOTH `/.claude/` and `/memory/` segments and
 * exempts `MEMORY.md` by basename, so it never fires on vault paths like
 * `notes/Memories.md`, project paths containing the word "memory", or
 * other `.claude/projects/<x>/` subdirs (transcripts, hook output).
 */
export function isBlockedMemoryPath(filePath: string): boolean {
	// Separators unified FIRST, then posix-normalize: normalize() on a POSIX
	// host doesn't treat "\" as a separator, so backslash-spelled ".."
	// segments would otherwise survive uncollapsed.
	const normalized = posix.normalize(filePath.replaceAll("\\", "/"));
	if (!normalized.includes("/memory/")) return false;
	if (!normalized.includes("/.claude/")) return false;
	const base = basename(normalized);
	return base !== "MEMORY.md";
}

/** `vault-manifest.json`'s `frontmatter_required`: `global` plus per-type sets. */
export type FrontmatterRequired = Readonly<Record<string, readonly string[]>>;

/**
 * Read `frontmatter_required` from a parsed manifest, keeping only string
 * lists. Anything malformed is dropped rather than guessed at.
 */
export function parseFrontmatterRequired(manifest: unknown): FrontmatterRequired {
	const raw = (manifest as { frontmatter_required?: unknown } | null)?.frontmatter_required;
	const out: Record<string, readonly string[]> = {};
	if (raw && typeof raw === "object" && !Array.isArray(raw)) {
		for (const [type, fields] of Object.entries(raw)) {
			if (Array.isArray(fields)) {
				out[type] = fields.filter((f): f is string => typeof f === "string" && f !== "");
			}
		}
	}
	return out;
}

/**
 * Count [[PROJ-12345]]-shaped wikilinks — ticket IDs are not notes, and
 * these phantom edges are what a broken-link gate later trips on (#108).
 * Matches the bare form and the table-escaped-pipe forms. The warning and
 * the machine-readable policy result (#117) both come from this count.
 */
export function countTicketIdWikilinks(content: string): number {
	return content.match(/\[\[[A-Z]{2,10}-\d+(\\\||&#124;|\||\]\])/g)?.length ?? 0;
}
