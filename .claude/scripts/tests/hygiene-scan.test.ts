/**
 * The hygiene scan of the Notion workspace (lib/hygiene-scan.ts): the rule
 * of each finding on the rows of its view, the calls that the scan makes,
 * and the lines of the report. The `call` of each test is a table of rows
 * by view. The parity run on the real workspace is the live proof.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatHygiene, HYGIENE_VOLATILE_FIELDS, hygieneClaims, hygieneNotRead, scanHygiene, type HygieneReport } from "../lib/hygiene-scan.ts";
import type { NotionClient } from "../lib/notion-client.ts";
import type { DatabaseKey } from "../lib/notion-model.ts";
import { reportKey } from "../lib/report-key.ts";
import { fakeMap } from "./_fake-notion.ts";
import { rmTemp } from "./_helpers.ts";

type Row = Readonly<Record<string, unknown>>;

const NOW = Date.parse("2026-11-26T12:00:00Z");
const DAY = 86_400_000;
const WATCHED = ["1:1", "Inbox item", "Incident"];
const { map } = fakeMap();

let TMP = "";
let EMPTY_PROJECT = "";
before(() => {
	TMP = mkdtempSync(join(tmpdir(), "hygiene-scan-"));
	EMPTY_PROJECT = join(TMP, "empty");
	mkdirSync(EMPTY_PROJECT);
});
after(() => rmTemp(TMP));

const changed = (daysAgo: number, minutes = 0): string => new Date(NOW - daysAgo * DAY - minutes * 60_000).toISOString();
const sized = (Name: string, Bytes: number): Row => ({ Name, Bytes, Type: "Reference" });
const loop = (Name: string, Type: string, daysAgo: number, openLoops = 1): Row => ({ Name, Type, "Open loops": openLoops, "date:Changed:start": changed(daysAgo) });
const inbox = (Name: string, daysAgo: number): Row => ({ Name, Type: "Inbox item", "date:Changed:start": changed(daysAgo) });

type Views = Readonly<Partial<Record<DatabaseKey, Readonly<Record<string, readonly Row[] | Error>>>>>;

/** A `call` that answers each view query with the rows of `views`, 100 rows on a page, and keeps the name of each view that it gets. */
function notion(views: Views): { readonly call: NotionClient["call"]; readonly queried: string[] } {
	const byUrl = new Map<string, { readonly name: string; readonly rows: readonly Row[] | Error }>();
	for (const key of Object.keys(map.databases) as DatabaseKey[]) {
		for (const [view, url] of Object.entries(map.databases[key].views)) byUrl.set(url, { name: `${key} / ${view}`, rows: views[key]?.[view] ?? [] });
	}
	const queried: string[] = [];
	const call: NotionClient["call"] = async (tool, args = {}) => {
		assert.equal(tool, "notion-query-data-sources");
		const data = args["data"] as { readonly mode: string; readonly view_url: string; readonly page_size: number; readonly start_cursor?: string };
		assert.equal(data.mode, "view");
		const view = byUrl.get(data.view_url);
		assert.ok(view !== undefined, `the map file has no view ${data.view_url}`);
		queried.push(view.name);
		if (view.rows instanceof Error) throw view.rows;
		const from = Number(data.start_cursor ?? 0);
		const results = view.rows.slice(from, from + data.page_size);
		const next = from + data.page_size;
		const json = { results, has_more: next < view.rows.length, next_cursor: String(next) };
		return { text: JSON.stringify(json), json };
	};
	return { call, queried };
}

const scan = (views: Views, watchedTypes: readonly string[] = WATCHED, projectDir = EMPTY_PROJECT): Promise<HygieneReport> =>
	scanHygiene({ call: notion(views).call, map, projectDir, nowMs: NOW, watchedTypes });

