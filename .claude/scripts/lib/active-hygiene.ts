/**
 * The rules and the wording that the hygiene scan of the Notion workspace
 * (lib/hygiene-scan.ts) and the write check (lib/write-check.ts) share.
 *
 *   - The topic clusters of loose active notes. Once a workstream has more
 *     than one note, it gets one group.
 *   - The size from which a note needs a SPLIT, and never a trim. The size
 *     is in bytes, because a long line hides in a line count.
 *   - The open loops: the limits, the manifest settings, and the count of
 *     the open items of a note.
 *   - The age limit of an inbox item.
 *   - The instruction files of the project directory. Claude Code reads a
 *     CLAUDE.md beside AGENTS.md in its place, with no message (#321).
 *
 * Philosophy: pattern-based, no LLM, conservative. This NUDGES. False
 * negatives (missing a cluster) are preferable to false positives (nagging
 * about unrelated notes), so the cluster detector leans hard on a
 * document-frequency guard: a token shared by *more than half* the names
 * is treated as a generic team/element word, not a groupable topic.
 */

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { AGENTS_MD_FLAG_BYTES, CLAUDE_MD, INSTRUCTION_FILE, RETIRED_INSTRUCTION_FILES } from "./instruction-files.ts";
import { escapeRegex } from "./regex.ts";

// Generic process words that must never anchor a topic cluster. The
// document-frequency guard catches most of these already (a word in >50%
// of root notes is excluded), but common nouns can slip under that in a
// small active/ — so we hard-stop the worst offenders. Kept short on
// purpose; over-stopwording would suppress real project nouns.
const STOPWORDS = new Set([
	"onboarding", "branch", "the", "and", "for", "with", "from", "into",
	"that", "this", "report", "plan", "sync", "call", "prep", "notes",
	"doc", "document", "meeting", "review", "draft", "log", "investigation",
	"framework", "roadmap", "playbook", "support", "screen", "verification",
	"remediation", "delivery", "strategy", "execution", "kickoff",
	"discovery", "prompt", "audit", "analysis", "experiment",
]);

// Strip a leading `YYYY-MM-DD ` date prefix and the `.md` extension, then
// tokenise the title into lowercased alphanumeric words.
function titleTokens(filename: string): string[] {
	const title = filename
		.replace(/\.md$/i, "")
		.replace(/^\d{4}-\d{2}-\d{2}\s+/, "");
	return title
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((t) => t.length >= 4 && !/^\d+$/.test(t) && !STOPWORDS.has(t));
}

export type TopicCluster = {
	readonly token: string;
	readonly files: readonly string[]; // root-level filenames
};

export type InboxPressure = {
	readonly count: number;
	readonly oldestDays: number;
};

// ---------------------------------------------------------------------------
// Open-loops detection (#106). Conservative by design (false negatives over
// nagging): checkboxes count only inside their follow-up sections, and
// output is capped. Hook output prints titles + counts ONLY — never the
// matched line content (follow-up lines can be sensitive, and hook output
// may be pasted anywhere).
// ---------------------------------------------------------------------------

export const OPEN_LOOP_DAYS = 14;
export const OPEN_LOOP_CAP = 5;
const OPEN_LOOP_DEFAULT_TYPES = ["1:1", "Inbox item", "Incident"];
const OPEN_LOOP_DEFAULT_SECTIONS = ["action items", "what to watch"];
const OPEN_LOOP_PHRASE = /\b(waiting on|watch for)\b/i;

export type OpenLoopConfig = {
	/** The `Type` values of the Work rows that the Notion scan watches (`open_loop_types`). */
	readonly types: readonly string[];
	readonly sectionRe: RegExp;
};

/**
 * Read the open-loops watch surfaces from the manifest: `open_loop_types`
 * (`Type` values of the Work rows) and `open_loop_sections` (heading names,
 * matched case-insensitively). Different workspace shapes have different
 * follow-up surfaces — the detector is the invariant, the surfaces are
 * config. Missing/malformed fields fall back to the template defaults.
 */
