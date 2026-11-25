/**
 * Build the Notion content model of `lib/notion-model.ts` under one root
 * page, and write the map file.
 *
 *     node --experimental-strip-types .claude/scripts/notion-setup.ts
 *     node --experimental-strip-types .claude/scripts/notion-setup.ts --root-title "obsidian-mind parity fixtures" --map notion-map.fixtures.json
 *     node --experimental-strip-types .claude/scripts/notion-setup.ts --check
 *
 * Each step reads the live state, compares it with the model, and makes
 * only what is missing. The run finds each object by its name under the
 * root, so it does not depend on the map file or on an earlier run. A second
 * run makes nothing.
 *
 * Options:
 *   --root-title <title>   The title of the root page. Default "obsidian-mind".
 *   --map <path>           The map file. Default notion-map.json in the repository root.
 *   --workspace-id <id>    Stop when the login is in a different workspace.
 *   --ledger <path>        Append one JSON line for each object that the run makes.
 *   --ledger-tag <k=v>     Add one field to each ledger line.
 *   --check                Make nothing. Fetch each object of the map file and print the counts.
 */

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainModule } from "./lib/main-guard.ts";
import { createNotionClient, NotionError, type NotionClient } from "./lib/notion-client.ts";
import { digestLine, NOTION_MAP_FILE, readerMapBody, readNotionMap, writeNotionMap, type MapDatabase, type MapPage, type NotionMap, type NotionRef } from "./lib/notion-map.ts";
import {
	columnType,
	DATABASES,
	droppedDirectives,
	firstParagraph,
	mergeOptions,
	PAGES,
	PROBE_PREFIX,
	READER_MAP_TITLE,
	SCAFFOLD_SOURCES,
	scaffoldBody,
	scaffoldDescription,
	TEMPLATES,
	UNVERIFIED_SUFFIX,
	viewDirectives,
	type DatabaseKey,
	type DatabaseSpec,
	type LinkedViewSpec,
	type PageKey,
	type PageSpec,
	type ProbeRow,
	type PropertySpec,
	type ScaffoldSource,
	type ViewSpec,
} from "./lib/notion-model.ts";
import {
	notionId,
	parseCreatedPages,
	parseDatabase,
	parsePage,
	parsePrivatePages,
	parseRows,
	parseViews,
	parseWorkspaceId,
	type LiveDatabase,
	type LivePage,
	type LiveProperty,
	type LiveView,
	type PageRef,
} from "./lib/notion-parse.ts";

export interface SetupOptions {
	readonly rootTitle: string;
	readonly mapPath: string;
	readonly workspaceId?: string;
	readonly ledgerPath?: string;
	readonly ledgerTag?: readonly [string, unknown];
	/** The text of a scaffold source file. */
	readonly readSource: (source: ScaffoldSource) => string;
	readonly log: (line: string) => void;
	readonly sleep?: (ms: number) => Promise<void>;
}

export type CreatedKind = "page" | "database" | "property" | "option" | "view" | "row" | "probe_row";

export interface SetupResult {
	readonly map: NotionMap;
	readonly created: Readonly<Record<CreatedKind, number>>;
}

type Live = Readonly<Record<DatabaseKey, LiveDatabase>>;

const ROOT_BODY = "The content model of obsidian-mind. The setup of the repository builds each page and database here. Change the model in the repository, then run the setup again.\n";
const PROBE_TRIES = 4;
const TRASH_BATCH = 20;

const fail = (message: string): never => {
	throw new Error(message);
};

/** The one item with this title, `undefined` for none, and an error for more than one. */
function oneByTitle<T extends { readonly title: string }>(items: readonly T[], title: string, where: string): T | undefined {
	const matches = items.filter((item) => item.title === title);
	if (matches.length > 1) fail(`${where} holds ${matches.length} objects with the title "${title}". Give one of them a different title, then run the setup again.`);
	return matches[0];
}

const ref = (item: NotionRef): NotionRef => ({ id: item.id, url: item.url });

