/**
 * The mutations of `mutations.ts` for the hooks of the port. A mutation of
 * the reference hooks names text of the hooks at `fae7be4`. The port holds
 * the same rule, sometimes in a different file or in different words, so
 * this table gives the edit of the port for each such mutation. A mutation
 * with no entry here applies to the port with the edits that it has.
 *
 * The harness compares the reference hooks on the Markdown form with a
 * mutated copy of the port on its own form. The mutation must give the
 * rows that it gives on the Markdown form.
 */

import { FIXTURE } from "./fixture.ts";
import { MUTATIONS, type Edit, type Mutation } from "./mutations.ts";
import type { Finding, FixtureSpec, HookName } from "./spec.ts";

type PortChange = {
	readonly edits?: readonly Edit[];
	/** The change in the words of the port, when the port has no object of the reference change. */
	readonly change?: string;
	/** The rows of the port run, when the reference mutation also names rows of a hook that the run leaves out. */
	readonly rows?: readonly Finding["row"][];
};

const edit = (file: string, find: string, replace: string): PortChange => ({ edits: [{ file, find, replace }] });

const CHECK = "lib/write-check.ts";

const PORT_CHANGES: Readonly<Record<string, PortChange>> = {
	X6: { rows: ["VW-17"] },
	X3: edit(CHECK, 'policy_id: "organization-threshold"', 'policy_id: "organization-limit"'),
	X4: edit(CHECK, 'policy_id: "phantom-edge"', 'policy_id: "phantom-link"'),
	N19: edit(CHECK, "Fix these before moving on.", "Ignore these."),
	N18: edit("validate-write.ts", "- Patterns/conventions → the `Patterns` row of `Knowledge`", "- Patterns/conventions → the `Wrong` row of `Knowledge`"),
	G14: edit(CHECK, "suggested_target: TOPIC_GROUP,", 'suggested_target: "Trash",'),
	E7: edit(CHECK, "bytes >= MONOLITH_BYTES &&", "bytes > MONOLITH_BYTES &&"),
	E8: edit(CHECK, "bytes >= MONOLITH_BYTES &&", "bytes >= MONOLITH_BYTES - 1 &&"),
	E18: edit(CHECK, "text.length > 300 &&", "text.length > 301 &&"),
	E19: edit(CHECK, "text.length > 300 &&", "text.length > 299 &&"),
	Q02: edit("lib/notion-note.ts", '"Work note": { required: "work-note" },', '"Work note": { required: "team" },'),
	Q10: {
		...edit("lib/notion-note.ts", ".filter(({ property }) => valueOf(note.properties, property) === null);", '.filter(({ property }) => property !== "Date" && valueOf(note.properties, property) === null);'),
		change: "An empty `Date` counts as a value (VW-08). A row has no key that is not a property, so the port has no key with the end of a field name",
	},
	Q11: edit(CHECK, '!text.includes("[[") && !note.body.includes("<mention") && !hasRelation(note)', '!text.includes("[[Patterns]]")'),
	F03: edit(CHECK, "date: (property) => `The property \\`${property}\\` is empty`,", 'date: () => "Add a date",'),
};

/**
 * The mutations that change a scenario of `hook`, with the edits of the
 * port. Each one runs only on its scenarios of that hook.
 */
export function portMutations(hook: HookName, mutations: readonly Mutation[] = MUTATIONS, spec: FixtureSpec = FIXTURE): Mutation[] {
	const ofHook = new Set(spec.scenarios.filter(({ steps }) => steps.some((step) => step.hook === hook)).map(({ id }) => id));
	return mutations
		.filter(({ scenarios }) => scenarios.some((id) => ofHook.has(id)))
		.map((mutation): Mutation => {
			const port = PORT_CHANGES[mutation.id] ?? {};
			return {
				...mutation,
				change: port.change ?? mutation.change,
				edits: port.edits ?? mutation.edits,
				scenarios: mutation.scenarios.filter((id) => ofHook.has(id)),
				rows: port.rows ?? mutation.rows,
			};
		});
}
