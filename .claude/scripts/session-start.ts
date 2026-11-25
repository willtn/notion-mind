#!/usr/bin/env node
/**
 * SessionStart hook — inject vault context into the agent's first turn.
 *
 * Emits a markdown block on stdout with: date header, North Star excerpt,
 * brain-topics index, recent git changes (last 48h), open tasks aggregated
 * from work/active/ and the vault root, active work listing, and a full
 * vault markdown file listing.
 *
 * Also persists VAULT_PATH to CLAUDE_ENV_FILE when Claude Code provides it.
 *
 * Under the template's Claude Code mod (#264, lib/om-mod.ts) the mod
 * delivers this output as an instruction file: it runs this script with
 * `om_mod: "deliver"` (always the full layer, held to
 * `eager_layer_instruction_budget_bytes` rather than the hook-output cap) and
 * flags the event it passes down with `om_mod: "standdown"`, on which this
 * hook exits before any output or side effect. Without the mod, nothing
 * sends the flag.
 */

import {
	readFileSync,
	appendFileSync,
	readdirSync,
	statSync,
	type Dirent,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import {
	take,
	formatDateHeader,
	formatEnvExport,
	injectionMode,
	formatInjectionSize,
	formatActiveWork,
	formatRecentChanges,
	isSkippedPath,
	MACHINERY_DIRS,
	extractFrontmatterField,
	formatBrainIndex,
	stripFrontmatter,
	hasBrainContent,
	parseInfraRootFilenames,
	isInfraFilename,
	isMarkdownFilename,
	collectOpenTasks,
	applyInjectionBudget,
	effectiveInjectionBudget,
	enveloped,
	parseInjectionBudget,
	parseInstructionBudget,
	DEFAULT_INSTRUCTION_BUDGET_BYTES,
	METER_HEADROOM,
	utf8Bytes,
	type InjectionBudget,
	parseListingCollapseThreshold,
	shouldCollapseDir,
	formatCollapsedDir,
	DEFAULT_LISTING_COLLAPSE_THRESHOLD,
	type BudgetSection,
	type BudgetLevel,
	type NorthStarLadder,
	northStarLadder,
	renderHeadlines,
	topHeadlines,
	NORTH_STAR_POINTER,
} from "./lib/session-start.ts";
import {
	formatActiveHygiene,
	parseOpenLoopConfig,
	scanActiveHygiene,
} from "./lib/active-hygiene.ts";
import { debug, envelopedLimit, fitWithMeter, type OutputLimit, readStdinJson, writeHookOutput } from "./lib/hook-io.ts";
import { readOmMod } from "./lib/om-mod.ts";
import { resolveProjectDir } from "./lib/project-dir.ts";

type HookInput = { readonly source?: unknown };

// The SessionStart payload carries `source` (startup/clear/resume/compact).
// Missing or unparseable stdin fails open to full mode. stdin is OPTIONAL
// for this hook (unlike the payload-driven ones), so guard the read: a
// TTY (manual run) skips it entirely, and a pipe that never delivers EOF
// is abandoned after a short deadline — the injection must never hang on
// a harness that doesn't send the payload.
async function readHookInput(): Promise<HookInput | null> {
	if (process.stdin.isTTY) return null;
	let timer: NodeJS.Timeout | undefined;
	const result = await Promise.race([
		readStdinJson<HookInput>(),
		new Promise<null>((resolveRace) => {
			timer = setTimeout(() => resolveRace(null), 2_000);
			timer.unref();
		}),
	]);
	if (timer !== undefined) clearTimeout(timer);
	if (result === null) {
		// Abandoned or empty read: drop the stream so a still-open pipe
		// can't keep the process alive after the injection is written.
		process.stdin.destroy();
	}
	return result;
}
const hookInput = await readHookInput();

function readManifestRaw(): string | null {
	try {
		return readFileSync("vault-manifest.json", { encoding: "utf-8" });
	} catch {
		return null;
	}
}

const cwd = resolveProjectDir(process.cwd());

// Persist vault path for any downstream shell consumers (Claude Code feature).
// The whole line comes from formatEnvExport so quoting is not a step anyone
// can skip; see its doc comment. A hand-rolled template here is what caused
// the command-execution bug in #145, and a unit test now guards against one
// reappearing.
const envFile = process.env["CLAUDE_ENV_FILE"];
if (envFile) {
	try {
		appendFileSync(envFile, formatEnvExport("VAULT_PATH", cwd));
	} catch {
		/* best-effort — session continues even if persistence fails */
	}
}

// A Claude Code mod that delivers this layer itself flags the event it
// passes down (lib/om-mod.ts): stand down before every other side effect,
// since the mod's own run of this script performs them. The export above is
// the exception: Claude Code gives CLAUDE_ENV_FILE to hook processes only, so
// the mod's run never sees it and this run is the only one that can write it.
// `deliver` is the mod's run: the output becomes an instruction file, which
// compaction keeps whole, so it is always the full layer and is not held
// under the hook-output cap.
const omMod = readOmMod(hookInput);
if (omMod === "standdown") process.exit(0);
const delivering = omMod === "deliver";
const mode = delivering ? "full" : injectionMode(hookInput?.source);

process.chdir(cwd);

// Manifest is read once and reused: the infrastructure allowlist for
// openTasks(), and any future manifest-driven sections all derive from the
// same source. Both helpers tolerate a null source so a
// missing/malformed manifest degrades quietly.
const manifestJson = readManifestRaw();
const infraRootFilenames = parseInfraRootFilenames(manifestJson);

type CmdResult =
	| { readonly kind: "ok"; readonly stdout: string }
	| { readonly kind: "missing" }
	| { readonly kind: "failed" };

function runCmd(
	cmd: string,
	args: readonly string[],
	timeoutMs = 5_000,
): CmdResult {
	const r = spawnSync(cmd, args as string[], {
		encoding: "utf-8",
		timeout: timeoutMs,
		windowsHide: true,
	});
	if (
		r.error &&
		(r.error as NodeJS.ErrnoException).code === "ENOENT"
	) {
		return { kind: "missing" };
	}
	if (r.status !== 0) return { kind: "failed" };
	return { kind: "ok", stdout: r.stdout ?? "" };
}


function northStar(): NorthStarLadder | null {
	// Filesystem-only: the path is fixed by template convention, so there's no
	// wikilink-resolution value worth a CLI hop — and `spawnSync("obsidian", …)`
	// launches the Electron app on macOS when no instance is running (#83).
	//
	// The slice must carry LIVE goals (#107), and degrade by levels rather
	// than vanish when it does not fit (#304): see `northStarLadder`.
	try {
		return northStarLadder(readFileSync("brain/North Star.md", { encoding: "utf-8" }));
	} catch {
		return null;
	}
}

/** The North Star section, with its ladder: full → focus → headlines → top-N → pointer. */
function northStarSection(priority: number): BudgetSection {
	const ladder = northStar();
	const header = "### North Star (current goals)";
	if (ladder === null) return { header, body: "(not found)", priority, fallback: NORTH_STAR_POINTER };
	const levels: BudgetLevel[] = [];
	if (ladder.focus !== null) levels.push({ name: "focus", body: ladder.focus });
	if (ladder.headlines.length > 0) {
		levels.push(
			{ name: "headlines", body: renderHeadlines(ladder.headlines) },
			{ name: "top-N", fit: (fits) => topHeadlines(ladder.headlines, fits) },
		);
	}
	return { header, body: ladder.full, priority, fallback: NORTH_STAR_POINTER, levels };
}

/**
 * A section body with what was cut from its source, so the meter can say so
 * (no section may present a cut as whole).
 */
type Built = { readonly body: string; readonly cut?: string | undefined };

const keptOf = (kept: number, total: number): string | undefined =>
	total > kept ? `${kept} of ${total}` : undefined;

const RECENT_CHANGES_LIMIT = 15;
const ACTIVE_WORK_LIMIT = 10;
const OPEN_TASKS_LIMIT = 10;

function recentChanges(): Built {
	const r = runCmd("git", [
		"log",
		"--oneline",
		"--since=48 hours ago",
		"--no-merges",
	]);
	if (r.kind !== "ok") return { body: "(no git history)" };
	const total = r.stdout.split("\n").filter((l) => l.length > 0).length;
	return {
		body: formatRecentChanges(r.stdout, RECENT_CHANGES_LIMIT),
		cut: keptOf(RECENT_CHANGES_LIMIT, total),
	};
}

function readMarkdownSource(
	path: string,
): { path: string; content: string } | null {
	try {
		return { path, content: readFileSync(path, { encoding: "utf-8" }) };
	} catch {
		return null;
	}
}

function listMarkdownSources(
	dir: string,
	pathFor: (name: string) => string,
	skip: (name: string) => boolean = () => false,
): { path: string; content: string }[] {
	let entries: Dirent[];
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}
	const sources: { path: string; content: string }[] = [];
	for (const e of entries) {
		if (!e.isFile() || !isMarkdownFilename(e.name) || skip(e.name)) continue;
		const src = readMarkdownSource(pathFor(e.name));
		if (src !== null) sources.push(src);
	}
	return sources;
}

