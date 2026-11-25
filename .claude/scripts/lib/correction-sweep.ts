/**
 * The correction sweep: the judgement half.
 *
 * `AGENTS.md` Law 2 says that when a fact is corrected, each restatement is
 * fixed in the same pass. Finding candidates is the easy half. The dangerous
 * half is deciding what may be edited, because the three classes need
 * opposite treatment:
 *
 *   AUTHORITATIVE  the single-source page that Law 1 names. The correction is
 *                  applied here. Exactly one page is rewritten.
 *   RESTATEMENT    a living page that asserts the fact and should link to the
 *                  source. The assertion becomes a link.
 *   HISTORICAL     a page that records what was believed at the time.
 *                  Rewriting it destroys a true record, and nothing can detect
 *                  that afterwards, because the page still reads fine.
 *
 * Two rules are decided on purpose:
 *
 * 1. Historical is keyed on the type, the title, and the status together.
 *    Any one of them is enough. They overlap by design: the type catches a
 *    row that nobody dated, and the dated title catches a row with the wrong type.
 * 2. A historical page is never edited. It is reported and preserved. A missed
 *    restatement is a stale claim that someone fixes later. A rewritten record
 *    is a true thing destroyed.
 *
 * The prose of `.claude/commands/om-correct.md` and
 * `.claude/agents/correction-sweep.md` states the same rule, and a test fails
 * when the two differ. Everything here is pure. The search and the page edits
 * are in the command and its agent.
 */

import { notionId } from "./notion-parse.ts";

/** What may be done to a page that carries the corrected fact. */
export type NoteClass = "AUTHORITATIVE" | "RESTATEMENT" | "HISTORICAL";

/** A candidate that the search found. */
export interface SweepCandidate {
	/** The page URL or ID. It is the identity of the candidate. */
	readonly url: string;
	readonly title: string;
	/** `Work.Type` or `Knowledge.Type`. Other databases have no type that counts. */
	readonly type?: string;
	/** `Work.Status`. */
	readonly status?: unknown;
}

/**
 * The types of the rows that record a moment by construction. A 1:1, an inbox
 * item, a thinking note, and an incident are dated captures. An event-log
 * satellite and an archive note are the bulk that a split moved out of a living row.
 */
export const HISTORICAL_TYPES = new Set(["1:1", "Inbox item", "Thinking", "Incident", "Event-log satellite", "Archive note"]);

/**
 * The `Work.Status` values that mark a row as a closed record. `completed` is
 * on the list on purpose. Finished work describes what was done, and editing it
 * to agree with the present falsifies the record.
 */
export const HISTORICAL_STATUS = new Set(["archived", "completed", "deprecated"]);

/** A date anywhere in the title, not only at the start. */
const DATE_IN_TITLE = /\d{4}-\d{2}-\d{2}/;

const norm = (value: string): string => value.trim().toLowerCase();
const inSet = (set: ReadonlySet<string>, value: unknown): boolean => typeof value === "string" && [...set].some((member) => norm(member) === norm(value));

/**
 * Does this page record a moment rather than assert a present fact?
 *
 * The `Date` property is NOT a signal. Each row has one, so reading it as
 * evidence would make every page historical and the sweep a costly no-op.
 */
export function isHistoricalNote(candidate: Pick<SweepCandidate, "title" | "type" | "status">): boolean {
	if (inSet(HISTORICAL_TYPES, candidate.type)) return true;
	if (DATE_IN_TITLE.test(candidate.title)) return true;
	return inSet(HISTORICAL_STATUS, candidate.status);
}

const sameRow = (a: string, b: string): boolean => {
	const id = (value: string): string => {
		try {
			return notionId(value);
		} catch {
			return value.trim().toLowerCase();
		}
	};
	return id(a) === id(b);
};

/**
 * Classify one candidate.
 *
 * The authoritative page is passed in, because nothing in Notion can decide
 * which of two contradicting pages is true. Only the person who corrects the
 * fact knows.
 *
 * HISTORICAL is checked BEFORE authoritative on purpose. If the single-source
 * page was archived, the correction belongs in the page that replaced it.
 */
export function classifyCandidate(candidate: SweepCandidate, authoritativeUrl: string | null): NoteClass {
	if (isHistoricalNote(candidate)) return "HISTORICAL";
	if (authoritativeUrl && sameRow(candidate.url, authoritativeUrl)) return "AUTHORITATIVE";
	return "RESTATEMENT";
}

export interface SweepPlan {
	/** The one page whose claim is rewritten. */
	readonly apply: SweepCandidate | null;
	/** Living pages whose restatement becomes a link to the source. */
	readonly replaceWithLink: SweepCandidate[];
	/** Records left as they are, reported so that the omission is visible. */
	readonly preserve: SweepCandidate[];
	/**
	 * Candidates that would have been edited if the authoritative page were
	 * named. A link to a source that nobody corrected spreads the stale claim
	 * behind a link, so these stay apart from `replaceWithLink`.
	 */
	readonly blocked: SweepCandidate[];
}

/**
 * Turn classified candidates into what the command does. It plans no edit
 * when no authoritative page is named. Law 1 puts the fact in one place, and
 * without that place a link has nowhere correct to point.
 */
export function planSweep(candidates: readonly SweepCandidate[], authoritativeUrl: string | null): SweepPlan {
	const apply: SweepCandidate[] = [];
	const replaceWithLink: SweepCandidate[] = [];
	const preserve: SweepCandidate[] = [];

	for (const candidate of candidates) {
		const klass = classifyCandidate(candidate, authoritativeUrl);
		if (klass === "HISTORICAL") preserve.push(candidate);
		else if (klass === "AUTHORITATIVE") apply.push(candidate);
		else replaceWithLink.push(candidate);
	}

	if (!authoritativeUrl || apply.length === 0) {
		return { apply: null, replaceWithLink: [], preserve, blocked: replaceWithLink };
	}
	return { apply: apply[0] ?? null, replaceWithLink, preserve, blocked: [] };
}