describe("HY-03: the rows past the size limit", () => {
	test("a row counts from 25,000 bytes, with its size in KB to the nearest KB, the largest first", async () => {
		const report = await scan({
			knowledge: { "Hygiene: oversized": [sized("At Limit", 25_000), sized("Runbook", 26_600), sized("Below Limit", 24_999)] },
			work: { "Hygiene: oversized": [sized("Workshop Export", 26_400)] },
		});
		assert.deepEqual(report.oversizedNotes, [
			{ title: "Runbook", sizeKb: 27 },
			{ title: "Workshop Export", sizeKb: 26 },
			{ title: "At Limit", sizeKb: 25 },
		]);
	});

	test("a row with Archive in its name does not count, and a row with no size does not count", async () => {
		const report = await scan({ knowledge: { "Hygiene: oversized": [sized("Runbook Archive", 30_000), { Name: "No Size" }, sized("Runbook", 30_000)] } });
		assert.deepEqual(report.oversizedNotes, [{ title: "Runbook", sizeKb: 30 }]);
	});

	test("the scan reads the view of each note database and not the view of the Templates database", async () => {
		const { call, queried } = notion({ templates: { "Hygiene: oversized": [sized("Work Note", 26_000)] } });
		const report = await scanHygiene({ call, map, projectDir: EMPTY_PROJECT, nowMs: NOW, watchedTypes: WATCHED });
		assert.deepEqual(report.oversizedNotes, []);
		assert.deepEqual(queried.filter((name) => name.endsWith("Hygiene: oversized")).sort(), ["competencies", "knowledge", "people", "perf_docs", "teams", "work"].map((key) => `${key} / Hygiene: oversized`));
	});
});

