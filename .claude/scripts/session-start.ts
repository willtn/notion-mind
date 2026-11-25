#!/usr/bin/env node
/**
 * SessionStart hook — inject workspace context into the agent's first turn.
 *
 * Emits a markdown block on stdout with: date header, North Star excerpt,
 * brain-topics index, the rows that changed in the last 48h, open tasks of
 * the loose active work and of Home, active work listing, and a listing of
 * the notes by database and type. Each part comes from the Notion workspace
 * (lib/session-sources.ts).
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

import { readFileSync, appendFileSync } from "node:fs";
import {
	formatDateHeader,
	formatEnvExport,
	injectionMode,
	formatInjectionSize,
	formatActiveWork,
	formatRecentChanges,
	formatBrainIndex,
	formatListing,
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
	DEFAULT_LISTING_COLLAPSE_THRESHOLD,
	type BudgetSection,
	type BudgetLevel,
	northStarLadder,
	renderHeadlines,
	topHeadlines,
	NORTH_STAR_POINTER,
} from "./lib/session-start.ts";
import { parseOpenLoopConfig } from "./lib/active-hygiene.ts";
import { formatHygiene } from "./lib/hygiene-scan.ts";
import { envelopedLimit, fitWithMeter, type OutputLimit, readStdinJson, writeHookOutput } from "./lib/hook-io.ts";
import { notionMapPath, readNotionMap, type NotionMap } from "./lib/notion-map.ts";
import { readOmMod } from "./lib/om-mod.ts";
import { resolveProjectDir } from "./lib/project-dir.ts";
import { readSessionSources, sessionSourcesNotRead, type Read, type SessionSources } from "./lib/session-sources.ts";
import { lazyNotion } from "./lib/write-hook.ts";

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

// The manifest is read once: the listing limit, the watched types of the
// hygiene scan, and the budgets all come from it. A missing or malformed
// manifest gives the default of each.
const manifestJson = readManifestRaw();

const RECENT_CHANGES_LIMIT = 15;
const ACTIVE_WORK_LIMIT = 10;
const OPEN_TASKS_LIMIT = 10;

/**
 * The time that this run has for all its Notion calls. The hook timeout of
 * `settings.json` is 30 s, and a run that passes it gives the session no
 * context. So the calls stop first, and each part that got no reply says
 * so in its section.
 */
const NOTION_BUDGET_MS = 20_000;
/** The calls in flight at one time. A full context makes about 30 calls in two rounds (measured on the fixture root). */
const NOTION_CONCURRENCY = 16;

async function readSources(): Promise<SessionSources> {
	let map: NotionMap;
	try {
		map = readNotionMap(notionMapPath(cwd));
	} catch (error) {
		return sessionSourcesNotRead(mode, cwd, "the Notion map file", error);
	}
	const notion = lazyNotion(NOTION_BUDGET_MS, { concurrency: NOTION_CONCURRENCY });
	const read = await readSessionSources({
		call: notion.call,
		map,
		projectDir: cwd,
		nowMs: Date.now(),
		mode,
		watchedTypes: parseOpenLoopConfig(manifestJson).types,
		openTaskLimit: OPEN_TASKS_LIMIT,
	});
	await notion.close();
	return read;
}
const sources = await readSources();

/**
 * A section body with what was cut from its source, so the meter can say so
 * (no section may present a cut as whole).
 */
type Built = { readonly body: string; readonly cut?: string | undefined };

const keptOf = (kept: number, total: number): string | undefined =>
	total > kept ? `${kept} of ${total}` : undefined;

const notReadLine = (cause: string): string => `(not read: ${cause})`;

/** The section of a part: what `build` makes of its value, or a line that says that the hook did not read it. */
const built = <T>(read: Read<T>, build: (value: T) => Built): Built => ("notRead" in read ? { body: notReadLine(read.notRead) } : build(read.value));

/** The North Star section, with its ladder: full → focus → headlines → top-N → pointer. */
function northStarSection(read: Read<string>, priority: number): BudgetSection {
	const header = "### North Star (current goals)";
	if ("notRead" in read) return { header, body: notReadLine(read.notRead), priority, fallback: NORTH_STAR_POINTER };
	const ladder = northStarLadder(read.value);
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

function recentChanges(): Built {
	return built(sources.recentChanges, (titles) => ({
		body: formatRecentChanges(titles, RECENT_CHANGES_LIMIT),
		cut: keptOf(RECENT_CHANGES_LIMIT, titles.length),
	}));
}

function openTasks(): Built {
	return built(sources.openTasks, ({ notes, notFetched }) => {
		const byNote = notes.map(({ title, content }) => ({ path: title, content }));
		const total = byNote.reduce((n, { content }) => n + content.split(/\r?\n/).filter((line) => /^\s*- \[ \]/.test(line)).length, notFetched);
		return { body: collectOpenTasks(byNote, OPEN_TASKS_LIMIT), cut: keptOf(OPEN_TASKS_LIMIT, total) };
	});
}

function activeWork(): Built {
	return built(sources.activeWork, (titles) => ({ body: formatActiveWork(titles, ACTIVE_WORK_LIMIT), cut: keptOf(ACTIVE_WORK_LIMIT, titles.length) }));
}

const listingCollapseThreshold =
	parseListingCollapseThreshold(manifestJson) ??
	DEFAULT_LISTING_COLLAPSE_THRESHOLD;

// Source-aware assembly (#107): on resume/compact the static bulk (North
// Star, brain index, listing) is already in-conversation — a pointer
// replaces it, and only the volatile sections (recent changes, tasks,
// active work, hygiene) re-inject.
// `priority` orders SURRENDER under budget, highest first. Sections with no
// fallback are load-bearing and never degrade. The listing goes first: it is
// the section that grows with every note, and a query of each database gives
// it again. Hygiene never degrades — it is small and it is actionable.
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
if (sources.mode === "full") {
	sections.push(
		northStarSection(sources.northStar, PRIORITY.NORTH_STAR),
		{
			header: "### Brain Topics (read on demand)",
			...built(sources.brainTopics, (topics) => ({ body: formatBrainIndex(topics) })),
			priority: PRIORITY.BRAIN_INDEX,
			fallback: '(Over budget — query the view "Brain index" on demand.)',
		},
	);
}
sections.push(
	{
		header: "### Recent Changes (last 48h)",
		...recentChanges(),
		priority: PRIORITY.RECENT_CHANGES,
		fallback: '(Over budget — query the view "Recently changed" of a database on demand.)',
	},
	{ header: "### Open Tasks", ...openTasks(), priority: PRIORITY.VOLATILE },
	{ header: "### Active Work", ...activeWork(), priority: PRIORITY.VOLATILE },
);
if (sources.mode === "full") {
	sections.push({
		header: "### Workspace Listing",
		...built(sources.listing, ({ pages, groups }) => ({ body: formatListing(pages, groups, listingCollapseThreshold).join("\n") })),
		priority: PRIORITY.FILE_LISTING,
		fallback: "(Over budget — query the databases on demand.)",
	});
} else {
	sections.push({
		header: "### Context Pointer",
		body: "(Re-entry via resume/compact — North Star, brain index, and the workspace listing were injected at session start and are unchanged; re-read on demand.)",
		priority: PRIORITY.LOAD_BEARING,
	});
}

// Hygiene drift flags (#98/#103/#106): silent when the workspace is clean, so
// the section only spends tokens when it has something to say.
const hygieneLines = formatHygiene(sources.hygiene);
if (hygieneLines.length > 0) {
	sections.push({
		header: "### Workspace Hygiene (drift detected)",
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