function openTasks(): Built {
	// Filesystem scan, not `obsidian tasks daily todo` (#83 — that CLI flashes
	// the Electron app on macOS). Order matters: project tasks in work/active/
	// surface first, then vault-root notes (which is where daily notes live by
	// Obsidian's default — empirically the dominant task store in user vaults).
	// Infra files (AGENTS.md, README.*.md, …) are excluded so the section is
	// user content only. Paths use forward slashes so the output reads the same
	// in Claude's context on any OS.
	const sources = [
		...listMarkdownSources("work/active", (name) => `work/active/${name}`),
		...listMarkdownSources(
			".",
			(name) => name,
			(name) => isInfraFilename(name, infraRootFilenames),
		),
	];
	const total = sources.reduce(
		(n, s) => n + s.content.split(/\r?\n/).filter((line) => /^\s*- \[ \]/.test(line)).length,
		0,
	);
	return { body: collectOpenTasks(sources, OPEN_TASKS_LIMIT), cut: keptOf(OPEN_TASKS_LIMIT, total) };
}

function brainIndex(): string {
	let entries: Dirent[];
	try {
		entries = readdirSync("brain", { withFileTypes: true });
	} catch {
		return "(none)";
	}
	const files = entries
		.filter((e) => e.isFile() && isMarkdownFilename(e.name))
		.map((e) => e.name)
		.sort();
	const parsed = files.map((f) => {
		const name = f.replace(/\.md$/i, "");
		let description: string | null = null;
		let hasContent = false;
		try {
			const content = readFileSync(join("brain", f), { encoding: "utf-8" });
			description = extractFrontmatterField(content, "description");
			hasContent = hasBrainContent(stripFrontmatter(content));
		} catch {
			/* unreadable file → show name with no description, treat as empty */
		}
		return { name, description, hasContent };
	});
	return formatBrainIndex(parsed);
}

