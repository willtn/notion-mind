/**
 * Turns the captured output of a scenario into findings. A finding keeps
 * the row, the note, the detail, the count, and the instruction text. The
 * patterns and the object names come from `HookEnvironment.wording`, and no
 * wording is in this file.
 *
 * Each line and each field of the output gives a finding. Output that no
 * pattern knows becomes an `UNMAPPED` finding, so new text in one form shows
 * as a difference and does not go away.
 */

import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { ROWS, type RowId } from "./rows.ts";
import { oldSessionLogName, TRANSCRIPT, type ScenarioRun, type StepRun } from "./runner.ts";
import { PROPERTY_OF_FIELD, type Finding, type FixtureSpec, type HookEnvironment, type HookName, type Scenario, type Step } from "./spec.ts";
import { capturesOf, findingOf, itemPlaceOf, kindsIn, type Capture, type Place, type TextKind } from "./wording.ts";

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

const isString = (value: unknown): value is string => typeof value === "string";

type Context = {
	readonly environment: HookEnvironment;
	readonly spec: FixtureSpec;
	/** The home directory of the hook processes. A path below it is equal in both forms. */
	readonly home: string;
	/** The directories of this run, and the name that both forms give each one. */
	readonly paths: readonly (readonly [path: string, name: string])[];
};

const noteOf = (context: Context, reference: string): string =>
	context.environment.noteOf(reference) ?? `not a fixture note: ${reference}`;

type Match = {
	readonly kind: TextKind;
	readonly groups: Readonly<Record<string, string | undefined>>;
	/** The matched text with a `{name}` in the place of each group of the kind. */
	readonly frame: string;
};

const withIndices = new WeakMap<RegExp, RegExp>();

/** The same pattern with the flag that gives the position of each group. */
function indexed(pattern: RegExp): RegExp {
	const known = withIndices.get(pattern);
	if (known !== undefined) return known;
	const made = pattern.flags.includes("d") ? pattern : new RegExp(pattern.source, `${pattern.flags}d`);
	withIndices.set(pattern, made);
	return made;
}

function frameOf(kind: TextKind, text: string, match: RegExpExecArray): string {
	const spans = capturesOf(kind)
		.flatMap((capture) => {
			const span = match.indices?.groups?.[capture];
			return span === undefined ? [] : [{ capture, start: span[0], end: span[1] }];
		})
		.sort((a, b) => a.start - b.start);
	let frame = "";
	let at = 0;
	for (const { capture, start, end } of spans) {
		if (start < at) continue;
		frame += `${text.slice(at, start)}{${capture}}`;
		at = end;
	}
	return frame + text.slice(at);
}

function matchOf(context: Context, kinds: readonly TextKind[], text: string): Match | null {
	for (const kind of kinds) {
		const pattern = context.environment.wording.patterns[kind];
		const match = pattern === undefined ? null : indexed(pattern).exec(text);
		if (match) return { kind, groups: match.groups ?? {}, frame: frameOf(kind, text, match) };
	}
	return null;
}

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `text` with the neutral name in the place of each object name of the form. A longer name wins at one position. */
function neutral(context: Context, text: string): string {
	const names = [...context.environment.wording.names].sort(([a], [b]) => b.length - a.length);
	if (names.length === 0) return text;
	const neutralOf = new Map(names);
	return text.replace(new RegExp(names.map(([name]) => escaped(name)).join("|"), "g"), (name) => neutralOf.get(name) ?? name);
}

/** The instruction text of matched text: the frame, with no path of this run and no object name of the form. */
function instructionOf(match: Match, context: Context): string | undefined {
	if (findingOf(match.kind).data) return undefined;
	let text = match.frame;
	for (const [path, name] of context.paths) text = text.replaceAll(path, name);
	return neutral(context, text);
}

function captured(match: Match, capture: Capture): string {
	const value = match.groups[capture];
	if (value === undefined) throw new Error(`the pattern of "${match.kind}" has no group "${capture}"`);
	return value;
}

const captureOf = (match: Match, capture: Capture): string | undefined =>
	capturesOf(match.kind).includes(capture) ? captured(match, capture) : undefined;

const itemsOf = (list: string): string[] =>
	filled(list.includes("\n") ? list.split("\n") : list.split(" · ")).map((item) => item.replace(/^\s*- /, ""));

