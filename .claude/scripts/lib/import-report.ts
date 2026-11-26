/**
 * The report of an import as Markdown: where each note goes, each file
 * that stays out, and each construct that loses form with one example.
 *
 *     console.log(planReport(plan));
 *     console.log(lossReport(plan));
 */

import { LOSS_KINDS, type LossKind } from "./import-body.ts";
import type { ImportPlan, PlannedLoss } from "./import-plan.ts";
import { DATABASES } from "./notion-model.ts";

const cell = (text: string): string => text.replace(/\|/g, "\\|").replace(/\n/g, " ");
const table = (head: readonly string[], rows: readonly (readonly string[])[]): string =>
	[`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`)].join("\n");

const databaseTitle = (key: string): string => DATABASES.find((spec) => spec.key === key)?.title ?? key;

/** The place of each note, and each file that the import leaves out. */
export function planReport(plan: ImportPlan): string {
	const pages = plan.pages.map((page) => {
		const { destination } = page;
		if (destination.kind === "page") return [page.note.path, "(a page of the setup)", "", page.title, ""];
		if (destination.kind === "section") return [page.note.path, "(a page of the setup)", "", page.title, `the section "${destination.section}" only`];
		const how = destination.adopts !== undefined ? "the row of the setup" : destination.byDefault ? "by default: no rule names the folder" : "";
		return [page.note.path, databaseTitle(destination.database), String(page.values["Type"] ?? ""), page.title, how];
	});
	return [
		"## Pages",
		"",
		table(["Source path", "Database", "Type", "Title", "Note"], pages),
		"",
		"## Files that the import leaves out",
		"",
		plan.leftOut.length === 0 ? "None." : table(["File", "Reason"], plan.leftOut.map((file) => [file.path, file.reason])),
	].join("\n");
}

/** Each construct that loses form: how many times, in how many notes, what happens to it, and the first example. */
export function lossReport(plan: ImportPlan): string {
	const found = new Map<LossKind, { count: number; notes: Set<string>; first: PlannedLoss }>();
	for (const loss of plan.pages.flatMap((page) => page.losses)) {
		const entry = found.get(loss.kind) ?? { count: 0, notes: new Set<string>(), first: loss };
		entry.count++;
		entry.notes.add(loss.path);
		found.set(loss.kind, entry);
	}
	const rows = (Object.keys(LOSS_KINDS) as LossKind[]).flatMap((kind) => {
		const entry = found.get(kind);
		return entry === undefined ? [] : [[kind, String(entry.count), String(entry.notes.size), LOSS_KINDS[kind], `${entry.first.path}:${entry.first.line}: \`${entry.first.example}\``]];
	});
	return ["## Constructs that lose form", "", rows.length === 0 ? "None." : table(["Construct", "Times", "Notes", "What the import does", "First example"], rows)].join("\n");
}

/** One page of the plan beside the page that Notion holds. A cell is "same" or the difference. */
export interface PageCheck {
	readonly path: string;
	readonly cells: Readonly<Record<"title" | "database" | "type" | "properties" | "body" | "derived", string>>;
	readonly same: boolean;
}

/** The comparison of each planned page with the page that Notion holds. */
export function verifyReport(checks: readonly PageCheck[]): string {
	const rows = checks.map((check) => [check.path, check.cells.title, check.cells.database, check.cells.type, check.cells.properties, check.cells.body, check.cells.derived]);
	const different = checks.filter((check) => !check.same).length;
	return ["## Comparison of each note with its page", "", table(["Source path", "Title", "Database", "Type", "Properties", "Body", "Derived values"], rows), "", `pages compared ${checks.length}, pages with a difference ${different}`].join("\n");
}
