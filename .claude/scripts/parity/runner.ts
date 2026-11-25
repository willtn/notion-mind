/**
 * Runs the scenarios of a fixture spec in one form and captures each hook
 * run. The runner keeps every state file of a hook in a directory that is
 * new for each scenario, so no run reads the state of an earlier scenario
 * and no run writes into the directory of the hook scripts.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HOOKS, type FixtureSpec, type HookEnvironment, type HookForm, type Scenario, type Step } from "./spec.ts";

/** The commit that each parity claim refers to. */
export const REFERENCE_COMMIT = "fae7be4";

/** The bytes of the session transcript that each scenario gives the hooks. */
export const TRANSCRIPT = '{"type":"user","message":{"role":"user","content":"parity fixture transcript"}}\n';

export type StepRun = {
	readonly stdout: string;
	readonly stderr: string;
	readonly exitCode: number | null;
	readonly wallMs: number;
	/** The transcript copies that exist after the run. */
	readonly sessionLogs: readonly { readonly name: string; readonly sha256: string }[];
};

export type ScenarioRun = {
	readonly scenario: Scenario;
	readonly environment: HookEnvironment;
	readonly runs: readonly StepRun[];
};

const repositoryRoot = (): string =>
	git(dirname(fileURLToPath(import.meta.url)), ["rev-parse", "--show-toplevel"]).stdout.trim();

function git(cwd: string, args: readonly string[]): { readonly ok: boolean; readonly stdout: string; readonly stderr: string } {
	const run = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf-8", windowsHide: true });
	return { ok: run.status === 0, stdout: run.stdout ?? "", stderr: run.stderr ?? "" };
}

/** A shallow clone does not hold the reference commit. */
export const referenceCommitExists = (): boolean =>
	git(repositoryRoot(), ["cat-file", "-e", `${REFERENCE_COMMIT}^{commit}`]).ok;

/**
 * Give `use` a temporary directory that holds a detached worktree of the
 * reference commit at `reference/`. The worktree and the directory do not
 * stay after `use` returns or throws.
 */
export function withReferenceWorktree<T>(use: (dirs: { readonly scriptsDir: string; readonly workDir: string }) => T): T {
	const root = repositoryRoot();
	const workDir = mkdtempSync(join(tmpdir(), "om-parity-"));
	const reference = join(workDir, "reference");
	try {
		const added = git(root, ["worktree", "add", "--detach", reference, REFERENCE_COMMIT]);
		if (!added.ok) throw new Error(`git worktree add failed: ${added.stderr.trim()}`);
		return use({ scriptsDir: join(reference, ".claude", "scripts"), workDir });
	} finally {
		const removed = git(root, ["worktree", "remove", "--force", reference]).ok;
		rmSync(workDir, { recursive: true, force: true });
		// A worktree that git could not remove leaves a record with no directory.
		if (!removed) git(root, ["worktree", "prune"]);
	}
}

const WINDOWS_VARIABLES = ["SystemRoot", "PATHEXT", "ComSpec", "TEMP", "TMP"] as const;

function executableOnPath(name: string): string | null {
	for (const folder of (process.env["PATH"] ?? "").split(delimiter)) {
		if (folder === "") continue;
		const candidate = join(folder, name);
		try {
			accessSync(candidate, constants.X_OK);
			return candidate;
		} catch {
			continue;
		}
	}
	return null;
}

/**
 * The environment of every hook process, in both forms. Nothing comes from
 * the environment of the harness, so a tool or a setting on the machine of
 * one developer cannot change a hook output:
 *
 * - `PATH` is a folder in `dir` with links to this `node` and to `git` only.
 * - `HOME` is an empty folder in `dir`, so no user file of npm is read.
 * - No npm variable is set.
 *
 * A form adds only what its own store needs, through `HookEnvironment.env`.
 * On Windows the links need a privilege, so `PATH` stays as the harness has it.
 */
export function minimalHookEnvironment(dir: string): Record<string, string> {
	const home = join(dir, "home");
	mkdirSync(home, { recursive: true });
	const env: Record<string, string> = {
		HOME: home,
		USERPROFILE: home,
		XDG_CACHE_HOME: join(home, ".cache"),
	};
	if (process.platform === "win32") {
		env["PATH"] = process.env["PATH"] ?? "";
		for (const name of WINDOWS_VARIABLES) {
			const value = process.env[name];
			if (value !== undefined) env[name] = value;
		}
		return env;
	}
	const bin = join(dir, "bin");
	mkdirSync(bin, { recursive: true });
	symlinkSync(process.execPath, join(bin, "node"));
	const git = executableOnPath("git");
	if (git !== null) symlinkSync(git, join(bin, "git"));
	env["PATH"] = bin;
	return env;
}

