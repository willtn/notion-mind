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
	readonly kind: "only in the original" | "only in the port" | "count differs" | "size differs";
	readonly original: Finding | null;
	readonly port: Finding | null;
};

export type Comparison = {
	/** The zero-difference gate reads this list. */
	readonly differences: readonly Difference[];
	/** Differences inside a tolerance that part (d) states. */
	readonly tolerated: readonly Difference[];
	/** Findings of a row that part (d) marks "not applicable". The comparison ignores them. */
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

function pairDifference(original: Finding, port: Finding, rule: RowRule): Difference["kind"] | null {
	if (original.count !== port.count) return "count differs";
	if (original.sizeKb === port.sizeKb) return null;
	if (rule.rule !== "size-tolerance" || original.sizeKb === undefined || port.sizeKb === undefined) return "size differs";
	const gap = Math.abs(original.sizeKb - port.sizeKb);
	return gap * 100 <= rule.percent * Math.max(original.sizeKb, port.sizeKb) ? null : "size differs";
}

const loneIsTolerated = (finding: Finding, rule: RowRule, nearSizeLimit: ReadonlySet<string>): boolean =>
	rule.rule === "size-tolerance" &&
	finding.note !== null &&
	nearSizeLimit.has(finding.note) &&
	finding.sizeKb !== undefined &&
	finding.sizeKb * 100 <= rule.limitKb * (100 + rule.percent);

export function compareFindings(
	scenario: string,
	original: readonly Finding[],
	port: readonly Finding[],
	spec: FixtureSpec,
): Comparison {
	const nearSizeLimit = new Set(spec.notes.filter((note) => note.nearSizeLimit).map((note) => note.title));
	const applies = (finding: Finding): boolean => ruleOf(finding).rule !== "not-applicable";
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
			const rule = ruleOf(one);
			if (a !== null && b !== null) {
				const kind = pairDifference(a, b, rule);
				if (kind !== null) differences.push({ scenario, row: one.row, kind, original: a, port: b });
				continue;
			}
			const difference: Difference = {
				scenario,
				row: one.row,
				kind: a !== null ? "only in the original" : "only in the port",
				original: a,
				port: b,
			};
			(loneIsTolerated(one, rule, nearSizeLimit) ? tolerated : differences).push(difference);
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

const describe = (finding: Finding | null): string => {
	if (finding === null) return "none";
	const parts = [
		finding.note === null ? null : `note "${finding.note}"`,
		finding.detail === null ? null : `detail "${finding.detail}"`,
		finding.count === null ? null : `count ${finding.count}`,
		finding.sizeKb === undefined ? null : `${finding.sizeKb}KB`,
	].filter((part) => part !== null);
	return parts.length === 0 ? "present" : parts.join(", ");
};

/** One line for each difference, with the row ID first. */
export const formatDifference = (d: Difference): string =>
	`${d.row} ${d.scenario} step ${(d.original ?? d.port)!.step}: ${d.kind}. original: ${describe(d.original)}. port: ${describe(d.port)}.`;
