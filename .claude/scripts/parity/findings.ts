/**
 * Turns the captured output of a scenario into findings. A finding keeps
 * the row, the note, and the count. It does not keep the wording, because
 * the Notion form changes the wording to name Notion objects.
 *
 * Output that no recognizer knows becomes an `UNMAPPED` finding, so new text
 * in one form shows as a difference and does not go away.
 */

import { createHash } from "node:crypto";
import type { RowId } from "./rows.ts";
import { TRANSCRIPT, type ScenarioRun, type StepRun } from "./runner.ts";
import type { Finding, FixtureSpec, HookEnvironment, Step } from "./spec.ts";

type Found = Omit<Finding, "step">;

const found = (row: Found["row"], fields: Partial<Omit<Found, "row">> = {}): Found => ({
	row,
	note: null,
	detail: null,
	count: null,
	...fields,
});

const filled = (lines: readonly string[]): string[] => lines.filter((line) => line.trim() !== "");

const unmapped = (text: string): Found => found("UNMAPPED", { detail: text.trim().slice(0, 120) });

type Context = { readonly environment: HookEnvironment; readonly spec: FixtureSpec };

const noteOf = (context: Context, reference: string): string =>
	context.environment.noteOf(reference) ?? `not a fixture note: ${reference}`;

type Recognizer = readonly [pattern: RegExp, finding: (match: RegExpExecArray, context: Context) => Found];

function recognize(recognizers: readonly Recognizer[], text: string, context: Context): Found | null {
	for (const [pattern, finding] of recognizers) {
		const match = pattern.exec(text);
		if (match) return finding(match, context);
	}
	return null;
}

const CLAIMS: readonly Recognizer[] = [
	[/^(\S+) present beside AGENTS\.md/, (m) => found("HY-07", { detail: m[1]! })],
	[/^AGENTS\.md is (\d+)KB/, (m) => found("HY-09", { sizeKb: Number(m[1]) })],
	[/^(\d+) note\(s\) marked done but still in active\//, (m) => found("HY-01", { detail: "claim", count: Number(m[1]) })],
	[/^Loose active\/ notes that look like one topic/, () => found("HY-02", { detail: "claim" })],
	[/^(\d+) note\(s\) past the 25KB organization threshold/, (m) => found("HY-03", { detail: "claim", count: Number(m[1]) })],
	[/^(\d+) note\(s\) with open follow-ups untouched 14\+ days/, (m) => found("HY-04", { detail: "claim", count: Number(m[1]) })],
	[/^(\d+) raw export\(s\) sitting in work\/meetings\/ for 7\+ days/, (m) => found("HY-05", { detail: "claim", count: Number(m[1]) })],
];

const cluster = (context: Context, token: string, names: string): string =>
	`${token}: ${names
		.split(", ")
		.map((name) => noteOf(context, name))
		.sort()
		.join(", ")}`;

const HYGIENE_ITEMS: Partial<Record<RowId, Recognizer>> = {
	"HY-01": [/^(.+)$/, (m, context) => found("HY-01", { note: noteOf(context, m[1]!) })],
	"HY-02": [
		/^"([^"]+)": (.+)$/,
		(m, context) => found("HY-02", { detail: cluster(context, m[1]!, m[2]!), count: m[2]!.split(", ").length }),
	],
	"HY-03": [/^(.+) \((\d+)KB\)$/, (m, context) => found("HY-03", { note: noteOf(context, m[1]!), sizeKb: Number(m[2]) })],
	"HY-04": [
		/^(.+) \(\d+d, (\d+) open item\(s\)\)$/,
		(m, context) => found("HY-04", { note: noteOf(context, m[1]!), count: Number(m[2]) }),
	],
};

