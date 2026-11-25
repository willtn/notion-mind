/**
 * The hook rows that the parity harness compares. The IDs come from the hook
 * inventory at `fae7be4`. The rules come from part (d) of
 * `NOTION-PORT-DESIGN.md`.
 */

export type RowRule =
	/** The two forms must give the same finding. */
	| { readonly rule: "equal" }
	/** Part (d) says that the Notion form has no such finding. */
	| { readonly rule: "not-applicable"; readonly reason: string }
	/**
	 * The finding states a size that the two forms measure in different
	 * ways. The rule applies only to the note that the fixture marks
	 * `nearSizeLimit`. For that note, two sizes are equal inside `percent`,
	 * and the finding can be in one form only when its size is at most
	 * `percent` above `limitKb`. For each other note the sizes must be equal.
	 */
	| { readonly rule: "size-tolerance"; readonly percent: number; readonly limitKb: number };

const equal: RowRule = { rule: "equal" };

export const ROWS = {
	"VW-03": equal,
	"VW-07": equal,
	"VW-08": equal,
	"VW-09": equal,
	"VW-10": equal,
	"VW-11": equal,
	"VW-12": equal,
	"VW-14": { rule: "size-tolerance", percent: 10, limitKb: 25 },
	"VW-15": equal,
	// Part (d) has no row for the envelope. The harness reads the exit code
	// and the output channel of each run under the inventory row for it.
	"VW-17": equal,

	"SS-10": equal,
	"SS-11": equal,
	"SS-12": equal,
	"SS-13": {
		rule: "not-applicable",
		reason: "The Notion form has no commit subjects (part d.2, choice 2).",
	},
	"SS-14": equal,
	"SS-15": equal,
	"SS-16": equal,
	"SS-17": equal,
	"SS-19": equal,

	"HY-01": {
		rule: "not-applicable",
		reason: "`Status` is the only place for state in Notion, so no folder can disagree with it (part d.3, choice 2).",
	},
	"HY-02": equal,
	"HY-03": equal,
	"HY-04": equal,
	"HY-05": equal,
	"HY-07": equal,
	"HY-09": equal,

	"UP-01": equal,
	"UP-02": equal,
	"UP-03": equal,
	"UP-04": equal,
	"UP-05": equal,
	"UP-06": equal,
	"UP-07": equal,
	"UP-08": equal,
	"UP-09": equal,
	"UP-10": equal,
	"UP-11": equal,
	"UP-12": equal,
	"UP-14": equal,

	"PC-01": equal,
	"PC-03": equal,
	"PC-04": equal,

	"ST-01": equal,
	"ST-02": equal,
	"ST-03": equal,
	"ST-04": equal,
	"ST-05": equal,
	"ST-06": equal,
	"ST-07": equal,
	"ST-08": equal,
	"ST-09": equal,
	"ST-10": equal,
	"ST-11": equal,
} as const satisfies Record<string, RowRule>;

export type RowId = keyof typeof ROWS;