/** The property changes that make a live data source agree with the model, without rollups. */
export function propertyStatements(spec: DatabaseSpec, live: Readonly<Record<string, LiveProperty>>, dataSourceOf: (key: DatabaseKey) => string): { statements: string[]; properties: number; options: number } {
	const statements: string[] = [];
	let properties = 0;
	let options = 0;
	const column = (name: string): string => `"${name}"`;
	const order = (property: PropertySpec): number => (property.type === "relation" ? 2 : property.type === "formula" ? 1 : 0);
	const entries = Object.entries(spec.properties)
		.filter(([, property]) => property.type !== "rollup")
		.sort(([, a], [, b]) => order(a) - order(b));
	for (const [name, property] of entries) {
		const existing = live[name];
		if (existing === undefined) {
			statements.push(`ADD COLUMN ${column(name)} ${columnType(property, dataSourceOf, spec.key)}`);
			properties++;
			continue;
		}
		if (existing.type !== property.type) {
			fail(`The property "${name}" of "${spec.title}" has the type ${existing.type}, and the model needs ${property.type}. Rename or remove the property in Notion, then run the setup again.`);
		}
		if (property.type === "select" || property.type === "multi_select") {
			const merged = mergeOptions(existing.options, property.options);
			if (merged.length > existing.options.length) {
				statements.push(`ALTER COLUMN ${column(name)} SET ${columnType(property, dataSourceOf, spec.key, existing.options)}`);
				options += merged.length - existing.options.length;
			}
		}
	}
	return { statements, properties, options };
}

/** The rollups of the model that the live data source does not have. */
export function rollupStatements(spec: DatabaseSpec, live: Readonly<Record<string, LiveProperty>>, dataSourceOf: (key: DatabaseKey) => string): string[] {
	return Object.entries(spec.properties)
		.filter(([name, property]) => property.type === "rollup" && live[name] === undefined)
		.map(([name, property]) => `ADD COLUMN "${name}" ${columnType(property, dataSourceOf, spec.key)}`);
}

/** Each property of the model that the live schemas do not hold, the reverse side of a two-way relation included. */
export function missingProperties(live: Live): string[] {
	const missing: string[] = [];
	for (const spec of DATABASES) {
		for (const [name, property] of Object.entries(spec.properties)) {
			if (live[spec.key].properties[name]?.type !== property.type) missing.push(`${spec.title}.${name}`);
			if (property.type === "relation" && property.reverse !== undefined && live[property.target].properties[property.reverse]?.type !== "relation") {
				missing.push(`${DATABASES.find((d) => d.key === property.target)?.title}.${property.reverse}`);
			}
		}
	}
	return missing;
}

/** The properties of one test row, for `notion-create-pages`. */
export function probeProperties(view: ViewSpec, row: ProbeRow, now: Date): Record<string, string | number> {
	const properties: Record<string, string | number> = { Name: `${PROBE_PREFIX}${view.name}: ${row.label}`, ...row.properties };
	if (row.changedDaysAgo !== undefined) {
		properties["date:Changed:start"] = new Date(now.getTime() - row.changedDaysAgo * 86_400_000).toISOString().slice(0, 10);
		properties["date:Changed:is_datetime"] = 0;
	}
	if (row.hookStampMinutesAgo !== undefined) {
		properties["date:Hook stamp:start"] = new Date(now.getTime() - row.hookStampMinutesAgo * 60_000).toISOString();
		properties["date:Hook stamp:is_datetime"] = 1;
	}
	return properties;
}

/** The test rows of a view that a query result got wrong: a row that must be there and is not, or the reverse. */
export function probeFailures(view: ViewSpec, returned: ReadonlySet<string>): string[] {
	const title = (row: ProbeRow): string => `${PROBE_PREFIX}${view.name}: ${row.label}`;
	return [
		...(view.probe?.include ?? []).filter((row) => !returned.has(title(row))).map((row) => `"${view.name}" does not return the row "${row.label}"`),
		...(view.probe?.exclude ?? []).filter((row) => returned.has(title(row))).map((row) => `"${view.name}" returns the row "${row.label}"`),
	];
}