function hygieneLines(lines: readonly string[], context: Context): Found[] {
	const out: Found[] = [];
	let row: Found["row"] = "UNMAPPED";
	for (const line of lines) {
		if (line.trim() === "") continue;
		if (line.startsWith("⚠️")) {
			const claim = recognize(CLAIMS, line.replace(/^⚠️\s+/, ""), context) ?? unmapped(line);
			row = claim.row;
			out.push(claim);
			continue;
		}
		const entry = /^ {3}- (.+)$/.exec(line)?.[1];
		const more = entry === undefined ? null : /^… and (\d+) more$/.exec(entry);
		const item = row === "UNMAPPED" ? undefined : HYGIENE_ITEMS[row];
		if (more) out.push(found(row, { detail: "more", count: Number(more[1]) }));
		else out.push((entry !== undefined && item ? recognize([item], entry, context) : null) ?? unmapped(line));
	}
	return out;
}

const CHECKLIST_HEADER = "Wrap-up checklist:";
const HYGIENE_HEADER = "Vault Hygiene (drift detected):";
const STOP_REPORT_HEADER = "Stop hook report";
const SUMMARY_CLAIMS = "Hygiene: ";

/** The one-line summary of a Stop report: the checklist, the claims, and where the full report goes. */
const stopSummary = (message: string, context: Context): Found[] =>
	message.split("\n").flatMap((line): Found[] => {
		if (line.startsWith(SUMMARY_CLAIMS)) {
			return line
				.slice(SUMMARY_CLAIMS.length)
				.split(" · ")
				.map((claim) => recognize(CLAIMS, claim, context) ?? unmapped(claim));
		}
		return line.startsWith(`${CHECKLIST_HEADER} `) || line.startsWith("The full report ") ? [] : [unmapped(line)];
	});

/** The full Stop report: an optional preface, the checklist, then the hygiene lines when drift exists. */
function stopReport(text: string, context: Context): Found[] {
	const lines = text.split("\n");
	const start = lines.indexOf(CHECKLIST_HEADER);
	if (start === -1) return [unmapped(text)];
	const hygieneStart = lines.indexOf(HYGIENE_HEADER, start);
	const checklist = filled(lines.slice(start + 1, hygieneStart === -1 ? lines.length : hygieneStart));
	const items = checklist.filter((line) => line.startsWith("- "));
	return [
		...filled(lines.slice(0, start))
			.filter((line) => !line.startsWith(STOP_REPORT_HEADER))
			.map(unmapped),
		found("ST-03", { count: items.length }),
		...checklist.filter((line) => !line.startsWith("- ")).map(unmapped),
		...(hygieneStart === -1 ? [] : [found("ST-04"), ...hygieneLines(lines.slice(hygieneStart + 1), context)]),
	];
}

const WARNINGS: readonly Recognizer[] = [
	[/^Missing YAML frontmatter$/, () => found("VW-07")],
	[/^Missing `(date|description|tags)` in frontmatter/, (m) => found("VW-08", { detail: m[1]! })],
	[/^Missing `([^`]+)` in frontmatter \(required by/, (m) => found("VW-09", { detail: m[1]! })],
	[/^No \[\[wikilinks\]\] found/, () => found("VW-10")],
	[/^(\d+) hard-wrapped paragraph line\(s\)/, (m) => found("VW-11", { count: Number(m[1]) })],
	[/^(\d+) ticket-ID wikilink\(s\)/, (m) => found("VW-12", { count: Number(m[1]) })],
];

type Policy = { readonly policy_id?: unknown; readonly path?: unknown };

const policyNote = (policies: readonly Policy[], id: string, context: Context): string | null => {
	const path = policies.find((policy) => policy.policy_id === id)?.path;
	return typeof path === "string" ? noteOf(context, path) : null;
};

/** The one block that holds empty lines. It ends at its last sentence. */
const MEMORY_BLOCK = /⚠️ {2}Memory location violation: `([^`]+)`[\s\S]*?brain note\(s\)\./g;

const WRITE_BLOCKS: readonly (readonly [RegExp, (m: RegExpExecArray, block: string, policies: readonly Policy[], context: Context) => Found[]])[] = [
	[
		/^Vault hygiene warnings for `([^`]+)`:\n((?: {2}- .+\n)+)Fix these before moving on\.$/,
		(m, _block, _policies, context) =>
			filled(m[2]!.split("\n")).map((line) => {
				const warning = line.slice(4);
				return { ...(recognize(WARNINGS, warning, context) ?? unmapped(warning)), note: noteOf(context, m[1]!) };
			}),
	],
	[/^📐 `([^`]+)` is now (\d+)KB .+$/, (m, _block, _policies, context) => [found("VW-14", { note: noteOf(context, m[1]!), sizeKb: Number(m[2]) })]],
	[
		/^🗂️ {2}This note joins (\d+) loose sibling\(s\) in active\/ sharing "([^"]+)": (.+)\.\nConvention: .+\nToken overlap .+$/,
		(m, _block, policies, context) => [
			found("VW-15", {
				note: policyNote(policies, "topic-cluster", context),
				detail: cluster(context, m[2]!, m[3]!),
				count: Number(m[1]),
			}),
		],
	],
];

