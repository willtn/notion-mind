/**
 * Runs each mutation of `mutations.ts` and prints the rows that the harness
 * reports for it. The exit code is 1 when a mutation gives different rows
 * from the rows that it names.
 *
 * Usage: node --experimental-strip-types parity/run-mutations.ts [--lines]
 */

import { runMutations } from "./mutations.ts";

const withLines = process.argv.includes("--lines");
const results = runMutations();
let holes = 0;

console.log("| ID | Mutation | Differences | Rows | Result |");
console.log("|---|---|---|---|---|");
for (const { mutation, rows, lines } of results) {
	const seen = rows.join(" ") === [...mutation.rows].sort().join(" ");
	if (!seen) holes++;
	console.log(`| ${mutation.id} | ${mutation.change} | ${lines.length} | ${rows.join(", ") || "none"} | ${seen ? "seen" : `expected ${mutation.rows.join(", ")}`} |`);
}
if (withLines) {
	for (const { mutation, lines } of results) {
		console.log(`\n${mutation.id}`);
		for (const line of lines) console.log(`  ${line}`);
	}
}
process.exit(holes === 0 ? 0 : 1);
