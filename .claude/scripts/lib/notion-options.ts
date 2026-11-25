/**
 * A select or a multi-select of Notion rejects a value that its schema does
 * not hold, so a writer adds the option first:
 *
 *     await ensureSelectOptions(notion, map.databases.work, { Quarter: ["Q1-2026"], Tags: ["meeting"] });
 *     await notion.call("notion-create-pages", { ... });
 *
 * The call reads the live schema and adds only the options that are
 * missing, so a second call changes nothing.
 */

import type { NotionClient } from "./notion-client.ts";
import type { MapDatabase } from "./notion-map.ts";
import { selectColumn } from "./notion-model.ts";
import { parseDatabase, type LiveProperty } from "./notion-parse.ts";

/** The values that a write puts in each select or multi-select, by property name. */
export type WantedOptions = Readonly<Record<string, readonly string[]>>;

/** The schema statements that add each wanted option that `live` lacks, and the number of new options. */
export function optionStatements(live: Readonly<Record<string, LiveProperty>>, wanted: WantedOptions): { statements: string[]; added: number } {
	const statements: string[] = [];
	let added = 0;
	for (const [name, values] of Object.entries(wanted)) {
		const property = live[name];
		if (property === undefined || (property.type !== "select" && property.type !== "multi_select")) {
			throw new Error(`"${name}" is not a select or a multi-select of the data source, so it cannot get an option.`);
		}
		const missing = [...new Set(values)].filter((value) => !property.options.some((option) => option.name === value));
		// Notion reads a comma as the end of an option in a multi-select value.
		const invalid = missing.find((value) => value.trim() === "" || value.includes(","));
		if (invalid !== undefined) throw new Error(`"${invalid}" cannot be an option of "${name}": an option is not empty and has no comma.`);
		if (missing.length === 0) continue;
		statements.push(`ALTER COLUMN "${name}" SET ${selectColumn(property.type, property.options, missing)}`);
		added += missing.length;
	}
	return { statements, added };
}

/** Add each wanted option that the schema of `database` lacks. Returns the number of options that the call added. */
export async function ensureSelectOptions(client: NotionClient, database: Pick<MapDatabase, "id" | "data_source">, wanted: WantedOptions): Promise<number> {
	const live = parseDatabase(await client.call("notion-fetch", { id: database.id })).properties;
	const { statements, added } = optionStatements(live, wanted);
	if (statements.length > 0) {
		await client.call("notion-update-data-source", { data_source_id: database.data_source, statements: statements.join("; ") });
	}
	return added;
}
