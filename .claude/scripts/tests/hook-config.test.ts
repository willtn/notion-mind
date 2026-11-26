/**
 * Hook config regression tests.
 *
 * These tests lock in the CWD-independent hook invocation pattern from
 * issue #45 / commit 0f36db7. Every hook command in the Claude Code config
 * must resolve its script path through CLAUDE_PROJECT_DIR
 * so the hook keeps working when the invoking shell's CWD
 * drifts away from the project root.
 *
 * The original failure mode: a drifted shell CWD caused relative paths
 * like `.claude/scripts/stop-checklist.ts` to resolve against the wrong
 * directory and fail with MODULE_NOT_FOUND. An earlier fix (0f36db7)
 * was reverted (89bb963) without a recorded rationale; the replacement
 * fix re-applies the same pattern. This test exists so the revert
 * doesn't silently happen a third time.
 *
 * Claude Code's commands go one step further (#263): CLAUDE_PROJECT_DIR is
 * the folder the session was launched in and does not follow `/cd`, so it can
 * name a vault subfolder. They start from `${CLAUDE_PROJECT_DIR:-.}` and
 * walk up to the nearest folder holding vault-manifest.json. The last block
 * runs each real command to prove it.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { nearestVaultRoot } from "../lib/project-dir.ts";

type HookConfig = {
	readonly hooks?: Record<
		string,
		ReadonlyArray<{
			readonly matcher?: string;
			readonly hooks?: ReadonlyArray<{
				readonly type?: string;
				readonly command?: string;
				readonly commandWindows?: string;
			}>;
		}>
	>;
};

const repoRoot = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../../..",
);

const configs: ReadonlyArray<{
	readonly label: string;
	readonly path: string;
	readonly envVar: string;
}> = [
	{
		label: "Claude Code",
		path: ".claude/settings.json",
		envVar: "CLAUDE_PROJECT_DIR",
	},
];

function loadConfig(relPath: string): HookConfig {
	const raw = readFileSync(resolve(repoRoot, relPath), { encoding: "utf-8" });
	return JSON.parse(raw) as HookConfig;
}

/** A matcher read as a regex over the whole name, as Claude Code reads it. */
const regex = (matcher: string, name: string) => new RegExp(`^(?:${matcher})$`).test(name);

/** Whether any entry fires on `name`: one with no matcher matches everything. */
function firesOn(
	entries: ReadonlyArray<{ readonly matcher?: string }>,
	name: string,
	matches: (matcher: string, name: string) => boolean,
): boolean {
	return entries.some((e) => e.matcher === undefined || matches(e.matcher, name));
}

/** The config's entries for `event` that run `script`, matcher and all. */
function entriesRunning(relPath: string, event: string, script: string) {
	return (loadConfig(relPath).hooks?.[event] ?? []).filter((e) => (e.hooks ?? []).some((h) => h.command?.includes(script)));
}

function eachNodeHookCommand(
	cfg: HookConfig,
): Array<{ readonly event: string; readonly command: string }> {
	const out: Array<{ event: string; command: string }> = [];
	const events = cfg.hooks ?? {};
	for (const [event, entries] of Object.entries(events)) {
		for (const entry of entries) {
			for (const hook of entry.hooks ?? []) {
				if (hook.type !== "command" || typeof hook.command !== "string") continue;
				// Only hooks that run the TS scripts are subject to the CWD-
				// resolution rule; inline shell commands (e.g. the printf
				// checklist) are fine.
				if (!hook.command.includes(".claude/scripts/")) continue;
				out.push({ event, command: hook.command });
			}
		}
	}
	return out;
}