function activeWork(): Built {
	let entries: Dirent[];
	try {
		entries = readdirSync("work/active", { withFileTypes: true });
	} catch {
		return { body: "(none)" };
	}
	const files = entries.filter((e) => e.isFile()).map((e) => e.name);
	const notes = files.filter((f) => isMarkdownFilename(f)).length;
	return { body: formatActiveWork(files, ACTIVE_WORK_LIMIT), cut: keptOf(ACTIVE_WORK_LIMIT, notes) };
}

// Machinery (shared with the oversize scan) plus `thinking/` — scratchpads
// are real notes, just not orientation material for the listing.
const SKIP_PREFIXES: readonly string[] = [...MACHINERY_DIRS, "thinking"];

// Dirs that collapse to one count line regardless of size (#107): the
// archive is orientation noise whether it holds 3 notes or 300 — Glob
// reaches it on demand. Everything else collapses by SIZE instead, via
// the threshold below, so a vault cannot grow past the ceiling through
// whichever folder nobody remembered to list here.
const ALWAYS_COLLAPSED_DIRS: readonly string[] = ["work/archive"];

const listingCollapseThreshold =
	parseListingCollapseThreshold(manifestJson) ??
	DEFAULT_LISTING_COLLAPSE_THRESHOLD;

/**
 * One traversal that carries its own subtree count, so the collapse decision
 * costs nothing extra. (A separate recursive counter would re-walk every
 * subtree the listing walk already visited.)
 *
 * The count reflects what the listing WOULD have printed — skipped prefixes
 * are excluded — so a collapsed line never claims notes the expanded listing
 * would not have shown.
 */
