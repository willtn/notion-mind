/**
 * The one path from this repository to Notion: the `notion` server of
 * `mcporter`, called in-process through the `mcporter` runtime.
 *
 * `mcporter` is a tool on the machine, not an npm dependency. The runtime
 * is imported from the folder that the `mcporter` executable on PATH
 * resolves to, so `package.json` stays without dependencies.
 *
 *     const notion = await createNotionClient();
 *     const reply = await notion.call("notion-fetch", { id });
 *     await notion.close();
 *
 * Each call waits for a free slot (the concurrency limit), then for the
 * request budget, then runs. A `rate_limited` reply holds every call for the
 * time that the reply names, and the call runs again a bounded number of
 * times. All failures are a `NotionError` with a `code`.
 */

import { existsSync, realpathSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

export type NotionErrorCode =
	| "mcporter_missing"
	| "server_missing"
	| "login_missing"
	| "rate_limited"
	| "plan_required"
	| "timeout"
	| "tool_error"
	| "transport";

export class NotionError extends Error {
	readonly code: NotionErrorCode;
	readonly tool: string | undefined;

	constructor(code: NotionErrorCode, message: string, tool?: string) {
		super(message);
		this.name = "NotionError";
		this.code = code;
		this.tool = tool;
	}
}

/** One reply, with the `{{ }}` URL wrappers removed. */
export interface NotionReply {
	readonly text: string;
	/** The parsed text, or `undefined` when the text is not JSON. */
	readonly json: unknown;
}

export interface NotionClient {
	call(tool: string, args?: Readonly<Record<string, unknown>>): Promise<NotionReply>;
	close(): Promise<void>;
}

/** The seam for tests: one raw MCP tool call and a close. */
export interface NotionTransport {
	callTool(tool: string, args: Readonly<Record<string, unknown>>, timeoutMs: number): Promise<unknown>;
	close(): Promise<void>;
}

export interface NotionClientOptions {
	/** Calls in flight at one time. */
	readonly concurrency?: number;
	/** Repeats of one call after a `rate_limited` reply. */
	readonly maxRetries?: number;
	readonly timeoutMs?: number;
	/**
	 * Calls that start in each 60 s. The measured limit of the workspace plan
	 * is 180. The default leaves room for other sessions of the same login.
	 */
	readonly requestsPerMinute?: number;
	readonly transport?: NotionTransport;
	readonly sleep?: (ms: number) => Promise<void>;
	readonly now?: () => number;
	readonly env?: NodeJS.ProcessEnv;
}

const SERVER = "notion";
const WINDOW_MS = 60_000;
const DEFAULT_WAIT_MS = 10_000;

export type ReplyOutcome =
	| { readonly kind: "ok"; readonly reply: NotionReply }
	| { readonly kind: "rate_limited"; readonly waitMs: number }
	| { readonly kind: "error"; readonly code: NotionErrorCode; readonly message: string };

/** `{{https://…}}`, `{{collection://…}}` and `{{view://…}}` become the bare URL. A `{{title}}` placeholder has no scheme and stays. */
export function unwrapUrls(text: string): string {
	return text.replace(/\{\{([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^{}\s]*)\}\}/g, "$1");
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

function rawText(raw: unknown): string {
	if (!isRecord(raw) || !Array.isArray(raw["content"])) return "";
	return raw["content"].map((part) => (isRecord(part) && typeof part["text"] === "string" ? part["text"] : "")).join("");
}

/** Sort one raw MCP result into a reply, a rate limit with its wait, or an error. */
export function classifyReply(raw: unknown): ReplyOutcome {
	const text = rawText(raw);
	const failed = isRecord(raw) && raw["isError"] === true;
	// The limit text must open the reply. A page that quotes the same words is content, not a limit.
	if (/^\s*The Notion API rate limit was reached/.test(text) || (failed && /"code"\s*:\s*"rate_limited"/.test(text))) {
		const seconds = text.match(/Wait at least (\d+) seconds?/i)?.[1];
		return { kind: "rate_limited", waitMs: seconds === undefined ? DEFAULT_WAIT_MS : Number(seconds) * 1000 };
	}
	if (failed) {
		const body = parseJson(text);
		const code = isRecord(body) && typeof body["code"] === "string" ? body["code"] : "";
		const message = isRecord(body) && typeof body["message"] === "string" ? body["message"] : text;
		if (/plan_required|upgrade_required|full_version_required/.test(text)) {
			return { kind: "error", code: "plan_required", message };
		}
		if (code === "unauthorized" || (isRecord(body) && body["status"] === 401)) {
			return { kind: "error", code: "login_missing", message: loginHint(message) };
		}
		return { kind: "error", code: "tool_error", message: code === "" ? message : `${code}: ${message}` };
	}
	const unwrapped = unwrapUrls(text);
	return { kind: "ok", reply: { text: unwrapped, json: parseJson(unwrapped) } };
}

const loginHint = (cause: string): string =>
	`The Notion login of mcporter is missing or expired (${cause}). Run \`mcporter auth notion\`, then try again.`;

/** The `mcporter` executable on PATH, or `null`. `which` is not used, because it is not on Windows. */
export function findMcporter(env: NodeJS.ProcessEnv = process.env, platform: string = process.platform): string | null {
	const names = platform === "win32" ? ["mcporter.cmd", "mcporter.exe", "mcporter"] : ["mcporter"];
	for (const dir of (env["PATH"] ?? env["Path"] ?? "").split(delimiter)) {
		if (dir === "") continue;
		for (const name of names) {
			const candidate = join(dir, name);
			if (existsSync(candidate)) return candidate;
		}
	}
	return null;
}

/**
 * The runtime module that belongs to an `mcporter` executable. A symlink in
 * a bin folder resolves to `dist/cli.js`, with `index.js` beside it. An npm
 * shim (Windows, or a prefix without symlinks) has the package under a
 * `node_modules` folder near it.
 */
export function mcporterRuntimePath(executable: string): string | null {
	const binDir = dirname(executable);
	const candidates = [
		join(dirname(realpathSync(executable)), "index.js"),
		join(binDir, "node_modules", "mcporter", "dist", "index.js"),
		join(binDir, "..", "lib", "node_modules", "mcporter", "dist", "index.js"),
	];
	return candidates.find((path) => existsSync(path)) ?? null;
}

async function connectMcporter(env: NodeJS.ProcessEnv): Promise<NotionTransport> {
	const executable = findMcporter(env);
	if (executable === null) {
		throw new NotionError("mcporter_missing", "mcporter is not on PATH. Install it (`npm install -g mcporter`), add the `notion` server, and run `mcporter auth notion`.");
	}
	const runtimePath = mcporterRuntimePath(executable);
	if (runtimePath === null) {
		throw new NotionError("mcporter_missing", `The mcporter runtime (dist/index.js) was not found near ${executable}.`);
	}
	const module: unknown = await import(pathToFileURL(runtimePath).href);
	if (!isRecord(module) || typeof module["createRuntime"] !== "function") {
		throw new NotionError("mcporter_missing", `${runtimePath} does not export createRuntime.`);
	}
	const runtime: unknown = await module["createRuntime"]();
	if (!isRecord(runtime) || typeof runtime["callTool"] !== "function" || typeof runtime["listServers"] !== "function") {
		throw new NotionError("mcporter_missing", "The mcporter runtime has no callTool or listServers.");
	}
	const servers: unknown = runtime["listServers"]();
	if (!Array.isArray(servers) || !servers.includes(SERVER)) {
		throw new NotionError("server_missing", "mcporter has no `notion` server. Add it with `mcporter config add notion https://mcp.notion.com/mcp`, then run `mcporter auth notion`.");
	}
	const callTool = runtime["callTool"].bind(runtime) as (server: string, tool: string, options: unknown) => Promise<unknown>;
	const close = typeof runtime["close"] === "function" ? (runtime["close"].bind(runtime) as () => Promise<void>) : async () => {};
	return {
		// `disableOAuth` keeps a missing login from opening a browser and waiting for it.
		callTool: (tool, args, timeoutMs) => callTool(SERVER, tool, { args, timeoutMs, disableOAuth: true }),
		close,
	};
}

function transportError(error: unknown, tool: string): NotionError {
	if (error instanceof NotionError) return error;
	const message = error instanceof Error ? error.message : String(error);
	if (/\b401\b|unauthori[sz]ed|invalid_token|oauth/i.test(message)) return new NotionError("login_missing", loginHint(message), tool);
	if (/timed? ?out|timeout/i.test(message)) return new NotionError("timeout", `${tool} did not answer in time: ${message}`, tool);
	return new NotionError("transport", `${tool} failed before a reply: ${message}`, tool);
}

export async function createNotionClient(options: NotionClientOptions = {}): Promise<NotionClient> {
	const concurrency = options.concurrency ?? 4;
	const maxRetries = options.maxRetries ?? 3;
	const timeoutMs = options.timeoutMs ?? 60_000;
	const budget = options.requestsPerMinute ?? 150;
	const now = options.now ?? Date.now;
	const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
	const transport = options.transport ?? (await connectMcporter(options.env ?? process.env));

	let inFlight = 0;
	const waiting: (() => void)[] = [];
	let resumeAt = 0;
	const starts: number[] = [];

	const acquire = async (): Promise<void> => {
		if (inFlight < concurrency) {
			inFlight++;
			return;
		}
		await new Promise<void>((resolve) => waiting.push(resolve));
	};
	const release = (): void => {
		const next = waiting.shift();
		if (next === undefined) inFlight--;
		else next();
	};

	/** Hold until the rate-limit pause is over and the 60 s window has room, then count this start. */
	const waitForBudget = async (): Promise<void> => {
		for (;;) {
			const at = now();
			while (starts.length > 0 && at - (starts[0] ?? 0) >= WINDOW_MS) starts.shift();
			const oldest = starts[0];
			const until = Math.max(resumeAt, starts.length >= budget && oldest !== undefined ? oldest + WINDOW_MS : 0);
			if (until <= at) {
				starts.push(at);
				return;
			}
			await sleep(until - at);
		}
	};

	const attempt = async (tool: string, args: Readonly<Record<string, unknown>>): Promise<NotionReply> => {
		for (let retries = 0; ; retries++) {
			await waitForBudget();
			let raw: unknown;
			try {
				raw = await transport.callTool(tool, args, timeoutMs);
			} catch (error) {
				throw transportError(error, tool);
			}
			const outcome = classifyReply(raw);
			if (outcome.kind === "ok") return outcome.reply;
			if (outcome.kind === "error") throw new NotionError(outcome.code, `${tool}: ${outcome.message}`, tool);
			if (retries >= maxRetries) {
				throw new NotionError("rate_limited", `${tool}: Notion still limits the rate after ${maxRetries} retries.`, tool);
			}
			resumeAt = Math.max(resumeAt, now() + outcome.waitMs);
		}
	};

	return {
		async call(tool, args = {}) {
			await acquire();
			try {
				return await attempt(tool, args);
			} finally {
				release();
			}
		},
		close: () => transport.close(),
	};
}