describe("hook config — CWD-independent script resolution (issue #45)", () => {
	for (const { label, path, envVar } of configs) {
		describe(`${label} (${path})`, () => {
			const cfg = loadConfig(path);
			const commands = eachNodeHookCommand(cfg);

			test("at least one TS hook command is declared", () => {
				assert.ok(
					commands.length > 0,
					`expected ${path} to declare node-based hook commands`,
				);
			});

			for (const { event, command } of commands) {
				// Claude Code does not update CLAUDE_PROJECT_DIR on `/cd`, so it can
				// name a vault subfolder (#263). Its commands start from the variable
				// and walk up to the vault root; the run test below proves they work.
				test(`${event} walks up from \${${envVar}:-.} to the vault root (#263)`, () => {
					assert.ok(
						command.includes(`r="\${${envVar}:-.}"`) && command.includes("vault-manifest.json") && command.includes(")/.claude/scripts/"),
						`${path} ${event} command must find the vault root from \${${envVar}:-.} — got:\n  ${command}`,
					);
				});

				test(`${event} does not use a bare relative .claude/scripts/ path`, () => {
					// A bare relative path only survives if the invoking shell's
					// CWD is the project root — which is exactly the assumption
					// that broke in #45 for Claude Code, whose hooks inherit a tool
					// shell's `cd`.
					const bareRelative = / \.claude\/scripts\//.test(command);
					const envPrefixed = command.includes(
						`\${${envVar}:-.}/.claude/scripts/`,
					);
					assert.ok(
						!bareRelative || envPrefixed,
						`${path} ${event} has a bare .claude/scripts/ path — ${command}`,
					);
				});
			}
		});
	}
});

/**
 * The checklist hook runs on the event that can actually show its message.
 *
 * Claude Code: Stop, deduped inside the script to once per session
 * plus on change (#252). Not SessionEnd: Claude Code discards a SessionEnd
 * hook's `systemMessage` ("Claude Code discards their JSON output fields,
 * such as systemMessage" — hooks reference). Wiring the checklist there turns
 * "every turn" into "never".
 *
 * Pin the routing so a config edit cannot move the message somewhere it
 * silently disappears, or back to an undeduped per-turn surface.
 */
const CHECKLIST_EVENT: Readonly<Record<string, string>> = {
	"Claude Code": "Stop",
};

describe("hook config — the checklist runs where its message is shown", () => {
	for (const { label, path } of configs) {
		const checklistHooks = eachNodeHookCommand(loadConfig(path)).filter(
			({ command }) => command.includes("stop-checklist.ts"),
		);
		const expected = CHECKLIST_EVENT[label];
		const events = checklistHooks.map(({ event }) => event);

		test(`${label} wires the checklist exactly once, on ${expected}`, () => {
			assert.deepEqual(
				events,
				[expected],
				`expected ${path} to invoke stop-checklist.ts once, on ${expected} — got ${JSON.stringify(events)}`,
			);
		});

		test(`${label} passes the checklist hook no arguments`, () => {
			assert.match(
				checklistHooks[0]?.command ?? "",
				/stop-checklist\.ts"?$/,
				`${path} must invoke stop-checklist.ts with no trailing arguments — its output contract takes no arguments`,
			);
		});
	}
});

/**
 * #263: run every Claude hook command for real, with `node` replaced by a
 * shell function that prints its arguments, and check which script it would
 * run. Claude Code runs hook commands through a POSIX shell (Git Bash on
 * Windows), so this is the same shell, quoting and path handling, minus the
 * script itself. On macOS and Linux each command also runs under `sh`.
 */
