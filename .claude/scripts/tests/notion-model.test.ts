/**
 * lib/notion-model.ts: the model tables agree with themselves and with the
 * scaffold files, and the pure functions give the text that Notion took in
 * the live runs.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	columnType,
	DATABASES,
	droppedDirectives,
	extraFilters,
	firstParagraph,
	mergeOptions,
	PAGES,
	SCAFFOLD_SOURCES,
	scaffoldBody,
	scaffoldDescription,
	TEMPLATES,
	viewDirectives,
	type DatabaseKey,
	type ViewSpec,
} from "../lib/notion-model.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const spec = (key: DatabaseKey) => DATABASES.find((d) => d.key === key) ?? assert.fail(`no database ${key}`);
const dataSourceOf = (key: DatabaseKey): string => `collection://ds-${key}`;

describe("the model tables", () => {
	test("each scaffold source is a file of the repository", () => {
		for (const [source, path] of Object.entries(SCAFFOLD_SOURCES)) assert.ok(existsSync(join(repoRoot, path)), `${source}: ${path}`);
	});

	test("each view reads only properties of its database", () => {
		const check = (database: DatabaseKey, view: ViewSpec, where: string): void => {
			const names = new Set(["Name", ...Object.keys(spec(database).properties)]);
			const used = [...(view.filters ?? []).map((f) => f.property), ...(view.sort ? [view.sort.property] : []), ...(view.groupBy ? [view.groupBy] : [])];
			for (const name of used) assert.ok(names.has(name), `${where}: "${view.name}" reads "${name}"`);
		};
		for (const d of DATABASES) for (const view of d.views) check(d.key, view, d.title);
		for (const page of PAGES) for (const view of page.linkedViews) check(view.database, view, page.title);
	});

	test("each view that filters on a formula has test rows for both results", () => {
		for (const d of DATABASES) {
			for (const view of d.views) {
				const onFormula = (view.filters ?? []).some((f) => d.properties[f.property]?.type === "formula");
				assert.equal(view.probe !== undefined, onFormula, `${d.title}: ${view.name}`);
				if (view.probe !== undefined) assert.ok(view.probe.include.length > 0 && view.probe.exclude.length > 0, view.name);
			}
		}
	});

	test("a formula that a view filters on returns text, because a true or false formula returns no rows", () => {
		for (const d of DATABASES) {
			for (const view of d.views) {
				for (const filter of view.filters ?? []) {
					const property = d.properties[filter.property];
					if (property?.type === "formula") assert.match(property.expression, /^if\(.*"yes".*"no"\)+$/, `${d.title}.${filter.property}`);
				}
			}
		}
	});

	test("no text of the schema language holds a single quote", () => {
		for (const d of DATABASES) {
			for (const [name, property] of Object.entries(d.properties)) {
				const texts = property.type === "formula" ? [property.expression] : "options" in property ? property.options : [];
				for (const value of [name, ...texts]) assert.doesNotMatch(value, /'/, `${d.title}.${name}`);
			}
		}
	});

	test("the reverse name of a two-way relation is free on its target", () => {
		for (const d of DATABASES) {
			for (const [name, property] of Object.entries(d.properties)) {
				if (property.type !== "relation" || property.reverse === undefined) continue;
				assert.equal(spec(property.target).properties[property.reverse], undefined, `${d.title}.${name}`);
			}
		}
	});

	test("a page links only to pages that come before it, and titles are unique", () => {
		const seen = new Set<string>(DATABASES.map((d) => d.key));
		for (const page of PAGES) {
			for (const link of page.links ?? []) assert.ok(seen.has(link), `${page.title} links to ${link}`);
			seen.add(page.key);
			assert.equal(new Set(page.linkedViews.map((v) => v.name)).size, page.linkedViews.length, page.title);
		}
		assert.equal(new Set(PAGES.map((p) => p.title)).size, PAGES.length);
		assert.equal(new Set(TEMPLATES.map((t) => t.title)).size, TEMPLATES.length);
		for (const template of TEMPLATES) {
			const applies = spec("templates").properties["Applies to"];
			assert.ok(applies?.type === "select" && applies.options.includes(template.appliesTo), template.title);
		}
	});
});

describe("columnType", () => {
	test("gives the schema text of each property kind", () => {
		const work = spec("work").properties;
		const type = (name: string): string => columnType(work[name] ?? assert.fail(name), dataSourceOf, "work");
		assert.equal(type("Ticket"), "RICH_TEXT");
		assert.equal(type("Quarter"), "SELECT()");
		assert.equal(type("Severity"), "SELECT('high':blue, 'medium':green, 'low':purple)");
		assert.equal(type("Stale"), `FORMULA('if(dateBetween(now(), prop("Changed"), "days") >= 14, "yes", "no")')`);
		assert.equal(type("Team"), "RELATION('ds-teams')");
		assert.equal(type("Competencies"), "RELATION('ds-competencies', DUAL 'Evidence')");
		assert.equal(type("Decisions"), "RELATION('ds-work', DUAL 'Decision of' 'decision_of')");
		const rollup = spec("competencies").properties["Evidence count"] ?? assert.fail("rollup");
		assert.equal(columnType(rollup, dataSourceOf, "competencies"), "ROLLUP('Evidence', 'Name', 'count')");
	});

	test("mergeOptions keeps the live options and their colors, and adds only the missing names", () => {
		const merged = mergeOptions([{ name: "low", color: "red" }], ["high", "low"]);
		assert.deepEqual(merged, [{ name: "low", color: "red" }, { name: "high", color: "green" }]);
	});
});

describe("views", () => {
	const openLoops = spec("work").views.find((v) => v.name === "Hygiene: open loops") ?? assert.fail("view");
	const saved = {
		filters: [
			{ property: "Open loops", operator: "number_greater_than", value: 0 },
			{ property: "Stale", operator: "string_is", value: "yes" },
		],
		sorts: [],
		groupBy: undefined,
	};
	/** The saved form of the view before the model lost its `Type` filter. */
	const savedWithType = {
		...saved,
		filters: [...saved.filters, ...["1:1", "Inbox item", "Incident"].map((value) => ({ property: "Type", operator: "enum_is", value }))],
	};

	test("viewDirectives gives the view language text", () => {
		assert.equal(viewDirectives(openLoops), 'FILTER "Open loops" > 0; FILTER "Stale" = "yes"');
		assert.equal(viewDirectives({ name: "v", filters: [{ property: "Project", empty: true }, { property: "Changed", since: "one_week_ago" }], sort: { property: "Changed", direction: "DESC" }, groupBy: "Team" }), 'FILTER "Project" IS EMPTY; FILTER "Changed" >= "one_week_ago"; SORT BY "Changed" DESC; GROUP BY "Team"');
	});

	test("droppedDirectives is empty for the saved form that Notion returned", () => {
		assert.deepEqual(droppedDirectives(openLoops, saved), []);
	});

	test("droppedDirectives names a formula filter that Notion saved as an empty filter", () => {
		const withoutFormula = { ...saved, filters: saved.filters.slice(0, 1) };
		assert.deepEqual(droppedDirectives(openLoops, withoutFormula), ['FILTER "Stale" = "yes"']);
	});

	test("droppedDirectives names a lost value, a lost sort, and a lost group", () => {
		const view: ViewSpec = { name: "v", filters: [{ property: "Type", in: ["a", "b"] }, { property: "Project", empty: true }], sort: { property: "Date", direction: "DESC" }, groupBy: "Quarter" };
		const partial = { filters: [{ property: "Type", operator: "enum_is", value: "a" }], sorts: [{ property: "Date", direction: "ascending" }], groupBy: undefined };
		assert.deepEqual(droppedDirectives(view, partial), ['FILTER "Type" IN ("a", "b")', 'FILTER "Project" IS EMPTY', 'SORT BY "Date" DESC', 'GROUP BY "Quarter"']);
	});

	test("extraFilters names a property that the saved view filters and the model view does not", () => {
		assert.deepEqual(extraFilters(openLoops, saved), []);
		assert.deepEqual(extraFilters(openLoops, savedWithType), ["Type"]);
		assert.deepEqual(droppedDirectives(openLoops, savedWithType), [], "the saved view holds each directive of the model, so only the extra filter shows the change");
	});

	test("extraFilters is empty for a model view with no filter, because the setup has no filter to send", () => {
		assert.deepEqual(extraFilters({ name: "Recently changed", sort: { property: "Changed", direction: "DESC" } }, savedWithType), []);
	});

	test("the open-loops view has no Type filter, so a row of each type can reach the scan", () => {
		assert.deepEqual((openLoops.filters ?? []).map(({ property }) => property), ["Open loops", "Stale"]);
		assert.ok(openLoops.probe?.include.some(({ properties }) => properties?.["Type"] === "Work note"));
	});
});