function writeFindings(text: string, policies: readonly Policy[], context: Context): Found[] {
	const memory = [...text.matchAll(MEMORY_BLOCK)].map((m) => found("VW-03", { detail: m[1]! }));
	const blocks = text.replace(MEMORY_BLOCK, "").split("\n\n");
	return [
		...memory,
		...blocks.filter((block) => block.trim() !== "").flatMap((block) => {
			for (const [pattern, findings] of WRITE_BLOCKS) {
				const match = pattern.exec(block);
				if (match) return findings(match, block, policies, context);
			}
			return [unmapped(block)];
		}),
	];
}

const HINTS: readonly Recognizer[] = [
	[/^DECISION detected/, () => found("UP-03")],
	[/decision REVERSAL/, () => found("UP-04")],
	[/^INCIDENT detected/, () => found("UP-05")],
	[/^1:1 CONTENT detected/, () => found("UP-06")],
	[/^WIN detected/, () => found("UP-07")],
	[/^ARCHITECTURE discussion/, () => found("UP-08")],
	[/^PERSON CONTEXT detected/, () => found("UP-09")],
	[/^PROJECT UPDATE detected/, () => found("UP-10")],
];

const HINTS_BLOCK = /^Content classification hints .+\n((?:- .+\n)+)\nRemember: .+(?:\n\n|$)/;

/** The hints block first, then the Stop report of the turn before when one waits. */
function promptFindings(text: string, context: Context): Found[] {
	const hintsBlock = HINTS_BLOCK.exec(text);
	const hints = hintsBlock === null ? [] : filled(hintsBlock[1]!.split("\n")).map((line) => line.slice(2));
	const rest = hintsBlock === null ? text : text.slice(hintsBlock[0].length);
	return [
		...(hintsBlock === null ? [] : [found("UP-12", { count: hints.length })]),
		...hints.map((hint) => recognize(HINTS, hint, context) ?? unmapped(hint)),
		...(rest === "" ? [] : rest.startsWith(STOP_REPORT_HEADER) ? [found("UP-02"), ...stopReport(rest, context)] : [unmapped(rest)]),
	];
}

type Section = { readonly header: string; readonly lines: readonly string[] };

const SESSION_TITLE = "## Session Context";
/** The size meter with no note. A meter that reports a cut or a collapsed section has more text. */
const PLAIN_METER = /^_context injected: [\d.]+kB \/ [\d.]+kB budget_$/;

/** The sections of the context. The first one has no header and holds the text before the first section. */
function sections(context: string): Section[] {
	const out: { header: string; lines: string[] }[] = [{ header: "", lines: [] }];
	for (const line of context.split("\n")) {
		if (line.startsWith("### ")) out.push({ header: line.slice(4), lines: [] });
		else if (line !== SESSION_TITLE && !PLAIN_METER.test(line)) out.at(-1)!.lines.push(line);
	}
	return out;
}

function openTasks(lines: readonly string[], context: Context): Found[] {
	const out: Found[] = [];
	let note: string | null = null;
	for (const line of filled(lines)) {
		const task = /^\s*- \[ \] (.+)$/.exec(line)?.[1];
		if (task !== undefined) out.push(found("SS-14", { note, detail: task }));
		else if (line !== "(no open tasks)") note = noteOf(context, line);
	}
	return out;
}