describe("hook config — Claude commands find the vault root from a subfolder (#263)", () => {
	const commands = eachNodeHookCommand(loadConfig(".claude/settings.json"));
	// The guard command has one more part after the script: what it prints when node fails.
	const scriptOf = (command: string) => /\/\.claude\/scripts\/([a-z-]+\.ts)"(?: \|\| printf .+)?$/.exec(command)?.[1] ?? "";

	test("every command walks up with the same text: one rule, six copies that cannot drift", () => {
		// JSON cannot share a snippet, so each command carries the walk-up. Each
		// copy is also run below, but only this keeps one copy from quietly
		// losing a branch (the fallback, say) that the run cases happen not to reach.
		const walkOf = (command: string) => command.slice(0, command.indexOf("/.claude/scripts/"));
		const walks = new Set(commands.map(({ command }) => walkOf(command)));
		assert.equal(commands.length, 6);
		assert.equal(walks.size, 1, `the walk-up differs between commands:\n${[...walks].join("\n")}`);
		assert.match([...walks][0]!, /vault-manifest\.json/);
	});

	/**
	 * The POSIX shells to run the commands under. On Windows that is Git Bash,
	 * the shell Claude Code itself uses there: never a bare `bash`, which can
	 * resolve to WSL's. None found means the run tests are skipped, with the
	 * reason in the skip, rather than failing on a missing binary.
	 */
	function posixShells(): string[] {
		if (process.platform !== "win32") return ["bash", "sh"].filter((sh) => spawnSync(sh, ["-c", "true"]).status === 0);
		const candidates = [
			process.env["CLAUDE_CODE_GIT_BASH_PATH"],
			process.env["ProgramFiles"] && join(process.env["ProgramFiles"], "Git", "bin", "bash.exe"),
			process.env["ProgramFiles(x86)"] && join(process.env["ProgramFiles(x86)"], "Git", "bin", "bash.exe"),
			process.env["LOCALAPPDATA"] && join(process.env["LOCALAPPDATA"], "Programs", "Git", "bin", "bash.exe"),
		];
		const found = candidates.find((path): path is string => typeof path === "string" && existsSync(path));
		return found ? [found] : [];
	}
	const shells = posixShells();
	// Locally a missing shell skips with the reason. On CI it must fail instead:
	// a run that skips every command proves nothing and would still pass.
	const noShell = shells.length === 0 && !process.env["CI"] ? "no POSIX shell found (on Windows: Git Bash)" : false;

	/** The script path the command hands to node under `shell`, run from `cwd` with `env`. */
	function resolvedScript(shell: string, command: string, cwd: string, env: NodeJS.ProcessEnv): string {
		const run = spawnSync(shell, ["-c", `node() { printf '%s\\n' "$@"; }; ${command}`], { encoding: "utf-8", cwd, env });
		assert.equal(run.status, 0, `${shell} failed: ${run.error?.message ?? run.stderr}`);
		return run.stdout.trim().split("\n").pop() ?? "";
	}
	const withProjectDir = (dir: string): NodeJS.ProcessEnv => ({ ...process.env, CLAUDE_PROJECT_DIR: dir });
	const withoutProjectDir = (): NodeJS.ProcessEnv => {
		const env = { ...process.env };
		delete env["CLAUDE_PROJECT_DIR"];
		return env;
	};

	let vault = "";
	before(() => {
		vault = mkdtempSync(join(tmpdir(), "hook-config-vault-"));
		mkdirSync(join(vault, "work", "deep"), { recursive: true });
		writeFileSync(join(vault, "vault-manifest.json"), "{}");
	});
	after(() => rmSync(vault, { recursive: true, force: true }));

	// The "no vault above" case needs a temp folder that is not itself inside a vault.
	const tmpInVault = nearestVaultRoot(tmpdir()) !== null ? "the temp folder is inside a vault on this machine" : false;

	for (const shell of shells.length ? shells : ["(none)"]) {
		for (const { event, command } of commands) {
			const script = scriptOf(command);
			const label = `${event} under ${shell.split(/[\\/]/).pop()}`;

			test(`${label}: launched in a subfolder, the command runs the vault root's script`, { skip: noShell }, () => {
				assert.ok(script, `could not read the script name from: ${command}`);
				const got = resolvedScript(shell, command, vault, withProjectDir(join(vault, "work", "deep")));
				assert.equal(resolve(got), resolve(vault, ".claude", "scripts", script));
			});

			test(`${label}: with the variable unset, run from the vault root, the command still runs the root's script`, { skip: noShell }, () => {
				// Claude Code always sets the variable for hooks; unset is the
				// outside-Claude case, which keeps the pre-#263 `.` behaviour.
				const got = resolvedScript(shell, command, vault, withoutProjectDir());
				assert.equal(resolve(vault, got), resolve(vault, ".claude", "scripts", script));
			});

			test(`${label}: with no vault above, the command keeps the named folder`, { skip: noShell || tmpInVault }, () => {
				const elsewhere = mkdtempSync(join(tmpdir(), "hook-config-novault-"));
				try {
					const got = resolvedScript(shell, command, elsewhere, withProjectDir(elsewhere));
					assert.equal(resolve(got), resolve(elsewhere, ".claude", "scripts", script));
				} finally {
					rmSync(elsewhere, { recursive: true, force: true });
				}
			});
		}
	}
});

describe("hook config — SessionStart fires for every source the agent documents (#352)", () => {
	const FOUR_SOURCES = ["startup", "resume", "clear", "compact"];
	const agents: ReadonlyArray<{
		readonly label: string;
		readonly path: string;
		readonly sources: readonly string[];
		readonly matches: (matcher: string, source: string) => boolean;
	}> = [
		// Claude Code: a regex over startup|resume|clear|compact (hooks reference).
		{ label: "Claude Code", path: ".claude/settings.json", sources: FOUR_SOURCES, matches: regex },
	];

	for (const agent of agents) {
		test(`${agent.label}: session-start runs on every documented source`, () => {
			const entries = entriesRunning(agent.path, "SessionStart", "session-start.ts");
			assert.ok(entries.length > 0, "a SessionStart entry runs session-start.ts");
			for (const source of agent.sources) {
				assert.ok(firesOn(entries, source, agent.matches), `no SessionStart matcher fires on source "${source}"`);
			}
		});
	}
});

