/**
 * notion-setup.ts and lib/notion-map.ts: the pure steps of the setup (which
 * properties to add, which test rows fail) and the map file. The live runs
 * in the pull request prove the setup against Notion itself.
 */

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { digestLine, readerMapBody, readNotionMap, writeNotionMap } from "../lib/notion-map.ts";
import { DATABASES, PAGES, PROBE_PREFIX, TEMPLATES, type DatabaseKey, type DatabaseSpec } from "../lib/notion-model.ts";
import type { LiveDatabase, LiveProperty } from "../lib/notion-parse.ts";
import { missingProperties, probeFailures, probeProperties, propertyStatements, rollupStatements } from "../notion-setup.ts";
import { rmTemp } from "./_helpers.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const examplePath = join(repoRoot, "notion-map.example.json");
const spec = (key: DatabaseKey): DatabaseSpec => DATABASES.find((d) => d.key === key) ?? assert.fail(`no database ${key}`);
const dataSourceOf = (key: DatabaseKey): string => `collection://ds-${key}`;
const property = (name: string, type: string, options: readonly string[] = []): LiveProperty => ({ name, type, options: options.map((o) => ({ name: o, color: "gray" })), target: undefined });

/** The live properties of a database that holds the whole model, the reverse sides included. */
function complete(key: DatabaseKey): Record<string, LiveProperty> {
	const live: Record<string, LiveProperty> = { Name: property("Name", "title") };
	for (const [name, p] of Object.entries(spec(key).properties)) live[name] = property(name, p.type, "options" in p ? p.options : []);
	for (const d of DATABASES) {
		for (const p of Object.values(d.properties)) {
			if (p.type === "relation" && p.target === key && p.reverse !== undefined) live[p.reverse] = property(p.reverse, "relation");
		}
	}
	return live;
}
function liveModel(): Record<DatabaseKey, LiveDatabase> {
	const live = {} as Record<DatabaseKey, LiveDatabase>;
	for (const d of DATABASES) live[d.key] = { id: d.key, url: "", title: d.title, inTrash: false, dataSource: dataSourceOf(d.key), properties: complete(d.key), views: [] };
	return live;
}

describe("propertyStatements", () => {
	test("a new database gets each property once, with plain columns before formulas and relations", () => {
		const plan = propertyStatements(spec("competencies"), { Name: property("Name", "title") }, dataSourceOf);
		const names = plan.statements.map((s) => s.match(/^ADD COLUMN "([^"]+)"/)?.[1]);
		assert.equal(plan.properties, Object.keys(spec("competencies").properties).length - 1);
		assert.ok(!names.includes("Evidence count"), "the rollup waits for the reverse relation");
		assert.ok(names.indexOf("Changed") < names.indexOf("Stale"));
		assert.ok(plan.statements.includes('ADD COLUMN "Current level" SELECT()'));
	});

	test("a database that holds the model gets no statement", () => {
		for (const d of DATABASES) {
			assert.deepEqual(propertyStatements(d, complete(d.key), dataSourceOf), { statements: [], properties: 0, options: 0 });
			assert.deepEqual(rollupStatements(d, complete(d.key), dataSourceOf), []);
		}
	});

	test("a select that lacks an option of the model gets the full list, live options first", () => {
		const live = { ...complete("work"), Severity: property("Severity", "select", ["low", "urgent"]) };
		const plan = propertyStatements(spec("work"), live, dataSourceOf);
		assert.deepEqual(plan.statements, [`ALTER COLUMN "Severity" SET SELECT('low':gray, 'urgent':gray, 'high':purple, 'medium':orange)`]);
		assert.equal(plan.options, 2);
	});

	test("a property with a different type stops the setup with the name of the property", () => {
		const live = { ...complete("work"), Ticket: property("Ticket", "number") };
		assert.throws(() => propertyStatements(spec("work"), live, dataSourceOf), /"Ticket" of "Work" has the type number, and the model needs text/);
	});

	test("rollupStatements adds a rollup that is absent", () => {
		const { "Evidence count": _, ...live } = complete("competencies");
		assert.deepEqual(rollupStatements(spec("competencies"), live, dataSourceOf), [`ADD COLUMN "Evidence count" ROLLUP('Evidence', 'Name', 'count')`]);
	});
});