const propertyOf = (field: string): string => (PROPERTY_OF_FIELD as Readonly<Record<string, string | undefined>>)[field] ?? field;

/**
 * The findings that matched text gives by itself. `label` goes in front of
 * the detail. `position` is the place of the text in its list, from 1.
 */
function findingsFrom(match: Match, context: Context, label?: string, position?: number): Found[] {
	const { row, detail, numbered } = findingOf(match.kind);
	if (row === undefined) return [];
	const notes = captureOf(match, "notes")
		?.split(", ")
		.map((name) => noteOf(context, name))
		.sort();
	const token = captureOf(match, "token");
	const field = captureOf(match, "field");
	const details = [
		label,
		numbered && position !== undefined ? `${detail} ${position}` : detail,
		token === undefined ? undefined : `${token}:`,
		notes?.join(", "),
		field === undefined ? undefined : propertyOf(field),
		captureOf(match, "detail"),
	].filter(isString);
	const count = captureOf(match, "count");
	const items = captureOf(match, "items");
	const sizeKb = captureOf(match, "sizeKb");
	const text = instructionOf(match, context);
	const fields = {
		detail: details.length === 0 ? null : details.join(" "),
		count: count !== undefined ? Number(count) : items !== undefined ? itemsOf(items).length : (notes?.length ?? null),
		...(sizeKb === undefined ? {} : { sizeKb: Number(sizeKb) }),
		...(text === undefined ? {} : { text }),
	};
	const group = captureOf(match, "group");
	if (group === undefined) {
		const note = captureOf(match, "note");
		return [found(row, { ...fields, note: note === undefined ? null : noteOf(context, note) })];
	}
	const members = context.environment.notesIn(group);
	return [
		...members.map((note) => found(row, { note, detail: fields.detail })),
		...(members.length === fields.count ? [] : [found(row, { detail: `${fields.detail} count`, count: fields.count })]),
	];
}

const recognize = (context: Context, place: Place, text: string, label?: string, position?: number): Found[] => {
	const match = matchOf(context, kindsIn(place), text);
	return match === null ? [unmapped(text)] : findingsFrom(match, context, label, position);
};

/** The findings of each item of a matched list. A note that the list names is the note of each item. */
function itemFindings(match: Match, context: Context): Found[] {
	const place = itemPlaceOf(match.kind);
	if (place === undefined) return [];
	const reference = captureOf(match, "note");
	const note = reference === undefined ? null : noteOf(context, reference);
	return itemsOf(captured(match, "items"))
		.flatMap((item, index) => recognize(context, place, item, findingOf(match.kind).itemLabel, index + 1))
		.map((finding) => (note === null ? finding : { ...finding, note }));
}

function withItems(match: Match, context: Context): Found[] {
	const items = itemFindings(match, context);
	const order = findingOf(match.kind).ordered ? items.map(({ row }) => row).join(", ") : undefined;
	return [...findingsFrom(match, context, order), ...items];
}

/** The shortest run of paragraphs at the start of `text` that is a known block of `place`. */
function leadingBlock(context: Context, place: Place, text: string): { readonly match: Match; readonly rest: string } | null {
	const paragraphs = text.split("\n\n");
	for (let end = 1; end <= paragraphs.length; end++) {
		const match = matchOf(context, kindsIn(place), paragraphs.slice(0, end).join("\n\n"));
		if (match) return { match, rest: paragraphs.slice(end).join("\n\n") };
	}
	return null;
}

/** A row that part (d) compares. The order of the claims names only these rows, so it is equal in both forms. */
const isCompared = (row: RowId): boolean => ROWS[row].rule !== "not-applicable";

/** The hygiene report: a claim line, then the entries of that claim. The claims have an order, and a long list has a cap. */
function hygieneLines(lines: readonly string[], context: Context): Found[] {
	const out: Found[] = [];
	const order: RowId[] = [];
	let row: RowId | null = null;
	for (const line of filled(lines)) {
		if (line.startsWith("⚠️")) {
			const claim = matchOf(context, kindsIn("claim"), line.replace(/^⚠️\s+/, ""));
			row = claim === null ? null : (findingOf(claim.kind).row ?? null);
			if (row !== null && isCompared(row)) order.push(row);
			out.push(...(claim === null ? [unmapped(line)] : findingsFrom(claim, context, "claim")));
			continue;
		}
		const entry = /^\s+- (.+)$/.exec(line)?.[1];
		const claimRow = row;
		const ofClaim = kindsIn("item").filter((kind) => kind === "more items" || findingOf(kind).row === claimRow);
		const item = entry === undefined || claimRow === null ? null : matchOf(context, ofClaim, entry);
		if (item === null || claimRow === null) out.push(unmapped(line));
		else out.push(...findingsFrom(item, context, item.kind === "more items" ? claimRow : undefined));
	}
	return order.length === 0 ? out : [found("HY-10", { detail: `order: ${order.join(", ")}` }), ...out];
}