describe("HY-04: the open loops", () => {
	test("a row counts from 14 days, with its age in whole days and its open items", async () => {
		const report = await scan({ work: { "Hygiene: open loops": [loop("At Limit", "Incident", 14), loop("Below Limit", "Incident", 13, 3), { ...loop("Old", "Inbox item", 21, 2), "date:Changed:start": changed(21, 90) }] } });
		assert.deepEqual(report.openLoops, [
			{ title: "Old", ageDays: 21, openItems: 2 },
			{ title: "At Limit", ageDays: 14, openItems: 1 },
		]);
	});

	test("the list has the 5 oldest rows, the oldest first", async () => {
		const rows = [20, 70, 30, 60, 40, 50].map((days) => loop(`Incident ${days}`, "Incident", days));
		const report = await scan({ work: { "Hygiene: open loops": rows } });
		assert.deepEqual(report.openLoops.map(({ title }) => title), ["Incident 70", "Incident 60", "Incident 50", "Incident 40", "Incident 30"]);
	});

	test("only a row of a watched type counts", async () => {
		const rows = [loop("Vendor Review", "Work note", 30), loop("Checkout Outage", "Incident", 30), { Name: "No Type", "Open loops": 1, "date:Changed:start": changed(30) }];
		assert.deepEqual((await scan({ work: { "Hygiene: open loops": rows } })).openLoops.map(({ title }) => title), ["Checkout Outage"]);
		assert.deepEqual((await scan({ work: { "Hygiene: open loops": rows } }, ["Work note"])).openLoops.map(({ title }) => title), ["Vendor Review"]);
	});

	test("a row with Archive in its name does not count, and a row with no open item does not count", async () => {
		const rows = [loop("Outage Log Archive", "Incident", 40), loop("No Items", "Incident", 40, 0), loop("Payments Latency", "Incident", 45)];
		assert.deepEqual((await scan({ work: { "Hygiene: open loops": rows } })).openLoops.map(({ title }) => title), ["Payments Latency"]);
	});

	test("only the latest 1:1 row of a person counts", async () => {
		const history = ["Ada Park 2026-02-07", "Ben Ortiz 2026-03-01", "Ben Ortiz 2026-01-15", "Ada Park 2026-01-10"].map((Name) => ({ Name, Type: "1:1" }));
		const report = await scan({
			work: {
				// Ben has a later 1:1 that is not old, so the view does not return it and his old row does not count.
				"Hygiene: open loops": [loop("Ada Park 2026-01-10", "1:1", 60), loop("Ada Park 2026-02-07", "1:1", 14, 2), loop("Ben Ortiz 2026-01-15", "1:1", 50)],
				"1:1 History": history,
			},
		});
		assert.deepEqual(report.openLoops, [{ title: "Ada Park 2026-02-07", ageDays: 14, openItems: 2 }]);
	});

	test("a 1:1 row with a title that names no person and date does not count", async () => {
		const report = await scan({ work: { "Hygiene: open loops": [loop("Weekly sync", "1:1", 30)], "1:1 History": [{ Name: "Weekly sync", Type: "1:1" }] } });
		assert.deepEqual(report.openLoops, []);
	});

	test("the scan reads the 1:1 rows only when an old 1:1 row has open loops, and only when 1:1 is a watched type", async () => {
		const none = notion({ work: { "Hygiene: open loops": [loop("Checkout Outage", "Incident", 30)] } });
		await scanHygiene({ call: none.call, map, projectDir: EMPTY_PROJECT, nowMs: NOW, watchedTypes: WATCHED });
		assert.equal(none.queried.includes("work / 1:1 History"), false);

		const views: Views = { work: { "Hygiene: open loops": [loop("Ada Park 2026-02-07", "1:1", 30)], "1:1 History": [{ Name: "Ada Park 2026-02-07", Type: "1:1" }] } };
		const some = notion(views);
		await scanHygiene({ call: some.call, map, projectDir: EMPTY_PROJECT, nowMs: NOW, watchedTypes: WATCHED });
		assert.equal(some.queried.filter((name) => name === "work / 1:1 History").length, 1);

		const notWatched = notion(views);
		const report = await scanHygiene({ call: notWatched.call, map, projectDir: EMPTY_PROJECT, nowMs: NOW, watchedTypes: ["Incident"] });
		assert.equal(notWatched.queried.includes("work / 1:1 History"), false);
		assert.deepEqual(report.openLoops, []);
	});

	test("the read of the 1:1 rows stops after the page that has a row of each person with an old 1:1", async () => {
		const others = Array.from({ length: 250 }, (_, index) => ({ Name: `Person ${index} 2026-01-01`, Type: "1:1" }));
		const history = [...others.slice(0, 120), { Name: "Ada Park 2026-03-01", Type: "1:1" }, ...others.slice(120), { Name: "Ada Park 2026-01-10", Type: "1:1" }];
		const { call, queried } = notion({ work: { "Hygiene: open loops": [loop("Ada Park 2026-01-10", "1:1", 60)], "1:1 History": history } });
		const report = await scanHygiene({ call, map, projectDir: EMPTY_PROJECT, nowMs: NOW, watchedTypes: WATCHED });
		assert.equal(queried.filter((name) => name === "work / 1:1 History").length, 2, "the second page has the later row of the person");
		assert.deepEqual(report.openLoops, []);
	});

	test("a view with more than 100 rows is read to its last page", async () => {
		const rows = Array.from({ length: 230 }, (_, index) => loop(`Incident ${index}`, "Incident", 20 + index));
		const { call, queried } = notion({ work: { "Hygiene: open loops": rows } });
		const report = await scanHygiene({ call, map, projectDir: EMPTY_PROJECT, nowMs: NOW, watchedTypes: WATCHED });
		assert.equal(queried.filter((name) => name === "work / Hygiene: open loops").length, 3);
		assert.equal(report.openLoops[0]?.title, "Incident 229");
	});
});

describe("HY-05: the inbox items", () => {
	test("an item counts from 7 days, and the report has the count and the age of the oldest", async () => {
		const report = await scan({ work: { "Hygiene: inbox pressure": [inbox("At Limit", 7), inbox("Below Limit", 6), inbox("Planning Export", 21), inbox("Vendor Sync Export", 10)] } });
		assert.deepEqual(report.inboxPressure, { count: 3, oldestDays: 21 });
	});

	test("no old item gives no finding", async () => {
		assert.equal((await scan({ work: { "Hygiene: inbox pressure": [inbox("New", 2)] } })).inboxPressure, null);
	});
});