const hookStamp = (now: Date): Record<string, string | number> => ({ "date:Hook stamp:start": now.toISOString(), "date:Hook stamp:is_datetime": 1 });

export async function runSetup(client: NotionClient, options: SetupOptions): Promise<SetupResult> {
	const created: Record<CreatedKind, number> = { page: 0, database: 0, property: 0, option: 0, view: 0, row: 0, probe_row: 0 };
	const sleep = options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
	const record = (kind: CreatedKind, id: string, title: string): void => {
		created[kind]++;
		options.log(`created ${kind}: ${title}`);
		if (options.ledgerPath === undefined) return;
		const tag = options.ledgerTag === undefined ? {} : { [options.ledgerTag[0]]: options.ledgerTag[1] };
		appendFileSync(options.ledgerPath, `${JSON.stringify({ id, kind, title, ...tag, at: new Date().toISOString() })}\n`);
	};

	const workspaceId = parseWorkspaceId(await client.call("notion-get-self"));
	const earlier = existsSync(options.mapPath) ? readNotionMap(options.mapPath) : undefined;
	for (const [source, expected] of [["--workspace-id", options.workspaceId], [options.mapPath, earlier?.workspace_id]] as const) {
		if (expected !== undefined && expected !== workspaceId) fail(`The Notion login is in a different workspace from the one that ${source} names. The setup made no change.`);
	}

	const fetchPage = async (id: string): Promise<LivePage> => parsePage(await client.call("notion-fetch", { id }));
	const fetchDatabase = async (id: string): Promise<LiveDatabase> => parseDatabase(await client.call("notion-fetch", { id }));
	const createPage = async (parent: Record<string, string> | undefined, properties: Record<string, string | number>, content: string): Promise<PageRef> => {
		const reply = await client.call("notion-create-pages", { ...(parent === undefined ? {} : { parent }), allow_async: false, pages: [{ properties, content }] });
		return parseCreatedPages(reply)[0] ?? fail("notion-create-pages returned no page.");
	};

	const findRoot = async (): Promise<PageRef | undefined> => {
		if (earlier !== undefined) {
			// A root that Notion no longer finds is a `tool_error`. Then the title search decides.
			const page = await fetchPage(earlier.root.id).catch((error: unknown) => {
				if (error instanceof NotionError && error.code === "tool_error") return undefined;
				throw error;
			});
			if (page !== undefined && !page.inTrash && page.title === options.rootTitle) return page;
		}
		const pages: PageRef[] = [];
		let cursor: string | undefined;
		do {
			const list = parsePrivatePages(await client.call("notion-list-private-pages", { limit: 200, ...(cursor === undefined ? {} : { cursor }) }));
			pages.push(...list.pages);
			cursor = list.nextCursor;
		} while (cursor !== undefined);
		return oneByTitle(pages, options.rootTitle, "The private section of the workspace");
	};
	let rootRef = await findRoot();
	if (rootRef === undefined) {
		rootRef = await createPage(undefined, { title: options.rootTitle }, ROOT_BODY);
		record("page", rootRef.id, options.rootTitle);
	}
	const rootId = rootRef.id;
	let root = await fetchPage(rootId);

	const ensureDatabase = async (spec: DatabaseSpec): Promise<LiveDatabase> => {
		const existing = oneByTitle(root.children.filter((child) => child.kind === "database"), spec.title, `The page "${options.rootTitle}"`);
		if (existing !== undefined) return fetchDatabase(existing.id);
		const description = [spec.description, ...spec.descriptionSources.map((source) => firstParagraph(options.readSource(source)))].join(" ");
		const reply = await client.call("notion-create-database", { parent: { page_id: rootId }, title: spec.title, description, schema: 'CREATE TABLE ("Name" TITLE)' });
		const database = parseDatabase(reply);
		record("database", database.id, spec.title);
		return database;
	};
	const live = {} as Record<DatabaseKey, LiveDatabase>;
	for (const spec of DATABASES) live[spec.key] = await ensureDatabase(spec);
	const dataSourceOf = (key: DatabaseKey): string => live[key].dataSource;
	const refresh = async (): Promise<void> => {
		await Promise.all(DATABASES.map(async (spec) => (live[spec.key] = await fetchDatabase(live[spec.key].id))));
	};

	let schemaChanged = false;
	for (const spec of DATABASES) {
		const plan = propertyStatements(spec, live[spec.key].properties, dataSourceOf);
		if (plan.statements.length === 0) continue;
		await client.call("notion-update-data-source", { data_source_id: dataSourceOf(spec.key), statements: plan.statements.join("; ") });
		created.property += plan.properties;
		created.option += plan.options;
		options.log(`updated ${spec.title}: ${plan.properties} properties, ${plan.options} options`);
		schemaChanged = true;
	}
	if (schemaChanged) await refresh();
	let rollupsAdded = false;
	for (const spec of DATABASES) {
		const statements = rollupStatements(spec, live[spec.key].properties, dataSourceOf);
		if (statements.length === 0) continue;
		await client.call("notion-update-data-source", { data_source_id: dataSourceOf(spec.key), statements: statements.join("; ") });
		created.property += statements.length;
		options.log(`updated ${spec.title}: ${statements.length} rollups`);
		rollupsAdded = true;
	}
	if (rollupsAdded) await refresh();
	const missing = missingProperties(live);
	if (missing.length > 0) fail(`Notion did not keep these properties: ${missing.join(", ")}.`);

	const checkSaved = (view: ViewSpec, saved: LiveView, where: string): void => {
		const dropped = droppedDirectives(view, saved);
		if (dropped.length > 0) fail(`The view "${saved.name}" of ${where} does not hold these directives: ${dropped.join("; ")}.`);
	};
	/** Find the view by name, or make it. A new view on a formula keeps the unverified name until its test rows pass. */
	const ensureView = async (view: ViewSpec, existing: readonly LiveView[], target: Record<string, string>, dataSource: string, where: string): Promise<{ saved: LiveView; pending: boolean }> => {
		const pendingName = `${view.name}${UNVERIFIED_SUFFIX}`;
		const found = existing.find((v) => v.name === view.name) ?? existing.find((v) => v.name === pendingName);
		if (found !== undefined) {
			checkSaved(view, found, where);
			return { saved: found, pending: found.name === pendingName };
		}
		const pending = view.probe !== undefined;
		const name = pending ? pendingName : view.name;
		const reply = await client.call("notion-create-view", { ...target, data_source_id: dataSource, name, type: "table", configure: viewDirectives(view) });
		const saved = parseViews(reply)[0] ?? fail(`notion-create-view returned no view for "${name}".`);
		record("view", notionId(saved.url), `${where}: ${name}`);
		checkSaved(view, saved, where);
		return { saved, pending };
	};

	const queryNames = async (viewUrl: string): Promise<Map<string, string>> => {
		const names = new Map<string, string>();
		let cursor: string | undefined;
		do {
			const page = parseRows(await client.call("notion-query-data-sources", { data: { mode: "view", view_url: viewUrl, page_size: 100, ...(cursor === undefined ? {} : { start_cursor: cursor }) } }));
			for (const row of page.rows) names.set(String(row["Name"] ?? ""), String(row["url"] ?? ""));
			cursor = page.nextCursor;
		} while (cursor !== undefined);
		return names;
	};
	const trash = async (ids: readonly string[]): Promise<void> => {
		for (let i = 0; i < ids.length; i += TRASH_BATCH) {
			await client.call("notion-delete-pages", { page_ids: ids.slice(i, i + TRASH_BATCH), user_confirmed: true });
		}
	};

	/** Run the test rows of each unverified view of one database, remove the rows, then give each view its final name. */
	const verifyViews = async (spec: DatabaseSpec, pending: readonly { view: ViewSpec; saved: LiveView }[], allRowsView: string): Promise<void> => {
		const leftovers = [...(await queryNames(allRowsView))].filter(([name]) => name.startsWith(PROBE_PREFIX)).map(([, url]) => notionId(url));
		if (leftovers.length > 0) {
			await trash(leftovers);
			options.log(`removed ${leftovers.length} test rows of an earlier run from ${spec.title}`);
		}
		const now = new Date();
		const rows = pending.flatMap(({ view }) => [...(view.probe?.include ?? []), ...(view.probe?.exclude ?? [])].map((row) => probeProperties(view, row, now)));
		const reply = await client.call("notion-create-pages", { parent: { data_source_id: live[spec.key].dataSource }, allow_async: false, pages: rows.map((properties) => ({ properties })) });
		const pages = parseCreatedPages(reply);
		pages.forEach((page, index) => record("probe_row", page.id, String(rows[index]?.["Name"] ?? "")));
		let failures: string[] = [];
		try {
			for (let attempt = 0; attempt < PROBE_TRIES; attempt++) {
				// A new row can take a moment to reach the view index, so a failure gets a few more tries.
				if (attempt > 0) await sleep(2000);
				const results = await Promise.all(pending.map(async ({ view, saved }) => probeFailures(view, new Set((await queryNames(saved.url)).keys()))));
				failures = results.flat();
				if (failures.length === 0) break;
			}
		} finally {
			await trash(pages.map((page) => page.id));
			options.log(`removed ${pages.length} test rows from ${spec.title}`);
		}
		if (failures.length > 0) fail(`The test rows of ${spec.title} show a wrong view: ${failures.join("; ")}.`);
		await Promise.all(pending.map(({ view, saved }) => client.call("notion-update-view", { view_id: saved.url, name: view.name })));
	};

	const databases = {} as Record<DatabaseKey, MapDatabase>;
	const entries = await Promise.all(
		DATABASES.map(async (spec): Promise<MapDatabase> => {
			const database = live[spec.key];
			const views: Record<string, string> = {};
			const pending: { view: ViewSpec; saved: LiveView }[] = [];
			for (const view of spec.views) {
				const result = await ensureView(view, database.views, { database_id: database.id }, database.dataSource, spec.title);
				views[view.name] = result.saved.url;
				if (result.pending) pending.push({ view, saved: result.saved });
			}
			if (pending.length > 0) await verifyViews(spec, pending, views["Recently changed"] ?? fail(`${spec.title} has no "Recently changed" view.`));
			return { ...ref(database), title: spec.title, data_source: database.dataSource, views };
		}),
	);
	// Filled in model order, so the map file and its digest do not depend on which database finished first.
	DATABASES.forEach((spec, index) => (databases[spec.key] = entries[index] ?? fail(`No map entry for ${spec.title}.`)));

	const rowsOf = new Map<DatabaseKey, Promise<Map<string, string>>>();
	const findRow = async (key: DatabaseKey, title: string): Promise<PageRef | undefined> => {
		const all = rowsOf.get(key) ?? queryNames(databases[key].views["Recently changed"] ?? "");
		rowsOf.set(key, all);
		const url = (await all).get(title);
		return url === undefined ? undefined : { id: notionId(url), url, title };
	};

	const pages = {} as Record<PageKey | "reader_map", MapPage>;
	const linkedViews = async (page: LivePage, specs: readonly LinkedViewSpec[]): Promise<Record<string, string>> => {
		const blocks = await Promise.all(page.children.filter((child) => child.kind === "linked_view").map((child) => fetchDatabase(child.id)));
		const existing = blocks.flatMap((block) => block.views);
		const views: Record<string, string> = {};
		for (const view of specs) {
			const result = await ensureView(view, existing, { parent_page_id: page.id }, databases[view.database].data_source, `the page "${page.title}"`);
			views[view.name] = result.saved.url;
		}
		return views;
	};
	const quickLinks = (spec: PageSpec): string => {
		if (spec.links === undefined) return "";
		const targets = spec.links.map((key) => (key in databases ? databases[key as DatabaseKey] : pages[key as PageKey]) ?? fail(`The page "${spec.title}" links to "${key}", which is not made yet.`));
		return `\n## Quick Links\n\n${targets.map((target) => `- [${target.title}](${target.url})`).join("\n")}\n`;
	};
	const ensurePage = async (spec: PageSpec): Promise<MapPage> => {
		const existing =
			spec.parent === "root"
				? oneByTitle(root.children.filter((child) => child.kind === "page"), spec.title, `The page "${options.rootTitle}"`)
				: await findRow(spec.parent, spec.title);
		let id = existing?.id;
		if (id === undefined) {
			const body = spec.body.map((part) => scaffoldBody(options.readSource(part.source), part.section)).join("\n") + quickLinks(spec);
			const first = spec.body[0];
			const row = spec.parent === "root" ? undefined : { Name: spec.title, Description: first === undefined ? "" : scaffoldDescription(options.readSource(first.source)), ...spec.properties, ...hookStamp(new Date()) };
			const page = await createPage(spec.parent === "root" ? { page_id: rootId } : { data_source_id: databases[spec.parent].data_source }, row ?? { title: spec.title }, body);
			record(spec.parent === "root" ? "page" : "row", page.id, spec.title);
			id = page.id;
		}
		const page = await fetchPage(id);
		return { ...ref(page), title: spec.title, views: await linkedViews(page, spec.linkedViews) };
	};
	for (const spec of PAGES) pages[spec.key] = await ensurePage(spec);

	const templates: Record<string, NotionRef> = {};
	for (const template of TEMPLATES) {
		const existing = await findRow("templates", template.title);
		if (existing !== undefined) {
			templates[template.title] = ref(existing);
			continue;
		}
		const properties = { Name: template.title, Purpose: template.purpose, "Applies to": template.appliesTo, ...hookStamp(new Date()) };
		const page = await createPage({ data_source_id: databases.templates.data_source }, properties, scaffoldBody(options.readSource(template.source)));
		record("row", page.id, `template: ${template.title}`);
		templates[template.title] = ref(page);
	}

	let readerMap: PageRef | undefined = oneByTitle(root.children.filter((child) => child.kind === "page"), READER_MAP_TITLE, `The page "${options.rootTitle}"`);
	if (readerMap === undefined) {
		readerMap = await createPage({ page_id: rootId }, { title: READER_MAP_TITLE }, "The setup fills this page.\n");
		record("page", readerMap.id, READER_MAP_TITLE);
	}
	pages.reader_map = { ...ref(readerMap), title: READER_MAP_TITLE, views: {} };

	root = await fetchPage(rootId);
	const map: NotionMap = { version: 1, workspace_id: workspaceId, root: { ...ref(root), title: options.rootTitle }, databases, pages, templates };
	if (!(await fetchPage(readerMap.id)).content.includes(digestLine(map))) {
		await client.call("notion-update-page", { page_id: readerMap.id, command: "replace_content", new_str: readerMapBody(map) });
		options.log(`updated the page "${READER_MAP_TITLE}"`);
	}
	writeNotionMap(options.mapPath, map);
	return { map, created };
}