type WalkResult = {
	readonly lines: readonly string[];
	readonly count: number;
	readonly hasSubdirs: boolean;
};

/**
 * Count-only recursion for directories that are collapsing regardless of
 * size. Building their descendant lines just to discard them is wasted work
 * on a large archive, so the always-collapse branch counts without walking.
 */
function countMdOnly(dir: string): number {
	let entries: Dirent[];
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return 0;
	}
	let n = 0;
	for (const e of entries) {
		const posix = (dir === "." ? e.name : join(dir, e.name)).replaceAll("\\", "/");
		if (isSkippedPath(posix, SKIP_PREFIXES)) continue;
		if (e.isDirectory()) n += countMdOnly(posix);
		else if (e.isFile() && isMarkdownFilename(e.name)) n += 1;
	}
	return n;
}

function walkMd(dir: string): WalkResult {
	let entries: Dirent[];
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return { lines: [], count: 0, hasSubdirs: false };
	}
	const lines: string[] = [];
	let count = 0;
	let hasSubdirs = false;
	for (const e of entries) {
		// Normalise to posix BEFORE the skip check: `isSkippedPath` matches on
		// `prefix + "/"`, so a Windows `\` separator would let nested paths
		// under a skipped prefix through.
		const full = (dir === "." ? e.name : join(dir, e.name)).replaceAll("\\", "/");
		if (isSkippedPath(full, SKIP_PREFIXES)) continue;
		if (e.isDirectory()) {
			hasSubdirs = true;
			const posix = full;
			// Always-collapse dirs never render their descendants — count only.
			if (ALWAYS_COLLAPSED_DIRS.includes(posix)) {
				const n = countMdOnly(full);
				count += n;
				lines.push(formatCollapsedDir(posix, n));
				continue;
			}
			const sub = walkMd(full);
			count += sub.count;
			if (
				shouldCollapseDir(
					sub.count,
					listingCollapseThreshold,
					ALWAYS_COLLAPSED_DIRS,
					posix,
					sub.hasSubdirs,
				)
			) {
				lines.push(formatCollapsedDir(posix, sub.count));
			} else {
				lines.push(...sub.lines);
			}
		} else if (e.isFile() && isMarkdownFilename(e.name)) {
			lines.push(`./${full}`);
			count += 1;
		}
	}
	return { lines, count, hasSubdirs };
}

function listMd(): string[] {
	return [...walkMd(".").lines].sort();
}

// Source-aware assembly (#107): on resume/compact the static bulk (North
// Star, brain index, file listing) is already in-conversation — a pointer
// replaces it, and only the volatile sections (recent changes, tasks,
// active work, hygiene) re-inject.
// `priority` orders SURRENDER under budget, highest first. Sections with no
// fallback are load-bearing and never degrade. The listing goes first: it is
// the section that grows with every note and is fully reconstructible with
// one Glob. Hygiene never degrades — it is small and it is actionable.
const PRIORITY = {
	LOAD_BEARING: 0,
	HYGIENE: 5,
	VOLATILE: 10,
	RECENT_CHANGES: 20,
	NORTH_STAR: 30,
	BRAIN_INDEX: 40,
	FILE_LISTING: 50,
} as const;