/** The one-line summary of a Stop report: the checklist, the claims, and where the full report goes. */
const stopSummary = (message: string, context: Context): Found[] =>
	message.split("\n").flatMap((line) => {
		const match = matchOf(context, kindsIn("summary"), line);
		return match === null ? [unmapped(line)] : withItems(match, context);
	});

/**
 * The full Stop report: a preface, the checklist, then the hygiene lines
 * when drift exists. `null` means that the text holds no checklist.
 */
function stopReport(text: string, context: Context): Found[] | null {
	const lines = text.split("\n");
	const is = (kind: TextKind) => (line: string): boolean => matchOf(context, [kind], line) !== null;
	const start = lines.findIndex(is("checklist header"));
	if (start === -1) return null;
	const hygieneStart = lines.findIndex((line, index) => index > start && is("hygiene header")(line));
	const checklist = filled(lines.slice(start + 1, hygieneStart === -1 ? lines.length : hygieneStart));
	const items = checklist.flatMap((line, index) => recognize(context, "checklist", line, undefined, index + 1));
	return [
		...filled(lines.slice(0, start)).flatMap((line) => recognize(context, "preface", line)),
		found("ST-03", { count: items.filter(({ row }) => row !== "UNMAPPED").length }),
		...items,
		...(hygieneStart === -1
			? []
			: [...recognize(context, "report", lines[hygieneStart]!), ...hygieneLines(lines.slice(hygieneStart + 1), context)]),
	];
}

/** The blocks of a write, with a blank line between two blocks. One call that writes more than one note states how many blocks it merged. */
function writeFindings(text: string, context: Context, step: Step): Found[] {
	const out: Found[] = [];
	let blocks = 0;
	for (let rest = text; rest !== ""; blocks++) {
		const block = leadingBlock(context, "write", rest);
		if (block !== null) {
			out.push(...withItems(block.match, context));
			rest = block.rest;
			continue;
		}
		const [first = "", ...more] = rest.split("\n\n");
		if (first.trim() !== "") out.push(unmapped(first));
		rest = more.join("\n\n");
	}
	const merged = step.input.kind === "write" && step.input.notes.length > 1;
	return merged ? [found("VW-16", { detail: "blocks", count: blocks }), ...out] : out;
}

/** The shortest run of lines at the start of `text` that is a known block of `place`. */
function leadingLines(context: Context, place: Place, text: string): { readonly match: Match; readonly rest: string } | null {
	const lines = text.split("\n");
	for (let end = 1; end <= lines.length; end++) {
		const match = matchOf(context, kindsIn(place), lines.slice(0, end).join("\n"));
		if (match) return { match, rest: lines.slice(end).join("\n") };
	}
	return null;
}

/** The hints block first, then the Stop report of the turn before when one waits. A blank line must be between the two parts. */
function promptFindings(text: string, context: Context): Found[] {
	const hints = leadingLines(context, "prompt", text);
	const after = hints === null ? text : hints.rest;
	const rest = after.replace(/^\n+/, "");
	const report = rest === "" ? [] : stopReport(rest, context);
	const join = hints === null || rest === "" ? [] : [found("UP-14", { detail: after.startsWith("\n") ? "a blank line between the parts" : "no blank line between the parts" })];
	return [
		...(hints === null ? [] : withItems(hints.match, context)),
		...join,
		...(report === null ? [unmapped(rest)] : report.length === 0 ? [] : [found("UP-02"), ...report]),
	];
}

function openTasks(lines: readonly string[], context: Context): Found[] {
	const out: Found[] = [];
	let note: string | null = null;
	for (const line of filled(lines)) {
		const match = matchOf(context, kindsIn("open tasks"), line);
		if (match === null) {
			out.push(unmapped(line));
			continue;
		}
		const header = findingOf(match.kind).row === undefined ? captureOf(match, "note") : undefined;
		if (header !== undefined) note = noteOf(context, header);
		out.push(...findingsFrom(match, context).map((finding) => ({ ...finding, note })));
	}
	return out;
}

