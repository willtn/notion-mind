#!/usr/bin/env node
/**
 * PostToolUse hook: the write check.
 *
 * For `Bash`, it acts on a Notion write in the outbox form of
 * lib/notion-write.ts. It reads the notes that the call wrote, prints the
 * hygiene warnings of each one, sets the derived properties of each row,
 * and deletes the outbox file. For a failed write (`PostToolUseFailure`),
 * it adds the select options that the write needs and leaves the file.
 *
 * For `Write` and `Edit`, it flags a file in the automatic memory
 * directory of the home directory (lib/write-targets.ts).
 */

import { basename } from "node:path";
import { realpathSync } from "node:fs";
import { debug, readStdinJson, writeHookOutput, type PolicyResult } from "./lib/hook-io.ts";
import { isBlockedMemoryPath } from "./lib/frontmatter.ts";
import { isNotionCommand } from "./lib/notion-write.ts";
import { resolveProjectDir } from "./lib/project-dir.ts";
import type { NoteFindings } from "./lib/write-check.ts";
import { writeTargets } from "./lib/write-targets.ts";

type HookInput = {
	readonly hook_event_name?: unknown;
	readonly cwd?: unknown;
	readonly tool_name?: unknown;
	readonly tool_input?: { readonly command?: unknown } | null;
};

const input = await readStdinJson<HookInput>();
if (!input) {
	debug("validate: null input");
	process.exit(0);
}

const vaultRoot = resolveProjectDir(process.cwd());

function checkFile(filePath: string): NoteFindings {
	const blocks: string[] = [];
	const policyResults: PolicyResult[] = [];

	// Only MEMORY.md (the auto-loaded index) belongs in the auto-memory
	// directory — durable knowledge goes to the brain topic rows of Knowledge per
	// .claude/rules/memory.md. PostToolUse can't block the write, but a loud
	// warning makes the violation immediately visible so the file gets
	// migrated before the index drifts. The predicate checks the
	// lexically-normalized path AND the realpath-resolved one (the file
	// exists by PostToolUse time), so neither `..` spellings nor symlinks
	// dodge it.
	let resolvedPath = filePath;
	try {
		resolvedPath = realpathSync(filePath);
	} catch {
		/* unreadable/racing path — lexical check below still applies */
	}
	if (isBlockedMemoryPath(filePath) || isBlockedMemoryPath(resolvedPath)) {
		const file = basename(filePath.replaceAll("\\", "/"));
		debug(`validate: misplaced memory file detected — ${file}`);
		blocks.push(
			[
				`⚠️  Memory location violation: \`${file}\` was written to \`~/.claude/.../memory/\`.`,
				"",
				"Per .claude/rules/memory.md, this directory should contain only MEMORY.md (the auto-loaded index).",
				"All durable knowledge belongs in the brain topic rows of `Knowledge`:",
				"",
				"- Patterns/conventions → the `Patterns` row of `Knowledge`",
				"- Things that bit before → the `Gotchas` row of `Knowledge`",
				"- Architectural/workflow decisions → the `Key Decisions` row of `Knowledge`",
				"- Recent context, relationships, tools → the Recent Context section of `North Star`",
				"- New topic → a new `Knowledge` row with `Type` Brain topic",
				"",
				`Migrate the content from \`${file}\` into the right brain note, then delete the file from \`~/.claude/\`.`,
				"`MEMORY.md` itself can keep an index pointer to the brain note(s).",
			].join("\n"),
		);
		policyResults.push({
			policy_id: "memory-location",
			path: filePath,
			classification: "misplaced-memory",
			suggested_target: "the brain topic rows of `Knowledge`",
			action: "warn",
		});
	}
	return { blocks, policyResults };
}

const NO_FINDINGS: NoteFindings = { blocks: [], policyResults: [] };

/** The hook runs for each `Bash` call, so the Notion part loads only for a command that can be a Notion write. */
async function checkCommand(payload: HookInput): Promise<NoteFindings[]> {
	const command = payload.tool_name === "Bash" ? payload.tool_input?.command : undefined;
	if (typeof command !== "string" || !isNotionCommand(command, [])) {
		debug("validate: no file_path and no Notion command");
		return [];
	}
	const { checkBash } = await import("./lib/write-hook.ts");
	return checkBash(payload, vaultRoot);
}

const targets = writeTargets(input);
const findings =
	targets.length > 0
		? targets.map((target): NoteFindings => {
				try {
					return checkFile(target);
				} catch (error) {
					debug(`validate: ${target} — check failed: ${error instanceof Error ? error.message : String(error)}`);
					return NO_FINDINGS;
				}
			})
		: await checkCommand(input);

// One envelope for the call. A note that throws costs only its own findings.
const blocks = [...new Set(findings.flatMap((f) => f.blocks))];
if (blocks.length > 0) {
	const eventName = typeof input.hook_event_name === "string" ? input.hook_event_name : "PostToolUse";
	const policies = new Map(findings.flatMap((f) => f.policyResults).map((p) => [JSON.stringify(p), p] as const));
	writeHookOutput(eventName, blocks.join("\n\n"), [...policies.values()]);
}

process.exit(0);