describe("HY-02: the topic clusters", () => {
	test("the titles of the loose active view give the clusters", async () => {
		const titles = ["Billing Export Pipeline", "Billing Retry Design", "Search Ranking Tuning", "Login Latency Budget", "Cache Warmup Steps"];
		const report = await scan({ work: { "Hygiene: loose active": titles.map((Name) => ({ Name })) } });
		assert.deepEqual(report.ungroupedClusters, [{ token: "billing", files: ["Billing Export Pipeline", "Billing Retry Design"] }]);
	});
});

describe("HY-07 and HY-09: the instruction files of the project directory", () => {
	test("the scan gives the findings of the local files with the findings of the views", async () => {
		const project = join(TMP, "with-files");
		mkdirSync(project);
		writeFileSync(join(project, "AGENTS.md"), "x".repeat(23_000));
		writeFileSync(join(project, "CLAUDE.md"), "Read AGENTS.md.\n");
		const report = await scan({}, WATCHED, project);
		assert.deepEqual(report.leftoverInstructionFiles, ["CLAUDE.md"]);
		assert.deepEqual(report.agentsMd, { sizeKb: 23 });
	});
});

describe("a part that the scan cannot read", () => {
	test("a view query that fails is in notRead with its cause, and each other finding stays", async () => {
		const report = await scan({
			work: { "Hygiene: inbox pressure": new Error("notion-query-data-sources: internal_server_error: try again\nat line 2"), "Hygiene: open loops": [loop("Checkout Outage", "Incident", 30)] },
			knowledge: { "Hygiene: oversized": [sized("Runbook", 26_000)] },
		});
		assert.deepEqual(report.notRead, [{ view: '"Hygiene: inbox pressure" of Work', cause: "notion-query-data-sources: internal_server_error: try again" }]);
		assert.equal(report.inboxPressure, null);
		assert.deepEqual(report.openLoops.map(({ title }) => title), ["Checkout Outage"]);
		assert.deepEqual(report.oversizedNotes.map(({ title }) => title), ["Runbook"]);
	});

	test("a failed read of the 1:1 rows leaves out each open loop, because the latest 1:1 row is not known", async () => {
		const report = await scan({ work: { "Hygiene: open loops": [loop("Ada Park 2026-02-07", "1:1", 30), loop("Checkout Outage", "Incident", 30)], "1:1 History": new Error("timeout") } });
		assert.deepEqual(report.openLoops, []);
		assert.deepEqual(report.notRead, [{ view: '"Hygiene: open loops" of Work', cause: 'the view "1:1 History" gave no rows: timeout' }]);
	});

	test("a view that the map file does not hold is in notRead, with the command that writes the map file", async () => {
		const views = { ...map.databases.work.views };
		delete views["Hygiene: open loops"];
		const old = { ...map, databases: { ...map.databases, work: { ...map.databases.work, views } } };
		const report = await scanHygiene({ call: notion({}).call, map: old, projectDir: EMPTY_PROJECT, nowMs: NOW, watchedTypes: WATCHED });
		assert.deepEqual(report.notRead, [{ view: '"Hygiene: open loops" of Work', cause: "the map file does not have the view, run notion-setup.ts" }]);
	});

	test("a scan that cannot start gives the findings of the local files and one entry of notRead", () => {
		const report = hygieneNotRead(EMPTY_PROJECT, "the Notion map file", new Error("Cannot read the map file"));
		assert.deepEqual(report, { ungroupedClusters: [], oversizedNotes: [], openLoops: [], inboxPressure: null, leftoverInstructionFiles: [], agentsMd: null, notRead: [{ view: "the Notion map file", cause: "Cannot read the map file" }] });
	});
});