function listing(lines: readonly string[], context: Context): Found[] {
	const repoFiles = new Set(context.spec.repoFiles.map((file) => file.path));
	return filled(lines).flatMap((line): Found[] => {
		const match = matchOf(context, kindsIn("listing"), line);
		if (match === null) return [unmapped(line)];
		// A file of the repository is not a note, and only the Markdown form lists it.
		if (repoFiles.has(match.groups["note"] ?? "")) return [];
		return findingsFrom(match, context);
	});
}

const eachLine =
	(place: Place) =>
	(lines: readonly string[], context: Context): Found[] =>
		filled(lines).flatMap((line) => recognize(context, place, line));

type SectionKind = Extract<TextKind, `section ${string}`>;

const SECTION_LINES: Readonly<Record<SectionKind, (lines: readonly string[], context: Context) => Found[]>> = {
	"section date": eachLine("date"),
	"section north star": eachLine("north star"),
	"section brain topics": eachLine("brain topics"),
	"section recent changes": eachLine("recent changes"),
	"section open tasks": openTasks,
	"section active work": eachLine("active work"),
	"section listing": listing,
	"section context pointer": eachLine("context pointer"),
	"section hygiene": hygieneLines,
};

/** The sections of the SessionStart context, and their order. A `### ` line starts a section. */
function sessionFindings(text: string, context: Context): Found[] {
	const out: Found[] = [];
	const order: string[] = [];
	let header: string | null = null;
	let lines: string[] = [];
	const close = (): void => {
		const section = header === null ? null : matchOf(context, kindsIn("section"), header);
		if (section === null) out.push(...filled(header === null ? lines : [header, ...lines]).map(unmapped));
		else {
			order.push(section.kind.slice("section ".length));
			out.push(...findingsFrom(section, context), ...SECTION_LINES[section.kind as SectionKind](lines, context));
		}
		lines = [];
	};
	for (const line of text.split("\n")) {
		const whole = matchOf(context, kindsIn("session"), line);
		if (whole !== null) out.push(...findingsFrom(whole, context));
		else if (line.startsWith("### ")) {
			close();
			header = line;
		} else lines.push(line);
	}
	close();
	return [found("SS-19", { detail: `sections: ${order.join(", ")}` }), ...out];
}

/** The fields of the hook output that this repository uses. Each other field is in `unknown`. */
type Envelope = {
	readonly eventName: string | null;
	readonly context: string | null;
	readonly policies: readonly unknown[];
	readonly message: string | null;
	readonly report: { readonly key: string | null; readonly claims: readonly unknown[]; readonly text: string | null } | null;
	readonly unknown: readonly string[];
};

type Output = "silent" | "unparsed output" | Envelope;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

const isList = (value: unknown): value is unknown[] => Array.isArray(value);

function outputOf(stdout: string): Output {
	if (stdout === "") return "silent";
	let parsed: unknown;
	try {
		parsed = JSON.parse(stdout);
	} catch {
		return "unparsed output";
	}
	if (!isRecord(parsed)) return "unparsed output";

	const unknown: string[] = [];
	/** A reader of the known fields of `record`. A field that it never reads, or that has the wrong type, goes to `unknown`. */
	const fieldsOf = <K extends string>(record: Record<string, unknown> | null, path: string, known: readonly K[]) => {
		unknown.push(
			...Object.keys(record ?? {})
				.filter((key) => !(known as readonly string[]).includes(key))
				.map((key) => path + key),
		);
		return <T>(key: K, is: (value: unknown) => value is T): T | null => {
			const value = record?.[key];
			if (value === undefined || is(value)) return value ?? null;
			unknown.push(path + key);
			return null;
		};
	};

	const top = fieldsOf(parsed, "", ["hookSpecificOutput", "systemMessage", "report"]);
	const specificRecord = top("hookSpecificOutput", isRecord);
	const reportRecord = top("report", isRecord);
	const specific = fieldsOf(specificRecord, "hookSpecificOutput.", ["hookEventName", "additionalContext", "policyResults"]);
	const report = fieldsOf(reportRecord, "report.", ["key", "claims", "agentText"]);
	return {
		eventName: specific("hookEventName", isString),
		context: specific("additionalContext", isString),
		policies: specific("policyResults", isList) ?? [],
		message: top("systemMessage", isString),
		report:
			reportRecord === null
				? null
				: { key: report("key", isString), claims: report("claims", isList) ?? [], text: report("agentText", isString) },
		unknown,
	};
}

