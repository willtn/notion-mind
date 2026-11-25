/**
 * lib/notion-client.ts: the reply sorter, the pace on a rate limit, the
 * concurrency limit, and the errors for a missing `mcporter` or login.
 * The replies are captured from the hosted Notion MCP server, with the IDs
 * replaced. No test needs a login.
 */

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyReply, createNotionClient, findMcporter, mcporterRuntimePath, NotionError, unwrapUrls, type NotionTransport } from "../lib/notion-client.ts";
import { rmTemp } from "./_helpers.ts";

const text = (value: string, isError = false): unknown => ({ content: [{ type: "text", text: value }], isError });

const RATE_LIMITED = text(
	'The Notion API rate limit was reached. Wait at least 9 seconds before retrying this tool call. Do not retry immediately or in parallel.\n\n{"error":{"code":"rate_limited","classification":"rate_limit","operation":"get_self","message":"The Notion API rate limit was reached."}}',
);
const VALIDATION_ERROR = text(
	'{"name":"APIResponseError","code":"validation_error","status":400,"headers":{},"body":"{}","message":"Exactly one of `database_id` or `parent_page_id` must be provided."}',
	true,
);
const SELF = text('{"workspace":{"id":"11111111-1111-4111-8111-111111111111","name":"w"},"user":{"type":"person"}}');

/** A transport that answers from a list, then with the last entry, and a clock that only `sleep` moves. */
function harness(replies: readonly unknown[]) {
	let clock = 0;
	const calls: number[] = [];
	const sleeps: number[] = [];
	const transport: NotionTransport = {
		async callTool() {
			calls.push(clock);
			const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
			if (reply instanceof Error) throw reply;
			return reply;
		},
		async close() {},
	};
	const options = {
		transport,
		now: () => clock,
		sleep: async (ms: number) => {
			sleeps.push(ms);
			clock += ms;
		},
	};
	return { options, calls, sleeps };
}

describe("unwrapUrls", () => {
	test("removes the wrapper of each URL scheme and keeps a template placeholder", () => {
		const wrapped = '<database url="{{https://app.notion.com/p/abc}}"> {{collection://1-2}} {{view://3-4}} # {{title}} on {{date}}';
		assert.equal(unwrapUrls(wrapped), '<database url="https://app.notion.com/p/abc"> collection://1-2 view://3-4 # {{title}} on {{date}}');
	});
});

describe("classifyReply", () => {
	test("a reply becomes text without wrappers, and JSON when the text is JSON", () => {
		const outcome = classifyReply(text('{"result":"Created database: <database url=\\"{{https://app.notion.com/p/abc}}\\">"}'));
		assert.equal(outcome.kind, "ok");
		assert.deepEqual(outcome.kind === "ok" && outcome.reply.json, { result: 'Created database: <database url="https://app.notion.com/p/abc">' });
	});

	test("a rate limit carries the wait that the reply names", () => {
		assert.deepEqual(classifyReply(RATE_LIMITED), { kind: "rate_limited", waitMs: 9000 });
	});

	test("page content that quotes the rate limit text is a reply, not a limit", () => {
		const page = text('{"text":"<content>The record says: The Notion API rate limit was reached.</content>"}');
		assert.equal(classifyReply(page).kind, "ok");
	});

	test("a tool error keeps the code and the message of Notion", () => {
		assert.deepEqual(classifyReply(VALIDATION_ERROR), {
			kind: "error",
			code: "tool_error",
			message: "validation_error: Exactly one of `database_id` or `parent_page_id` must be provided.",
		});
	});

	test("a plan limit and a rejected login have their own codes", () => {
		const plan = classifyReply(text('{"code":"plan_required","message":"Upgrade."}', true));
		const login = classifyReply(text('{"code":"unauthorized","status":401,"message":"No token."}', true));
		assert.equal(plan.kind === "error" && plan.code, "plan_required");
		assert.equal(login.kind === "error" && login.code, "login_missing");
	});
});

