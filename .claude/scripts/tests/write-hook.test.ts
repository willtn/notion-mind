/**
 * The time budget of the Notion calls of one hook run (lib/write-hook.ts).
 * The process tests of validate-write.ts cover the rest of the module.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { NotionTransport } from "../lib/notion-client.ts";
import { lazyNotion } from "../lib/write-hook.ts";

const text = (value: string, isError = false) => ({ content: [{ type: "text", text: value }], ...(isError ? { isError: true } : {}) });
const OK = text('{"result":"ok"}');
const LIMITED = text("The Notion API rate limit was reached. Wait at least 9 seconds before retrying this tool call.", true);
const never = (): Promise<unknown> => new Promise(() => {});

/** A transport that answers each call with `answer`, and that counts the calls and the closes. */
function transport(answer: (tool: string, call: number) => Promise<unknown>): { readonly transport: NotionTransport; readonly calls: string[]; readonly closed: () => number } {
	const calls: string[] = [];
	let closed = 0;
	return {
		transport: { callTool: (tool) => answer(tool, calls.push(tool)), close: async () => void closed++ },
		calls,
		closed: () => closed,
	};
}

describe("the Notion calls of one hook run", () => {
	test("two calls share one client, and the close ends it", async () => {
		const fake = transport(async () => OK);
		const notion = lazyNotion(1_000, fake);
		const replies = await Promise.all([notion.call("notion-fetch", {}), notion.call("notion-update-page", {})]);
		assert.deepEqual(replies.map(({ json }) => json), [{ result: "ok" }, { result: "ok" }]);
		await notion.close();
		assert.deepEqual([fake.calls.length, fake.closed()], [2, 1]);
	});

	test("a run with no call closes nothing", async () => {
		const fake = transport(async () => OK);
		await lazyNotion(1_000, fake).close();
		assert.equal(fake.closed(), 0);
	});

	test("a call with no reply inside the budget is an error that names the tool, and a call after the budget fails at once", async () => {
		const fake = transport(never);
		const notion = lazyNotion(40, fake);
		await assert.rejects(notion.call("notion-query-data-sources", {}), /notion-query-data-sources got no reply in the 0\.04 s that the hook has for Notion/);
		const started = performance.now();
		await assert.rejects(notion.call("notion-update-page", {}), /notion-update-page got no reply/);
		assert.ok(performance.now() - started < 20);
		assert.deepEqual(fake.calls, ["notion-query-data-sources"]);
	});

	test("a slow call costs only itself: a call that answers inside the budget gives its reply", async () => {
		const fake = transport((tool) => (tool === "notion-query-data-sources" ? never() : Promise.resolve(OK)));
		const notion = lazyNotion(40, fake);
		const [slow, fast] = await Promise.allSettled([notion.call("notion-query-data-sources", {}), notion.call("notion-update-page", {})]);
		assert.deepEqual([slow.status, fast.status], ["rejected", "fulfilled"]);
	});

	test("a call runs one more time after a rate limit, after the wait that Notion names", async () => {
		const waits: number[] = [];
		let clock = 0;
		const sleep = async (ms: number): Promise<void> => {
			waits.push(ms);
			clock += ms;
		};
		const fake = transport(async (_tool, call) => (call === 1 ? LIMITED : OK));
		const notion = lazyNotion(1_000, { ...fake, sleep, now: () => clock });
		assert.deepEqual((await notion.call("notion-update-page", {})).json, { result: "ok" });
		assert.deepEqual([fake.calls.length, waits.length], [2, 1]);
		assert.deepEqual(waits, [9_000]);
	});

	test("a rate limit with a wait that is longer than the time that is left ends the call at once, with the wait in the error", async () => {
		const fake = transport(async () => LIMITED);
		const notion = lazyNotion(2_000, { transport: fake.transport });
		const started = performance.now();
		await assert.rejects(notion.call("notion-update-page", {}), /Notion limits the rate and names a wait of 9 s, and the hook has [12] s left/);
		assert.ok(performance.now() - started < 500);
		assert.equal(fake.calls.length, 1);
	});

	test("a second rate limit is an error, so the hook says that the properties are not set", async () => {
		const fake = transport(async () => LIMITED);
		let clock = 0;
		const notion = lazyNotion(1_000, { ...fake, sleep: async (ms) => void (clock += ms), now: () => clock });
		await assert.rejects(notion.call("notion-update-page", {}), /Notion still limits the rate after 1 retries/);
		assert.equal(fake.calls.length, 2);
	});
});