/** The channels that the output uses, and the event that it names. */
function channelOf(output: Output): string {
	if (isString(output)) return output;
	const channels = [
		output.report === null ? null : "report data",
		output.message === null ? null : "system message",
		output.context === null ? null : output.message === null ? "additional context" : "feedback",
	].filter(isString);
	const label = channels.length === 0 ? "empty envelope" : channels.join(" and ");
	return output.eventName === null ? label : `${label}, event ${output.eventName}`;
}

function channelRow(step: Step, output: Output): RowId {
	const fields = step.input.kind === "payload" ? step.input.fields : {};
	if (step.hook === "session-start") {
		if (step.input.kind === "raw") return "SS-01";
		return fields["om_mod"] === "standdown" ? "SS-03" : "SS-19";
	}
	if (step.hook === "validate-write") return "VW-17";
	if (step.hook === "pre-compact") return "PC-01";
	if (step.hook === "classify-message") return step.input.kind === "raw" ? "UP-01" : "UP-14";
	const envelope = isString(output) ? null : output;
	if (envelope !== null && envelope.report !== null) return "ST-08";
	if (envelope !== null && envelope.message !== null) {
		if (envelope.context !== null) return "ST-10";
		const stopOfSession = (fields["hook_event_name"] ?? "Stop") === "Stop" && fields["session_id"] !== "";
		return stopOfSession ? "ST-09" : "ST-11";
	}
	if (fields["om_mod"] === "standdown") return "ST-01";
	if (fields["stop_hook_active"] === true || fields["stopHookActive"] === true) return "ST-02";
	return "ST-07";
}

/** The row of each policy. A policy ID is an identifier and not wording, so both forms use the same IDs. */
const POLICY_ROW: Readonly<Record<string, RowId | undefined>> = {
	"memory-location": "VW-03",
	"phantom-edge": "VW-12",
	"organization-threshold": "VW-14",
	"topic-cluster": "VW-15",
};

/** The neutral name of text that is one object name of the form as a whole. */
const neutralName = (context: Context, text: string): string =>
	context.environment.wording.names.find(([name]) => name === text)?.[1] ?? text;

/** One policy result: its ID, its class, its action, its target, and its note. A target is an object name of the form. */
function policyFinding(policy: unknown, context: Context): Found {
	if (!isRecord(policy)) return unmapped(`policy ${JSON.stringify(policy)}`);
	const { policy_id: id, path, classification, action, suggested_target: target, ...others } = policy;
	const note = isString(path) ? context.environment.noteOf(path) : null;
	const place = isString(path) && context.home !== "" && path.startsWith(context.home) ? `~${path.slice(context.home.length)}` : path;
	const detail = [
		`policy ${String(id)}`,
		String(classification),
		String(action),
		...(target === undefined ? [] : [`with the target ${isString(target) ? neutralName(context, target) : JSON.stringify(target)}`]),
		...Object.keys(others)
			.sort()
			.map((key) => `with ${key}`),
		...(note === null ? [`at ${String(place).replaceAll("\\", "/")}`] : []),
	].join(", ");
	return found((isString(id) ? POLICY_ROW[id] : undefined) ?? "UNMAPPED", { note, detail });
}

const CONTEXT_FINDINGS: Readonly<Record<HookName, (text: string, context: Context, step: Step) => Found[]>> = {
	"session-start": sessionFindings,
	"validate-write": writeFindings,
	"classify-message": promptFindings,
	"stop-checklist": (text, context) => stopReport(text, context) ?? [unmapped(text)],
	"pre-compact": (text) => [unmapped(text)],
};

const REPORT_KEY = /^[0-9a-f]{16}$/;