function sessionLogs(dir: string): StepRun["sessionLogs"] {
	let names: string[];
	try {
		names = readdirSync(dir).sort();
	} catch {
		return [];
	}
	return names.map((name) => ({
		name,
		sha256: createHash("sha256").update(readFileSync(join(dir, name))).digest("hex"),
	}));
}

/** Run each step of `scenario`. `dir` is an empty directory for the state of this scenario. */
export function runScenario(scenario: Scenario, spec: FixtureSpec, environment: HookEnvironment, dir: string): ScenarioRun {
	const home = join(dir, "home");
	const state = join(dir, "state");
	mkdirSync(home, { recursive: true });
	mkdirSync(state, { recursive: true });
	const transcript = join(home, "transcript.jsonl");
	writeFileSync(transcript, TRANSCRIPT);

	let handoffDir = join(state, "stop-handoff");
	if (scenario.blockHandoff) {
		const file = join(state, "not-a-directory");
		writeFileSync(file, "");
		handoffDir = join(file, "stop-handoff");
	}
	if (scenario.oldSessionLogs) mkdirSync(environment.sessionLogDir, { recursive: true });
	for (let i = 0; i < (scenario.oldSessionLogs ?? 0); i++) {
		const log = join(environment.sessionLogDir, `session_auto_20200101_0000${String(i).padStart(2, "0")}.jsonl`);
		writeFileSync(log, `old ${i}\n`);
		const old = new Date(Date.UTC(2020, 0, 1, 0, 0, i));
		utimesSync(log, old, old);
	}

	const env: Record<string, string> = {
		...minimalHookEnvironment(dir),
		// The hook must not find a repository above a temporary project directory.
		GIT_CEILING_DIRECTORIES: dirname(environment.projectDir),
		CLAUDE_PROJECT_DIR: environment.projectDir,
		CLASSIFY_HINT_STATE: join(state, "hint-state.json"),
		STOP_CHECKLIST_STATE: join(state, "checklist-state.json"),
		STOP_HANDOFF_DIR: handoffDir,
		...environment.env,
	};

	const stdinOf = (step: Step): string => {
		if (step.input.kind === "raw") return step.input.stdin;
		const base = {
			session_id: scenario.id,
			transcript_path: transcript,
			cwd: environment.projectDir,
			hook_event_name: HOOKS[step.hook].event,
		};
		if (step.input.kind === "payload") return JSON.stringify({ ...base, ...step.input.fields });
		if (step.input.kind === "memory-write") {
			const filePath = join(home, ".claude", "projects", "parity", "memory", step.input.file);
			return JSON.stringify({
				...base,
				tool_name: "Write",
				tool_input: { file_path: filePath, content: "" },
				tool_response: { filePath, success: true },
			});
		}
		const title = step.input.note;
		const note = spec.notes.find((candidate) => candidate.title === title);
		if (note === undefined) throw new Error(`scenario ${scenario.id} writes an unknown note: ${title}`);
		return JSON.stringify({ ...base, ...environment.writePayload(note) });
	};

	const runs = scenario.steps.map((step): StepRun => {
		const started = performance.now();
		const run = spawnSync(
			process.execPath,
			[
				"--disable-warning=ExperimentalWarning",
				"--experimental-strip-types",
				join(environment.scriptsDir, HOOKS[step.hook].script),
			],
			{ input: stdinOf(step), encoding: "utf-8", env, cwd: environment.projectDir, timeout: 60_000, windowsHide: true },
		);
		return {
			stdout: run.stdout ?? "",
			stderr: run.stderr ?? "",
			exitCode: run.status,
			wallMs: performance.now() - started,
			sessionLogs: sessionLogs(environment.sessionLogDir),
		};
	});
	return { scenario, environment, runs };
}

/** Run every scenario of `spec` in `form`. `workDir` gets one directory for each scenario. */
export function runScenarios(spec: FixtureSpec, workDir: string, form: HookForm): ScenarioRun[] {
	const passDir = mkdtempSync(join(workDir, "pass-"));
	return spec.scenarios.map((scenario, index) => {
		const dir = join(passDir, String(index));
		const formDir = join(dir, "form");
		mkdirSync(formDir, { recursive: true });
		return runScenario(scenario, spec, form(formDir), dir);
	});
}
