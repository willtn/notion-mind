/**
 * Live checks against Notion. They need `mcporter` with a Notion login and
 * the map file that the setup writes, so they run only with NOTION_LIVE=1
 * and skip in each other run. They read and make no change.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createNotionClient } from "../lib/notion-client.ts";
import { NOTION_MAP_FILE, readNotionMap } from "../lib/notion-map.ts";
import { DATABASES } from "../lib/notion-model.ts";
import { parseWorkspaceId } from "../lib/notion-parse.ts";
import { checkMap } from "../notion-setup.ts";

const mapPath = join(resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", ".."), NOTION_MAP_FILE);
const live = process.env["NOTION_LIVE"] === "1";

describe("Notion, live", () => {
	test("the client reaches the workspace of the map file", { skip: !live || !existsSync(mapPath) }, async () => {
		const client = await createNotionClient();
		try {
			assert.equal(parseWorkspaceId(await client.call("notion-get-self")), readNotionMap(mapPath).workspace_id);
		} finally {
			await client.close();
		}
	});

	test("each database, view, page, and template of the map file is live", { skip: !live || !existsSync(mapPath) }, async () => {
		const client = await createNotionClient();
		try {
			const result = await checkMap(client, readNotionMap(mapPath));
			assert.deepEqual([...result.databases].sort(), DATABASES.map((d) => d.title).sort());
		} finally {
			await client.close();
		}
	});
});