describe("missingProperties", () => {
	test("is empty for the whole model, and names a lost reverse relation", () => {
		const live = liveModel();
		assert.deepEqual(missingProperties(live), []);
		const { Evidence: _, ...competencies } = live.competencies.properties;
		assert.deepEqual(missingProperties({ ...live, competencies: { ...live.competencies, properties: competencies } }), ["Competencies.Evidence"]);
	});
});

describe("test rows", () => {
	const stale = spec("work").views.find((v) => v.name === "Stale Actives") ?? assert.fail("view");
	const outside = spec("work").views.find((v) => v.name === "Hygiene: edited outside hooks") ?? assert.fail("view");
	const now = new Date("2026-11-25T12:00:00.000Z");
	const title = (label: string): string => `${PROBE_PREFIX}Stale Actives: ${label}`;

	test("probeProperties sets the dates from the time of the run", () => {
		assert.deepEqual(probeProperties(stale, stale.probe?.include[0] ?? assert.fail("row"), now), {
			Name: title("active old"),
			Status: "active",
			"date:Changed:start": "2026-10-26",
			"date:Changed:is_datetime": 0,
		});
		assert.deepEqual(probeProperties(outside, outside.probe?.include[0] ?? assert.fail("row"), now), {
			Name: `${PROBE_PREFIX}Hygiene: edited outside hooks: old stamp`,
			"date:Hook stamp:start": "2026-11-25T11:00:00.000Z",
			"date:Hook stamp:is_datetime": 1,
		});
	});

	test("probeFailures is empty when the view returns the right rows, with rows of other views present", () => {
		assert.deepEqual(probeFailures(stale, new Set([title("active old"), `${PROBE_PREFIX}Hygiene: oversized: large`])), []);
	});

	test("probeFailures names a row that is absent and a row that must not be there", () => {
		assert.deepEqual(probeFailures(stale, new Set([title("active new")])), ['"Stale Actives" does not return the row "active old"', '"Stale Actives" returns the row "active new"']);
	});
});

describe("the map file", () => {
	let dir = "";
	afterEach(() => rmTemp(dir));

	test("the committed example has each database, view, page, and template of the model, and no real ID", () => {
		const example = readNotionMap(examplePath);
		assert.deepEqual(Object.keys(example.databases), DATABASES.map((d) => d.key));
		for (const d of DATABASES) assert.deepEqual(Object.keys(example.databases[d.key].views), d.views.map((v) => v.name), d.title);
		assert.deepEqual(Object.keys(example.pages), [...PAGES.map((p) => p.key), "reader_map"]);
		for (const p of PAGES) assert.deepEqual(Object.keys(example.pages[p.key].views), p.linkedViews.map((v) => v.name), p.title);
		assert.deepEqual(Object.keys(example.templates), TEMPLATES.map((t) => t.title));
		assert.deepEqual(readFileSync(examplePath, "utf8").match(/[1-9a-f][0-9a-f]{7}-?[0-9a-f]{4}/g), null);
	});

	test("a map survives a write and a read, and the reader page shows its digest", () => {
		dir = mkdtempSync(join(tmpdir(), "notion-map-"));
		const path = join(dir, "notion-map.json");
		const map = readNotionMap(examplePath);
		writeNotionMap(path, map);
		assert.deepEqual(readNotionMap(path), map);
		const body = readerMapBody(map);
		assert.ok(body.includes(digestLine(map)));
		assert.ok(body.includes("| [Work](https://app.notion.com/p/00000000000000000000000000000000) | `collection://00000000-0000-0000-0000-000000000000` |"));
		assert.ok(body.includes("| Work | Open tasks | `view://00000000-0000-0000-0000-000000000000` |"));
		assert.notEqual(digestLine({ ...map, workspace_id: "other" }), digestLine(map));
	});

	test("a missing or malformed map file says how to make it", () => {
		dir = mkdtempSync(join(tmpdir(), "notion-map-"));
		assert.throws(() => readNotionMap(join(dir, "absent.json")), /Run notion-setup\.ts to write it/);
		writeFileSync(join(dir, "old.json"), '{"version":0}');
		assert.throws(() => readNotionMap(join(dir, "old.json")), /does not have the shape of version 1/);
	});
});
