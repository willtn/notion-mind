/**
 * Compares the findings of two forms for one scenario, with the rule that
 * part (d) of `NOTION-PORT-DESIGN.md` gives each row.
 */

import type { Pass } from "./findings.ts";
import { ROWS, type RowRule } from "./rows.ts";
import type { Finding, FixtureSpec } from "./spec.ts";

export type Difference = {
	readonly scenario: string;
	readonly row: Finding["row"];
	readonly kind: "only in the original" | "only in the port" | "count differs" | "text differs" | "size differs";
	readonly original: Finding | null;
	readonly port: Finding | null;
};

export type Comparison = {
	/** The zero-difference gate reads this list. */
	readonly differences: readonly Difference[];
	/** Differences inside a tolerance that part (d) states. The summary of a run lists each one. */
	readonly tolerated: readonly Difference[];
	/**
	 * Findings of a row that part (d) marks "not applicable", and findings
	 * of a note in a state that only the Markdown form can hold. The
	 * comparison ignores them.
	 */
	readonly notApplicable: readonly NotApplicable[];
};

export type NotApplicable = {
	readonly scenario: string;
	readonly form: "original" | "port";
	readonly finding: Finding;
};

const EQUAL: RowRule = { rule: "equal" };

const ruleOf = (finding: Finding): RowRule => (finding.row === "UNMAPPED" ? EQUAL : ROWS[finding.row]);

const identity = (finding: Finding): string => JSON.stringify([finding.row, finding.step, finding.note, finding.detail]);

function byIdentity(findings: readonly Finding[]): Map<string, Finding[]> {
	const groups = new Map<string, Finding[]>();
	for (const finding of findings) {
		const key = identity(finding);
		groups.set(key, [...(groups.get(key) ?? []), finding]);
	}
	return groups;
}

type Tolerance = Extract<RowRule, { rule: "size-tolerance" }>;

/** The tolerance of the row, for the near-limit note only. Part (d) puts only that note outside the gate. */
const toleranceOf = (finding: Finding, rule: RowRule, nearSizeLimit: ReadonlySet<string>): Tolerance | null =>
	rule.rule === "size-tolerance" && finding.note !== null && nearSizeLimit.has(finding.note) ? rule : null;

function pairDifference(original: Finding, port: Finding, tolerance: Tolerance | null): { kind: Difference["kind"]; tolerated: boolean } | null {
	if (original.count !== port.count) return { kind: "count differs", tolerated: false };
	if (original.text !== port.text) return { kind: "text differs", tolerated: false };
	if (original.sizeKb === port.sizeKb) return null;
	if (tolerance === null || original.sizeKb === undefined || port.sizeKb === undefined) return { kind: "size differs", tolerated: false };
	const gap = Math.abs(original.sizeKb - port.sizeKb);
	return { kind: "size differs", tolerated: gap * 100 <= tolerance.percent * Math.max(original.sizeKb, port.sizeKb) };
}

/** A finding with no size is the policy result of the same note, so it follows the finding with the size. */
const loneIsTolerated = (finding: Finding, tolerance: Tolerance | null): boolean =>
	tolerance !== null && (finding.sizeKb === undefined || finding.sizeKb * 100 <= tolerance.limitKb * (100 + tolerance.percent));

export function compareFindings(
	scenario: string,
	original: readonly Finding[],
	port: readonly Finding[],
	spec: FixtureSpec,
): Comparison {
	const nearSizeLimit = new Set(spec.notes.filter((note) => note.nearSizeLimit).map((note) => note.title));
	const markdownOnly = new Set(spec.notes.filter((note) => note.markdownFolder !== undefined).map((note) => note.title));
	const applies = (finding: Finding): boolean =>
		ruleOf(finding).rule !== "not-applicable" && !(finding.note !== null && markdownOnly.has(finding.note));
	const ignored = (form: NotApplicable["form"], findings: readonly Finding[]): NotApplicable[] =>
		findings.filter((finding) => !applies(finding)).map((finding) => ({ scenario, form, finding }));

	const differences: Difference[] = [];
	const tolerated: Difference[] = [];
	const originals = byIdentity(original.filter(applies));
	const ports = byIdentity(port.filter(applies));
	for (const key of new Set([...originals.keys(), ...ports.keys()])) {
		const left = originals.get(key) ?? [];
		const right = ports.get(key) ?? [];
		for (let i = 0; i < Math.max(left.length, right.length); i++) {
			const a = left[i] ?? null;
			const b = right[i] ?? null;
			const one = (a ?? b)!;
			const tolerance = toleranceOf(one, ruleOf(one), nearSizeLimit);
			if (a !== null && b !== null) {
				const pair = pairDifference(a, b, tolerance);
				if (pair !== null) (pair.tolerated ? tolerated : differences).push({ scenario, row: one.row, kind: pair.kind, original: a, port: b });
				continue;
			}
			const difference: Difference = {
				scenario,
				row: one.row,
				kind: a !== null ? "only in the original" : "only in the port",
				original: a,
				port: b,
			};
			(loneIsTolerated(one, tolerance) ? tolerated : differences).push(difference);
		}
	}
	return { differences, tolerated, notApplicable: [...ignored("original", original), ...ignored("port", port)] };
}

export function comparePasses(original: Pass, port: Pass, spec: FixtureSpec): Comparison {
	const each = spec.scenarios.map(({ id }) => compareFindings(id, original.get(id) ?? [], port.get(id) ?? [], spec));
	return {
		differences: each.flatMap((c) => c.differences),
		tolerated: each.flatMap((c) => c.tolerated),
		notApplicable: each.flatMap((c) => c.notApplicable),
	};
}

const TEXT_WINDOW = 100;

/** The part of `text` around `from`, the first place where two texts differ. */
const windowOf = (text: string, from: number): string =>
	JSON.stringify(`${from > 20 ? "…" : ""}${text.slice(Math.max(0, from - 20), from + TEXT_WINDOW)}`);

const describe = (finding: Finding | null, textFrom: number | null): string => {
	if (finding === null) return "none";
	const parts = [
		finding.note === null ? null : `note "${finding.note}"`,
		finding.detail === null ? null : `detail "${finding.detail}"`,
		finding.count === null ? null : `count ${finding.count}`,
		finding.sizeKb === undefined ? null : `${finding.sizeKb}KB`,
		textFrom === null ? null : finding.text === undefined ? "no text" : `text ${windowOf(finding.text, textFrom)}`,
	].filter((part) => part !== null);
	return parts.length === 0 ? "present" : parts.join(", ");
};

function firstDifference(a: string, b: string): number {
	let at = 0;
	while (at < a.length && at < b.length && a[at] === b[at]) at++;
	return at;
}

/** One line for each difference, with the row ID first. A text difference shows the place where the two texts start to differ. */
export function formatDifference(d: Difference): string {
	const textFrom = d.kind === "text differs" ? firstDifference(d.original?.text ?? "", d.port?.text ?? "") : null;
	return `${d.row} ${d.scenario} step ${(d.original ?? d.port)!.step}: ${d.kind}. original: ${describe(d.original, textFrom)}. port: ${describe(d.port, textFrom)}.`;
}