function contentFindings(step: Step, output: Envelope, firstStepOf: (key: string) => number, context: Context): Found[] {
	const { report, message } = output;
	return [
		...output.unknown.map((field) => unmapped(`output field ${field}`)),
		...(report === null
			? []
			: [
					found("ST-06", {
						detail: report.key !== null && REPORT_KEY.test(report.key) ? `key first given at step ${firstStepOf(report.key)}` : "no key",
					}),
					...report.claims.flatMap((claim) =>
						isString(claim) ? recognize(context, "claim", claim, "data claim") : [unmapped(`claim ${JSON.stringify(claim)}`)],
					),
					...(report.text === null ? [] : (stopReport(report.text, context) ?? [unmapped(report.text)])),
				]),
		...(message === null ? [] : (stopReport(message, context) ?? stopSummary(message, context))),
		...(output.context === null ? [] : CONTEXT_FINDINGS[step.hook](output.context, context, step)),
		...output.policies.map((policy) => policyFinding(policy, context)),
	];
}

const TRANSCRIPT_SHA256 = createHash("sha256").update(TRANSCRIPT).digest("hex");

/**
 * The transcript copies after a run: each new copy by its trigger, the
 * number of files, and the old backups that the run removed. An old backup
 * has a number, and 0 is the oldest. The name of a new copy holds the time
 * of the run, so only its trigger and its bytes count.
 */
function sessionLogFindings(run: StepRun, scenario: Scenario): Found[] {
	const copies = new Map<string, number>();
	for (const log of run.sessionLogs) {
		if (log.sha256 !== TRANSCRIPT_SHA256) continue;
		const trigger = /^session_(.+)_\d{8}_\d{6}\.jsonl$/.exec(log.name)?.[1] ?? log.name;
		copies.set(trigger, (copies.get(trigger) ?? 0) + 1);
	}
	const kept = new Set(run.sessionLogs.map(({ name }) => name));
	const old = Array.from({ length: scenario.oldSessionLogs ?? 0 }, (_, index) => index);
	const removed = old.filter((index) => !kept.has(oldSessionLogName(index)));
	return [
		...[...copies].map(([trigger, count]) => found("PC-03", { detail: trigger, count })),
		found("PC-04", { count: run.sessionLogs.length }),
		...(old.length === 0 ? [] : [found("PC-04", { detail: `old backups removed: ${removed.join(", ") || "none"}`, count: removed.length })]),
	];
}

/** Each line that a run added to the environment file of the session. */
const envFileFindings = (run: StepRun, context: Context): Found[] =>
	filled(run.envFileAdded.split("\n")).map((line) =>
		found("SS-02", { detail: context.paths.reduce((text, [path, name]) => text.replaceAll(path, name), line) }),
	);

/** A directory under both of its names, because the temporary directory can be a link. */
function bothNames(path: string): string[] {
	try {
		const real = realpathSync(path);
		return real === path ? [path] : [real, path];
	} catch {
		return [path];
	}
}

export function findingsOf(scenarioRun: ScenarioRun, spec: FixtureSpec): Finding[] {
	const { projectDir } = scenarioRun.environment;
	const paths = [
		...(projectDir === "" ? [] : bothNames(projectDir).map((path) => [path, "{project directory}"] as const)),
		...(scenarioRun.home === "" ? [] : bothNames(scenarioRun.home).map((path) => [path, "~"] as const)),
	];
	const context: Context = { environment: scenarioRun.environment, spec, home: scenarioRun.home, paths };
	const stepOfKey = new Map<string, number>();
	return scenarioRun.runs.flatMap((run, step) => {
		const stepInput = scenarioRun.scenario.steps[step]!;
		const output = outputOf(run.stdout);
		const row = channelRow(stepInput, output);
		const exit = run.exitCode === 0 ? "" : ` (exit ${run.exitCode})`;
		const stderr = run.stderr.trim();
		const firstStepOf = (key: string): number => {
			if (!stepOfKey.has(key)) stepOfKey.set(key, step);
			return stepOfKey.get(key)!;
		};
		const all = [
			found(row, { detail: channelOf(output) + exit }),
			...(stderr === "" ? [] : [found(row, { detail: `stderr: ${stderr.slice(0, 120)}` })]),
			...(isString(output) ? [] : contentFindings(stepInput, output, firstStepOf, context)),
			...(stepInput.hook === "pre-compact" ? sessionLogFindings(run, scenarioRun.scenario) : []),
			...envFileFindings(run, context),
		];
		return all.map((finding): Finding => ({ ...finding, step }));
	});
}

/** The findings of each scenario of one form, by scenario ID. */
export type Pass = ReadonlyMap<string, readonly Finding[]>;

export const passOf = (runs: readonly ScenarioRun[], spec: FixtureSpec): Pass =>
	new Map(runs.map((run) => [run.scenario.id, findingsOf(run, spec)] as const));