export function parseOpenLoopConfig(manifestJson: string | null): OpenLoopConfig {
	let types: readonly string[] = OPEN_LOOP_DEFAULT_TYPES;
	let sections: readonly string[] = OPEN_LOOP_DEFAULT_SECTIONS;
	if (manifestJson !== null) {
		try {
			const parsed = JSON.parse(manifestJson) as Record<string, unknown>;
			const t = parsed["open_loop_types"];
			if (Array.isArray(t)) {
				const valid = t.filter((x): x is string => typeof x === "string" && x.length > 0);
				if (valid.length > 0) types = valid;
			}
			const s = parsed["open_loop_sections"];
			if (
				Array.isArray(s) &&
				s.length > 0 &&
				s.every((x) => typeof x === "string" && x.length > 0)
			) {
				sections = s as string[];
			}
		} catch {
			/* malformed manifest → defaults */
		}
	}
	const sectionRe = new RegExp(
		`^##+\\s+(${sections.map((s) => escapeRegex(s)).join("|")})`,
		"i",
	);
	return { types, sectionRe };
}

/**
 * Count live follow-up signals in a note: unchecked `- [ ]` items inside a
 * configured follow-up section, plus explicit waiting-on / watch-for lines
 * anywhere. Pure — exported for tests.
 */
export function countOpenLoops(content: string, sectionRe: RegExp): number {
	let inActionSection = false;
	let count = 0;
	for (const line of content.split("\n")) {
		if (/^##+\s/.test(line)) {
			inActionSection = sectionRe.test(line);
			continue;
		}
		const unchecked = /^\s*-\s\[\s\]/.test(line);
		if (inActionSection && unchecked) count++;
		else if (OPEN_LOOP_PHRASE.test(line)) count++;
	}
	return count;
}

// ---------------------------------------------------------------------------
// Oversized-note detection. Size is a STRUCTURE signal, never a brevity
// signal: past the threshold a note wants a SPLIT (domain notes / event-log
// satellites / a cluster folder — verbatim, index left behind), never
// trimming. Workspace-wide by design — existing large chronological logs
// flag immediately and become the split backlog, not noise.
// ---------------------------------------------------------------------------

export const MONOLITH_BYTES = 25_000;

/** Archive notes are bulk by design — the only exemption. */
export function isMonolithExempt(filename: string): boolean {
	return filename.includes("Archive");
}

/**
 * The topic clusters of the loose active notes. A name is a file name in
 * `work/active/`, or the title of an active Work row with no `Project`.
 */
export function topicClusters(names: readonly string[]): TopicCluster[] {
	// Sorted so token→file maps (and the signature dedup that keeps the
	// first token per file-set) are deterministic across filesystems.
	const rootFiles = [...names].sort();

	// Don't nag about grouping when the root is already small — folders are
	// for taming size, not for ceremony.
	if (rootFiles.length < 4) return [];

	// token -> set of filenames containing it
	const byToken = new Map<string, Set<string>>();
	for (const f of rootFiles) {
		for (const t of new Set(titleTokens(f))) {
			(byToken.get(t) ?? byToken.set(t, new Set()).get(t)!).add(f);
		}
	}

	// A token is a groupable topic if it appears in >=2 root files but in no
	// more than half of them (the DF guard that rejects generic words).
	const dfCap = Math.floor(rootFiles.length / 2);
	const clusters: TopicCluster[] = [];
	const seenSignatures = new Set<string>();
	for (const [token, set] of byToken) {
		if (set.size < 2 || set.size > dfCap) continue;
		const files = [...set].sort();
		// Dedup tokens that produce the same file set.
		const sig = files.join("|");
		if (seenSignatures.has(sig)) continue;
		seenSignatures.add(sig);
		clusters.push({ token, files });
	}
	// Largest clusters first; ties broken by token for stable output.
	return clusters.sort(
		(a, b) => b.files.length - a.files.length || a.token.localeCompare(b.token),
	);
}