function listing(lines: readonly string[], context: Context): Found[] {
	const repoFiles = new Set(context.spec.repoFiles.map((file) => file.path));
	return filled(lines).flatMap((line): Found[] => {
		const collapsed = /^\.\/(.+)\/ — (\d+) notes \(listing collapsed/.exec(line);
		if (collapsed) {
			const notes = context.environment.notesIn(collapsed[1]!);
			const each = notes.map((note) => found("SS-16", { note, detail: "collapsed" }));
			return notes.length === Number(collapsed[2])
				? each
				: [...each, found("SS-16", { detail: `collapsed count of ${collapsed[1]}`, count: Number(collapsed[2]) })];
		}
		const path = line.replace(/^\.\//, "");
		// A file of the repository is not a note, and only the Markdown form lists it.
		if (repoFiles.has(path)) return [];
		return [found("SS-16", { note: noteOf(context, path), detail: "listed" })];
	});
}

const SESSION_SECTIONS: Readonly<Record<string, (lines: readonly string[], context: Context) => Found[]>> = {
	Date: (lines) => {
		const line = filled(lines).join("\n");
		return [found("SS-10", { detail: /^\d{4}-\d{2}-\d{2} \(\w+\)$/.test(line) ? "date line" : line })];
	},
	"North Star (current goals)": (lines) =>
		filled(lines).map((line) => {
			const hidden = /^_\((\d+) completed items? hidden/.exec(line);
			return hidden
				? found("SS-11", { detail: "completed items hidden", count: Number(hidden[1]) })
				: found("SS-11", { detail: line });
		}),
	"Brain Topics (read on demand)": (lines, context) =>
		filled(lines).map((line) => {
			const entry = /^- \[\[([^\]]+)\]\] — (.+)$/.exec(line);
			return entry ? found("SS-12", { note: noteOf(context, entry[1]!), detail: entry[2]! }) : unmapped(line);
		}),
	"Recent Changes (last 48h)": (lines) => {
		const entries = filled(lines);
		return [
			entries.join("\n") === "(no git history)"
				? found("SS-13", { detail: "no history" })
				: found("SS-13", { detail: "entries", count: entries.length }),
		];
	},
	"Open Tasks": openTasks,
	"Active Work": (lines, context) =>
		filled(lines)
			.filter((line) => line !== "(none)")
			.map((line) => found("SS-15", { note: noteOf(context, line) })),
	"Vault File Listing": listing,
	"Vault Hygiene (drift detected)": (lines, context) => [found("SS-17"), ...hygieneLines(lines, context)],
	"": (lines) => filled(lines).map(unmapped),
};

const sessionFindings = (text: string, context: Context): Found[] =>
	sections(text).flatMap(({ header, lines }) => SESSION_SECTIONS[header]?.(lines, context) ?? [unmapped(`### ${header}`)]);

type Output =
	| { readonly shape: "silent" }
	| { readonly shape: "unparsed output" }
	| { readonly shape: "empty envelope" }
	| { readonly shape: "additional context"; readonly context: string; readonly policies: readonly Policy[] }
	| { readonly shape: "system message"; readonly message: string }
	| { readonly shape: "system message and feedback"; readonly message: string; readonly context: string }
	| { readonly shape: "report data"; readonly key: unknown; readonly claims: unknown; readonly text: string };

function outputOf(stdout: string): Output {
	if (stdout === "") return { shape: "silent" };
	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(stdout) as Record<string, unknown>;
	} catch {
		return { shape: "unparsed output" };
	}
	if (parsed === null || typeof parsed !== "object") return { shape: "unparsed output" };
	const specific = parsed["hookSpecificOutput"] as Record<string, unknown> | undefined;
	const context = specific?.["additionalContext"];
	const message = parsed["systemMessage"];
	const report = parsed["report"] as Record<string, unknown> | undefined;
	if (report !== undefined && typeof report["agentText"] === "string") {
		return { shape: "report data", key: report["key"], claims: report["claims"], text: report["agentText"] };
	}
	if (typeof message === "string" && typeof context === "string") return { shape: "system message and feedback", message, context };
	if (typeof message === "string") return { shape: "system message", message };
	if (typeof context === "string") {
		const policies = specific?.["policyResults"];
		return { shape: "additional context", context, policies: Array.isArray(policies) ? (policies as Policy[]) : [] };
	}
	return Object.keys(parsed).length === 0 ? { shape: "empty envelope" } : { shape: "unparsed output" };
}

function channelRow(step: Step, output: Output): RowId {
	if (step.hook === "session-start") return "SS-19";
	if (step.hook === "validate-write") return "VW-17";
	if (step.hook === "pre-compact") return "PC-01";
	if (step.hook === "classify-message") return step.input.kind === "raw" ? "UP-01" : "UP-14";
	const fields = step.input.kind === "payload" ? step.input.fields : {};
	if (output.shape === "report data") return "ST-08";
	if (output.shape === "system message and feedback") return "ST-10";
	if (output.shape === "system message") {
		const stopOfSession = (fields["hook_event_name"] ?? "Stop") === "Stop" && fields["session_id"] !== "";
		return stopOfSession ? "ST-09" : "ST-11";
	}
	if (fields["om_mod"] === "standdown") return "ST-01";
	if (fields["stop_hook_active"] === true) return "ST-02";
	return "ST-07";
}

function contentFindings(step: Step, output: Output, context: Context): Found[] {
	switch (output.shape) {
		case "silent":
		case "empty envelope":
		case "unparsed output":
			return [];
		case "additional context":
			if (step.hook === "session-start") return sessionFindings(output.context, context);
			if (step.hook === "validate-write") return writeFindings(output.context, output.policies, context);
			return promptFindings(output.context, context);
		case "system message":
			return output.message.split("\n")[0] === CHECKLIST_HEADER
				? stopReport(output.message, context)
				: stopSummary(output.message, context);
		case "system message and feedback":
			// The summary repeats the claims of the report, so only its unknown text counts.
			return [
				...stopSummary(output.message, context).filter((finding) => finding.row === "UNMAPPED"),
				...stopReport(output.context, context),
			];
		case "report data":
			return [
				found("ST-06", { detail: typeof output.key === "string" && /^[0-9a-f]{16}$/.test(output.key) ? "key" : "no key" }),
				...stopReport(output.text, context),
			];
	}
}

const TRANSCRIPT_SHA256 = createHash("sha256").update(TRANSCRIPT).digest("hex");

function sessionLogFindings(run: StepRun): Found[] {
	const copies = new Map<string, number>();
	for (const log of run.sessionLogs) {
		if (log.sha256 !== TRANSCRIPT_SHA256) continue;
		const trigger = /^session_(.+)_\d{8}_\d{6}\.jsonl$/.exec(log.name)?.[1] ?? log.name;
		copies.set(trigger, (copies.get(trigger) ?? 0) + 1);
	}
	return [
		...[...copies].map(([trigger, count]) => found("PC-03", { detail: trigger, count })),
		found("PC-04", { count: run.sessionLogs.length }),
	];
}

export function findingsOf(scenarioRun: ScenarioRun, spec: FixtureSpec): Finding[] {
	const context: Context = { environment: scenarioRun.environment, spec };
	return scenarioRun.runs.flatMap((run, step) => {
		const stepInput = scenarioRun.scenario.steps[step]!;
		const output = outputOf(run.stdout);
		const exit = run.exitCode === 0 ? "" : ` (exit ${run.exitCode})`;
		const all = [
			found(channelRow(stepInput, output), { detail: output.shape + exit }),
			...contentFindings(stepInput, output, context),
			...(stepInput.hook === "pre-compact" ? sessionLogFindings(run) : []),
		];
		return all.map((finding): Finding => ({ ...finding, step }));
	});
}

/** The findings of each scenario of one form, by scenario ID. */
export type Pass = ReadonlyMap<string, readonly Finding[]>;

export const passOf = (runs: readonly ScenarioRun[], spec: FixtureSpec): Pass =>
	new Map(runs.map((run) => [run.scenario.id, findingsOf(run, spec)] as const));