describe("hook config — write validation fires on each agent's own file tools (#353)", () => {
	// validate-write runs after a file write, and a matcher that misses the
	// agent's file tool names never fires.
	const agents: ReadonlyArray<{ readonly label: string; readonly path: string; readonly event: string; readonly tools: readonly string[] }> = [
		// Claude Code: Write and Edit (hooks reference).
		{ label: "Claude Code", path: ".claude/settings.json", event: "PostToolUse", tools: ["Write", "Edit"] },
	];

	for (const agent of agents) {
		test(`${agent.label}: validate-write's matcher matches ${agent.tools.join(" and ")}`, () => {
			const entries = entriesRunning(agent.path, agent.event, "validate-write.ts");
			assert.ok(entries.length > 0, `a ${agent.event} entry runs validate-write.ts`);
			for (const tool of agent.tools) {
				assert.ok(firesOn(entries, tool, regex), `no matcher fires on ${tool}`);
			}
		});
	}
});

describe("hook config — the Notion write guard runs before each Bash call", () => {
	// Claude Code reaches Notion through `mcporter`, so a Notion write is a Bash
	// call. A matcher that misses Bash lets each write through with no check.
	test("Claude Code: a PreToolUse entry with a timeout runs guard-notion-write on Bash", () => {
		const entries = entriesRunning(".claude/settings.json", "PreToolUse", "guard-notion-write.ts");
		assert.ok(firesOn(entries, "Bash", regex), "no PreToolUse matcher fires on Bash");
		const hooks = entries.flatMap((entry) => entry.hooks ?? []) as ReadonlyArray<{ readonly timeout?: number }>;
		assert.deepEqual(hooks.map((hook) => hook.timeout), [5]);
	});

	// Claude Code runs the call when a PreToolUse hook exits with an error. The
	// script denies on each error that it can catch. The command covers the
	// rest: a node that does not start, and a script that does not load.
	describe("the command denies when node fails", { skip: process.platform === "win32" && "the run needs /bin/sh" }, () => {
		const command = (loadConfig(".claude/settings.json").hooks?.["PreToolUse"] ?? []).flatMap((entry) => entry.hooks ?? []).find((hook) => hook.command?.includes("guard-notion-write.ts"))?.command ?? "";
		const payload = JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npm test" }, cwd: repoRoot });
		const run = (projectDir: string, env: NodeJS.ProcessEnv = {}) => spawnSync("/bin/sh", ["-c", command], { encoding: "utf-8", input: payload, env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, ...env } });
		const decisionOf = (stdout: string): unknown => (JSON.parse(stdout) as { hookSpecificOutput: Record<string, unknown> }).hookSpecificOutput["permissionDecision"];

		let vault = "";
		before(() => {
			vault = mkdtempSync(join(tmpdir(), "hook-config-guard-"));
			writeFileSync(join(vault, "vault-manifest.json"), "{}");
		});
		after(() => rmSync(vault, { recursive: true, force: true }));

		test("the script of this repository runs, and the command adds no output", () => {
			const got = run(repoRoot);
			assert.deepEqual({ status: got.status, stdout: got.stdout }, { status: 0, stdout: "" }, got.stderr);
		});

		test("a script that is absent gives a denial and a zero exit", () => {
			const got = run(vault);
			assert.equal(got.status, 0, got.stderr);
			assert.equal(decisionOf(got.stdout), "deny");
			assert.match(got.stderr, /Cannot find module/);
		});

		test("a script that exits with an error gives a denial and a zero exit", () => {
			mkdirSync(join(vault, ".claude", "scripts"), { recursive: true });
			writeFileSync(join(vault, ".claude", "scripts", "guard-notion-write.ts"), "process.exit(1);\n");
			const got = run(vault);
			assert.equal(got.status, 0, got.stderr);
			assert.equal(decisionOf(got.stdout), "deny");
		});

		test("a node that is not on PATH gives a denial and a zero exit", () => {
			const got = run(repoRoot, { PATH: vault });
			assert.equal(got.status, 0, got.stderr);
			assert.equal(decisionOf(got.stdout), "deny");
		});
	});
});