// ---------------------------------------------------------------------------
// Inbox pressure. The inbox items are a staging inbox drained by
// /om-intake — raw exports sitting there are unprocessed by definition.
// ---------------------------------------------------------------------------

export const INBOX_PRESSURE_DAYS = 7;

export function formatMonolithHint(path: string, sizeBytes: number): string {
	return `📐 \`${path}\` is now ${Math.round(sizeBytes / 1000)}KB — past the ${MONOLITH_BYTES / 1000}KB organization threshold. Do NOT trim the content; SPLIT it while you have the context: domain notes / event-log satellites / a cluster folder, moved verbatim, with a one-liner index left behind and inbound links retargeted. If a split genuinely doesn't fit yet, say why in the session instead of ignoring this.`;
}

/**
 * AGENTS.md's size once it reaches the flag. It is a repository file, so
 * the oversize scan never sees it, yet a user folding their additions into it
 * can push it past where Antigravity stops reading, silently.
 */
export function agentsMdPastFlag(root: string): { sizeKb: number } | null {
	try {
		const size = statSync(join(root, INSTRUCTION_FILE)).size;
		return size >= AGENTS_MD_FLAG_BYTES ? { sizeKb: Math.round(size / 1000) } : null;
	} catch {
		return null;
	}
}

/**
 * Retired instruction files beside AGENTS.md that still go wrong. Without
 * AGENTS.md the vault has not upgraded yet, and its old file still carries
 * everything.
 */
export function instructionFileFindings(root: string): { readonly leftoverInstructionFiles: readonly string[] } {
	if (!existsSync(join(root, INSTRUCTION_FILE))) return { leftoverInstructionFiles: [] };
	return {
		leftoverInstructionFiles: RETIRED_INSTRUCTION_FILES.filter((f) => existsSync(join(root, f))),
	};
}

/** What each retired file does wrong while it stays, and what to do about it. */
const LEFTOVER_HARM: Readonly<Record<string, string>> = {
	[CLAUDE_MD]: "Claude Code reads CLAUDE.md and skips AGENTS.md; move your additions to .claude/rules/ and delete it.",
};

/**
 * How many entries a hygiene list prints before "… and N more". The flag's
 * headline keeps the full count. Hygiene never degrades under the injection
 * budget, so an uncapped list could fill the hook output cap by itself (#254).
 */
export const HYGIENE_LIST_CAP = 10;

/** The first HYGIENE_LIST_CAP items, and the "… and N more" tail when any were left out. */
function capped<T>(items: readonly T[]): { readonly shown: readonly T[]; readonly more: string | null } {
	const rest = items.length - HYGIENE_LIST_CAP;
	return { shown: items.slice(0, HYGIENE_LIST_CAP), more: rest > 0 ? `… and ${rest} more` : null };
}

/** A cluster's file names on one line, with the cap of a hygiene list. */
export function namesCapped(names: readonly string[]): string {
	const { shown, more } = capped(names);
	return more === null ? shown.join(", ") : [...shown, more].join(", ");
}

/** The claim of a retired instruction file beside AGENTS.md, and its report line. The file is local in each form of the vault. */
export const leftoverClaim = (file: string): string => `${file} present beside AGENTS.md`;
export const leftoverLine = (file: string): string =>
	`⚠️  ${leftoverClaim(file)} — ${LEFTOVER_HARM[file] ?? "it is a retired instruction file; move anything you added there to AGENTS.md and delete it."}`;

/** The claim of an AGENTS.md past its flag size, and its report line. */
export const agentsMdClaim = (sizeKb: number): string => `AGENTS.md is ${sizeKb}KB`;
export const agentsMdLine = (sizeKb: number): string =>
	`⚠️  ${agentsMdClaim(sizeKb)} — Antigravity stopped reading it at ~24,000 bytes, silently (Antigravity 1.3.0, measured 2026-10-06, #321). Keep it under 23KB. Move a section an agent can safely skip to a file it reads on demand, word for word, and leave a one-line pointer; Claude Code-only additions go to .claude/rules/.`;