export interface CheckResult {
	readonly databases: readonly string[];
	readonly views: readonly string[];
	readonly pages: readonly string[];
	readonly templates: readonly string[];
}

/** Fetch each object that the map names. An object that is absent, in Trash, or under a different name is an error. */
export async function checkMap(client: NotionClient, map: NotionMap): Promise<CheckResult> {
	const pageTitle = async (item: NotionRef, title: string): Promise<string> => {
		const page = parsePage(await client.call("notion-fetch", { id: item.id }));
		if (page.inTrash || page.title !== title) fail(`The page "${title}" of the map is in Trash or has the title "${page.title}".`);
		return page.title;
	};
	const viewName = async (url: string, name: string): Promise<string> => {
		const view = parseViews(await client.call("notion-fetch", { id: url }))[0];
		if (view?.name !== name) fail(`The view "${name}" of the map has the name "${view?.name}".`);
		return name;
	};
	const databases = await Promise.all(
		Object.values(map.databases).map(async (entry) => {
			const database = parseDatabase(await client.call("notion-fetch", { id: entry.id }));
			if (database.inTrash || database.title !== entry.title) fail(`The database "${entry.title}" of the map is in Trash or has the title "${database.title}".`);
			return database.title;
		}),
	);
	const owners = [...Object.values(map.databases), ...Object.values(map.pages)];
	const views = await Promise.all(owners.flatMap((owner) => Object.entries(owner.views).map(([name, url]) => viewName(url, name).then((n) => `${owner.title}: ${n}`))));
	const pages = await Promise.all([pageTitle(map.root, map.root.title), ...Object.values(map.pages).map((page) => pageTitle(page, page.title))]);
	const templates = await Promise.all(Object.entries(map.templates).map(([title, item]) => pageTitle(item, title)));
	return { databases, views, pages, templates };
}

