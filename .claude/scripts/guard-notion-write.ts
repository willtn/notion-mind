#!/usr/bin/env node
/**
 * PreToolUse hook on `Bash`. It denies each command that names `mcporter` and
 * Notion, or the runtime folder of `mcporter`, and is not in a form of the
 * allow list (lib/notion-write.ts).
 *
 * It prints nothing for each other command, so the permission rules of the
 * session still decide. It makes no Notion call.
 *
 * Claude Code runs the call when this hook exits with an error. So the body
 * is in one handler that denies on each error, and the modules of this
 * repository load in the handler too. A failed lookup of `mcporter` denies
 * each command that names `mcporter` or Notion (decideWithoutRuntime).
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const deny = (reason: string): void => {
	process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } }));
};

try {
	const { bashCommand, decide, decideWithoutRuntime, parseCommand } = await import("./lib/notion-write.ts");
	const { findMcporter, mcporterRuntimePath } = await import("./lib/notion-client.ts");

	type RuntimeLookup = { readonly paths: string[] } | { readonly failure: string };
	const lookupRuntime = (): RuntimeLookup => {
		try {
			const executable = findMcporter();
			// A machine with no `mcporter`, or with one that does not resolve, has no runtime to name.
			const runtime = executable === null ? null : mcporterRuntimePath(executable);
			return { paths: runtime === null ? [] : [dirname(runtime)] };
		} catch (error) {
			return { failure: error instanceof Error ? error.message : String(error) };
		}
	};

	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
	const payload: unknown = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
	const command = bashCommand(payload);
	if (command !== null) {
		// The shell reads the outbox file from its own working directory, so the guard reads the same file.
		const cwd = (payload as { readonly cwd?: unknown }).cwd;
		const readOutbox = (outbox: string): string | null => {
			try {
				return readFileSync(resolve(typeof cwd === "string" ? cwd : process.cwd(), outbox), "utf-8");
			} catch {
				return null;
			}
		};
		const runtime = lookupRuntime();
		const decision = "failure" in runtime ? decideWithoutRuntime(command, runtime.failure) : decide(parseCommand(command, { readOutbox, runtimePaths: runtime.paths }));
		if (decision.kind === "deny") deny(decision.reason);
	}
} catch (error) {
	deny(`The Notion guard failed, so it denied this Bash command: ${error instanceof Error ? error.message : String(error)}\nRepair .claude/scripts/guard-notion-write.ts, then run the command again.`);
}