describe("scaffold text", () => {
	const note = '---\ndescription: "A test note"\ntags:\n  - brain\n---\n\n# Title\n\nFirst [[Target|shown]] and [[Plain]]\nsecond line.\n\n%%\nhidden\nlines\n%%\n\n## One\n\n- a\n\n## Two\n\n- b\n';

	test("scaffoldBody drops the frontmatter and the title, and converts wikilinks and comments", () => {
		assert.equal(scaffoldBody(note), "First shown and Plain\nsecond line.\n\n> hidden\n> lines\n\n## One\n\n- a\n\n## Two\n\n- b\n");
	});

	test("scaffoldBody with a section gives that heading and its lines only", () => {
		assert.equal(scaffoldBody(note, "One"), "## One\n\n- a\n");
		assert.equal(scaffoldBody(note, "Absent"), "");
	});

	test("scaffoldDescription and firstParagraph read the frontmatter and the first paragraph", () => {
		assert.equal(scaffoldDescription(note), "A test note");
		assert.equal(firstParagraph(note), "First shown and Plain second line.");
	});

	test("each section that a page takes from a scaffold file is in that file", () => {
		for (const page of PAGES) {
			for (const part of page.body) {
				if (part.section === undefined) continue;
				const text = readFileSync(join(repoRoot, SCAFFOLD_SOURCES[part.source]), "utf8");
				assert.notEqual(scaffoldBody(text, part.section), "", `${page.title}: ${part.section}`);
			}
		}
	});
});