function parseArgs(argv: readonly string[]): Record<string, string> {
	const flags: Record<string, string> = {};
	for (let i = 0; i < argv.length; i++) {
		const name = argv[i] ?? "";
		if (name === "--check") flags["check"] = "true";
		else if (["--root-title", "--map", "--workspace-id", "--ledger", "--ledger-tag"].includes(name) && argv[i + 1] !== undefined) flags[name.slice(2)] = argv[++i] ?? "";
		else fail(`Unknown option or missing value: ${name}. Read the header of notion-setup.ts for the options.`);
	}
	return flags;
}

async function main(): Promise<void> {
	const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
	const flags = parseArgs(process.argv.slice(2));
	const mapFlag = flags["map"] ?? NOTION_MAP_FILE;
	const mapPath = isAbsolute(mapFlag) ? mapFlag : join(repoRoot, mapFlag);
	const tag = flags["ledger-tag"]?.split("=");
	const client = await createNotionClient();
	try {
		if (flags["check"] !== undefined) {
			const result = await checkMap(client, readNotionMap(mapPath));
			for (const [kind, titles] of Object.entries(result)) console.log(`${kind} (${titles.length}): ${[...titles].sort().join(", ")}`);
			console.log(`fetched: ${result.databases.length} databases, ${result.views.length} views, ${result.pages.length} pages, ${result.templates.length} templates`);
			return;
		}
		const numeric = tag?.[1] !== undefined && /^\d+$/.test(tag[1]) ? Number(tag[1]) : tag?.[1];
		const result = await runSetup(client, {
			rootTitle: flags["root-title"] ?? "obsidian-mind",
			mapPath,
			...(flags["workspace-id"] === undefined ? {} : { workspaceId: flags["workspace-id"] }),
			...(flags["ledger"] === undefined ? {} : { ledgerPath: flags["ledger"] }),
			...(tag?.[0] === undefined ? {} : { ledgerTag: [tag[0], numeric] as const }),
			readSource: (source) => readFileSync(join(repoRoot, SCAFFOLD_SOURCES[source]), "utf8"),
			log: (line) => console.log(line),
		});
		const { probe_row: probeRows, ...kept } = result.created;
		const total = Object.values(kept).reduce((sum, count) => sum + count, 0);
		console.log(`created ${total} objects: ${Object.entries(kept).map(([kind, count]) => `${count} ${kind}`).join(", ")}`);
		console.log(`test rows made and removed: ${probeRows}`);
		console.log(`map file written: ${flags["map"] ?? NOTION_MAP_FILE}`);
	} finally {
		await client.close();
	}
}

if (isMainModule(import.meta.url)) {
	main().catch((error: unknown) => {
		console.error(error instanceof NotionError ? `notion-setup: ${error.code}: ${error.message}` : `notion-setup: ${error instanceof Error ? error.message : String(error)}`);
		process.exit(1);
	});
}
