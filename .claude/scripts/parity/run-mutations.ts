/**
 * Runs each mutation of `mutations.ts` and prints the rows that the harness
 * reports for it. The exit code is 1 when a mutation gives different rows
 * from the rows that it names. A mutation with a `notSeen` reason is a
 * known hole, and it must give no row.
 *
 * With `--notion`, each mutation of the scenarios of one hook is an edit of
 * the hooks of this repository (`port-mutations.ts`), and the mutated copy
 * runs on the Notion form.
 *
 * Usage: node --experimental-strip-types parity/run-mutations.ts [--lines] [--notion --hook <name> [--now <instant>] [--map <path>]]
 */

import { MUTATIONS, runMutations } from "./mutations.ts";
import { notionRun } from "./notion-run.ts";
import { portMutations } from "./port-mutations.ts";

const { run: notion, rest } = await notionRun(process.argv.slice(2));
const unknown = rest.filter((name) => name !== "--lines");
if (unknown.length > 0) throw new Error(`Unknown option: ${unknown.join(" ")}. Read the header of run-mutations.ts for the options.`);

const withLines = rest.includes("--lines");
const results = notion === null ? runMutations(MUTATIONS) : runMutations(portMutations(notion.hook), { scriptsDir: notion.scriptsDir, form: notion.form });
let holes = 0;

console.log("| ID | Mutation | Differences | Rows | Result |");
console.log("|---|---|---|---|---|");
for (const { mutation, rows, lines } of results) {
	const asNamed = rows.join(" ") === [...mutation.rows].sort().join(" ");
	if (!asNamed) holes++;
	const result = !asNamed ? `expected ${mutation.rows.join(", ") || "none"}` : mutation.notSeen === undefined ? "seen" : `not seen. ${mutation.notSeen}`;
	console.log(`| ${mutation.id} | ${mutation.change} | ${lines.length} | ${rows.join(", ") || "none"} | ${result} |`);
}
if (withLines) {
	for (const { mutation, lines } of results) {
		console.log(`\n${mutation.id}`);
		for (const line of lines) console.log(`  ${line}`);
	}
}
if (notion !== null) console.log(`\n${await notion.restore()}`);
process.exit(holes === 0 ? 0 : 1);
