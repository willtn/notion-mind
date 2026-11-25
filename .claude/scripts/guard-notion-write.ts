#!/usr/bin/env node
/**
 * PreToolUse hook on `Bash`. It denies a Notion write that is not in the
 * outbox form (lib/notion-write.ts), because no hook can check such a write.
 *
 * It prints nothing for each other command, so the permission rules of the
 * session still decide. It makes no Notion call.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { debug, readStdinJson } from "./lib/hook-io.ts";
import { decide, parseCommand } from "./lib/notion-write.ts";

type HookInput = {
	readonly cwd?: unknown;
	readonly tool_name?: unknown;
	readonly tool_input?: { readonly command?: unknown } | null;
};

const input = await readStdinJson<HookInput>();
const command = input?.tool_name === "Bash" ? input.tool_input?.command : undefined;
if (typeof command !== "string") {
	debug("guard: no Bash command");
	process.exit(0);
}

// The shell reads the outbox file from its own working directory, so the guard reads the same file.
const cwd = typeof input?.cwd === "string" ? input.cwd : process.cwd();
const readOutbox = (outbox: string): string | null => {
	try {
		return readFileSync(resolve(cwd, outbox), "utf-8");
	} catch {
		return null;
	}
};

const parsed = parseCommand(command, readOutbox);
const decision = decide(parsed);
debug(`guard: ${parsed.kind} -> ${decision.kind}`);
if (decision.kind === "deny") {
	process.stdout.write(
		JSON.stringify({
			hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: decision.reason },
		}),
	);
}