const sections: BudgetSection[] = [
	{ header: "", body: "## Session Context", priority: PRIORITY.LOAD_BEARING },
	{
		header: "### Date",
		body: formatDateHeader(new Date()),
		priority: PRIORITY.LOAD_BEARING,
	},
];
if (mode === "full") {
	sections.push(
		northStarSection(PRIORITY.NORTH_STAR),
		{
			header: "### Brain Topics (read on demand)",
			body: brainIndex(),
			priority: PRIORITY.BRAIN_INDEX,
			fallback: "(Over budget — list brain/ on demand.)",
		},
	);
}
sections.push(
	{
		header: "### Recent Changes (last 48h)",
		...recentChanges(),
		priority: PRIORITY.RECENT_CHANGES,
		fallback: "(Over budget — run git log on demand.)",
	},
	{ header: "### Open Tasks", ...openTasks(), priority: PRIORITY.VOLATILE },
	{ header: "### Active Work", ...activeWork(), priority: PRIORITY.VOLATILE },
);
if (mode === "full") {
	sections.push({
		header: "### Vault File Listing",
		body: listMd().join("\n"),
		priority: PRIORITY.FILE_LISTING,
		fallback: "(Over budget — Glob the vault on demand.)",
	});
} else {
	sections.push({
		header: "### Context Pointer",
		body: "(Re-entry via resume/compact — North Star, brain index, and the file listing were injected at session start and are unchanged; re-read on demand.)",
		priority: PRIORITY.LOAD_BEARING,
	});
}

// Hygiene drift flags (#98/#103/#106): silent when the vault is clean, so
// the section only spends tokens when it has something to say.
const hygieneLines = formatActiveHygiene(
	scanActiveHygiene(
		cwd,
		Date.now(),
		parseOpenLoopConfig(manifestJson),
		infraRootFilenames,
	),
);
if (hygieneLines.length > 0) {
	sections.push({
		header: "### Vault Hygiene (drift detected)",
		body: hygieneLines.join("\n"),
		priority: PRIORITY.HYGIENE,
	});
}

// The eager layer is held under a byte budget, and the budget under Claude
// Code's hook output cap: past the cap the session gets a 2,000-character
// preview, so a larger budget never binds (#254). An unset or larger
// manifest value is clamped, and the meter says so. fitWithMeter is the
// backstop for the sections that never degrade. Delivered by a mod as an
// instruction file, the layer is under no hook cap: it gets its own budget,
// and the backstop holds the whole file to that budget plus the meter's
// headroom, in bytes, as the hook path holds its budget under the cap.
const budget: InjectionBudget = delivering
	? { bytes: parseInstructionBudget(manifestJson) ?? DEFAULT_INSTRUCTION_BUDGET_BYTES }
	: effectiveInjectionBudget(parseInjectionBudget(manifestJson));
// On the hook path the context goes out inside a JSON envelope (#340), so the
// budget, the backstop cut and the meter's figure all use the encoded size.
// A mod's deliver run stays plain text: it becomes an instruction file.
const measure = delivering ? utf8Bytes : enveloped;
const budgeted = applyInjectionBudget(sections, budget.bytes, measure);
const limit: OutputLimit = delivering
	? { max: budget.bytes + METER_HEADROOM, unit: "bytes", name: "the instruction budget" }
	: envelopedLimit("SessionStart");

const context = fitWithMeter(
	budgeted.text + "\n",
	// Uncut, the size the budget judged, without the separator line added here.
	(cut, bodySize) =>
		formatInjectionSize(cut ? bodySize : budgeted.bytes, {
			budgetBytes: budget.bytes,
			collapsed: budgeted.collapsed,
			degraded: budgeted.degraded,
			cutSections: budgeted.cut,
			clampedFrom: budget.clampedFrom,
			cut,
			cutTo: limit.name,
		}),
	limit,
	measure,
);
if (delivering) process.stdout.write(context);
else writeHookOutput("SessionStart", context);