describe("the report as text", () => {
	const REPORT: HygieneReport = {
		ungroupedClusters: [{ token: "billing", files: ["Billing Export Pipeline", "Billing Retry Design"] }],
		oversizedNotes: Array.from({ length: 11 }, (_, index) => ({ title: `Runbook ${index}`, sizeKb: 40 - index })),
		openLoops: [{ title: "Payments Latency", ageDays: 45, openItems: 1 }],
		inboxPressure: { count: 4, oldestDays: 21 },
		leftoverInstructionFiles: ["CLAUDE.md"],
		agentsMd: { sizeKb: 23 },
		notRead: [{ view: '"Hygiene: oversized" of People', cause: "timeout" }],
	};

	test("a report with no finding has no line and no claim", async () => {
		const clean = await scan({});
		assert.deepEqual(formatHygiene(clean), []);
		assert.deepEqual(hygieneClaims(clean), []);
	});

	test("the claims are in the order of the lines, and each line starts with its claim", () => {
		const claims = hygieneClaims(REPORT);
		assert.deepEqual(claims, [
			"CLAUDE.md present beside AGENTS.md",
			"AGENTS.md is 23KB",
			"Active rows with no `Project` that look like one topic",
			"11 note(s) past the 25KB organization threshold",
			"1 note(s) with open follow-ups untouched 14+ days",
			"4 inbox item(s) unchanged for 7+ days",
			"1 part(s) of the hygiene scan not read",
		]);
		const flags = formatHygiene(REPORT).filter((line) => line.startsWith("⚠️"));
		assert.deepEqual(flags.map((line, index) => line.startsWith(`⚠️  ${claims[index]}`)), claims.map(() => true));
	});

	test("each finding has its entries below its line, and an empty line is between two findings", () => {
		const lines = formatHygiene(REPORT);
		const at = (start: string): number => lines.findIndex((line) => line.startsWith(start));
		assert.deepEqual(lines.slice(at("⚠️  Active rows"), at("⚠️  11 note(s)")), [
			"⚠️  Active rows with no `Project` that look like one topic — consider a `Project` value:",
			'   - "billing": Billing Export Pipeline, Billing Retry Design',
			"",
		]);
		assert.deepEqual(lines.slice(at("⚠️  1 note(s) with open")), [
			"⚠️  1 note(s) with open follow-ups untouched 14+ days — close, chase, or consciously park (titles + counts only by design):",
			"   - Payments Latency (45d, 1 open item(s))",
			"",
			"⚠️  4 inbox item(s) unchanged for 7+ days (oldest 21d) — ask the agent to run om-intake to drain the inbox.",
			"",
			"⚠️  1 part(s) of the hygiene scan not read — the findings of each one are not in this report:",
			'   - "Hygiene: oversized" of People (timeout)',
		]);
	});

	test("a list shows 10 entries and then the number of the entries that it does not show", () => {
		const lines = formatHygiene(REPORT);
		const start = lines.findIndex((line) => line.startsWith("⚠️  11 note(s)"));
		assert.equal(lines[start + 1], "   - Runbook 0 (40KB)");
		assert.equal(lines[start + 10], "   - Runbook 9 (31KB)");
		assert.equal(lines[start + 11], "   - … and 1 more");
		assert.equal(lines[start + 12], "");
	});

	test("the identity of a report does not change with a size, an age, or the words of a failure, and it changes with a finding", () => {
		const key = (report: HygieneReport): string => reportKey(report, HYGIENE_VOLATILE_FIELDS);
		const moved: HygieneReport = {
			...REPORT,
			oversizedNotes: REPORT.oversizedNotes.map((note) => ({ ...note, sizeKb: note.sizeKb + 5 })),
			openLoops: [{ title: "Payments Latency", ageDays: 46, openItems: 1 }],
			inboxPressure: { count: 4, oldestDays: 22 },
			agentsMd: { sizeKb: 24 },
			notRead: [{ view: '"Hygiene: oversized" of People', cause: "other words" }],
		};
		assert.equal(key(moved), key(REPORT));
		assert.notEqual(key({ ...REPORT, openLoops: [{ title: "Payments Latency", ageDays: 45, openItems: 2 }] }), key(REPORT));
		assert.notEqual(key({ ...REPORT, notRead: [] }), key(REPORT));
	});
});