describe("createNotionClient", () => {
	test("waits the named time after a rate limit, then returns the reply", async () => {
		const { options, calls, sleeps } = harness([RATE_LIMITED, SELF]);
		const client = await createNotionClient(options);
		const reply = await client.call("notion-get-self");
		assert.deepEqual(sleeps, [9000]);
		assert.equal(calls.length, 2);
		assert.match(reply.text, /"workspace"/);
	});

	test("fails with rate_limited after the bounded retries", async () => {
		const { options, calls } = harness([RATE_LIMITED]);
		const client = await createNotionClient({ ...options, maxRetries: 2 });
		await assert.rejects(client.call("notion-get-self"), (error: unknown) => error instanceof NotionError && error.code === "rate_limited" && /after 2 retries/.test(error.message));
		assert.equal(calls.length, 3);
	});

	test("a tool error is a NotionError that names the tool", async () => {
		const { options } = harness([VALIDATION_ERROR]);
		const client = await createNotionClient(options);
		await assert.rejects(client.call("notion-create-view"), (error: unknown) => error instanceof NotionError && error.code === "tool_error" && error.tool === "notion-create-view");
	});

	test("a 401 from the transport is login_missing with the command that fixes it", async () => {
		const { options } = harness([new Error("SSE error: Non-200 status code (401)")]);
		const client = await createNotionClient(options);
		await assert.rejects(client.call("notion-get-self"), (error: unknown) => error instanceof NotionError && error.code === "login_missing" && /mcporter auth notion/.test(error.message));
	});

	test("never runs more calls at one time than the concurrency limit", async () => {
		let inFlight = 0;
		let peak = 0;
		const transport: NotionTransport = {
			async callTool() {
				peak = Math.max(peak, ++inFlight);
				await new Promise((resolve) => setImmediate(resolve));
				inFlight--;
				return SELF;
			},
			async close() {},
		};
		const client = await createNotionClient({ transport, concurrency: 3 });
		await Promise.all(Array.from({ length: 12 }, () => client.call("notion-get-self")));
		assert.equal(peak, 3);
	});

	test("holds a call when the 60 s request budget is used", async () => {
		const { options, calls, sleeps } = harness([SELF]);
		const client = await createNotionClient({ ...options, requestsPerMinute: 2 });
		for (let i = 0; i < 3; i++) await client.call("notion-get-self");
		assert.deepEqual(sleeps, [60_000]);
		assert.deepEqual(calls, [0, 0, 60_000]);
	});

	test("a machine without mcporter gets mcporter_missing, not a hang", async () => {
		await assert.rejects(createNotionClient({ env: { PATH: "" } }), (error: unknown) => error instanceof NotionError && error.code === "mcporter_missing");
	});
});

describe("the mcporter runtime path", () => {
	let dir = "";
	afterEach(() => rmTemp(dir));

	test("follows the executable on PATH to the index.js beside its target", { skip: process.platform === "win32" }, () => {
		dir = mkdtempSync(join(tmpdir(), "notion-client-"));
		const dist = join(dir, "lib", "node_modules", "mcporter", "dist");
		mkdirSync(dist, { recursive: true });
		mkdirSync(join(dir, "bin"));
		writeFileSync(join(dist, "cli.js"), "");
		writeFileSync(join(dist, "index.js"), "");
		symlinkSync(join(dist, "cli.js"), join(dir, "bin", "mcporter"));
		const executable = findMcporter({ PATH: join(dir, "bin") }, "linux");
		assert.equal(executable, join(dir, "bin", "mcporter"));
		assert.match(mcporterRuntimePath(executable ?? "") ?? "", /mcporter[\\/]dist[\\/]index\.js$/);
	});

	test("an empty PATH finds nothing", () => {
		assert.equal(findMcporter({ PATH: "" }), null);
	});
});
