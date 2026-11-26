/**
 * What a hook process needs to reach Notion, on top of the minimal
 * environment of the runner. `mcporter` reads three things from the
 * environment, and the form passes only these:
 *
 * - `PATH`: the client finds the runtime beside the `mcporter` executable
 *   on `PATH`. The folder holds links to `node`, `git`, and `mcporter`.
 * - `MCPORTER_CONFIG`: the config file that names the `notion` server.
 * - `XDG_DATA_HOME`: `mcporter` keeps the login and the locks of a token
 *   refresh in the folder `mcporter` under it.
 *
 * `MCPORTER_VAULT_PASSWORD` and `MCPORTER_VAULT_ENCRYPTION` pass when they
 * are set, because a login that is encrypted needs them.
 */

import { existsSync, mkdirSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { findMcporter } from "../lib/notion-client.ts";
import { minimalHookEnvironment } from "./runner.ts";

const VAULT_VARIABLES = ["MCPORTER_VAULT_PASSWORD", "MCPORTER_VAULT_ENCRYPTION"] as const;

/** The folder of a kind of `mcporter` file: `mcporter` under the XDG folder when that is set, or `.mcporter` in the home folder. */
function mcporterFolder(xdgHome: string | undefined): string {
	return xdgHome !== undefined && isAbsolute(xdgHome) ? join(xdgHome, "mcporter") : join(homedir(), ".mcporter");
}

function configFile(env: NodeJS.ProcessEnv): string {
	const named = env["MCPORTER_CONFIG"];
	if (named !== undefined && named.trim() !== "") return named.trim();
	const folders = [...new Set([mcporterFolder(env["XDG_CONFIG_HOME"]), mcporterFolder(undefined)])];
	const found = folders.flatMap((folder) => [join(folder, "mcporter.json"), join(folder, "mcporter.jsonc")]).find((file) => existsSync(file));
	if (found === undefined) throw new Error("mcporter has no config file in the home folder. Add the `notion` server with `mcporter config add notion https://mcp.notion.com/mcp`, or set MCPORTER_CONFIG.");
	return found;
}

/**
 * The variables that let a hook process in `dir` call Notion. `env` is the
 * environment of the harness, which holds the real `PATH` and home folder.
 */
export function notionHookEnvironment(dir: string, env: NodeJS.ProcessEnv = process.env): Record<string, string> {
	const executable = findMcporter(env);
	if (executable === null) throw new Error("mcporter is not on PATH, so a hook cannot reach Notion.");
	const login = mcporterFolder(env["XDG_DATA_HOME"]);
	if (!existsSync(login)) throw new Error(`mcporter has no login folder at ${login}. Run \`mcporter auth notion\`.`);

	const path = minimalHookEnvironment(dir)["PATH"] ?? "";
	if (process.platform !== "win32") symlinkSync(executable, join(path, "mcporter"));
	const dataHome = join(dir, "data");
	mkdirSync(dataHome, { recursive: true });
	// A link, not a copy: a token refresh replaces the token, and a copy would end the login of the machine.
	symlinkSync(login, join(dataHome, "mcporter"), "junction");

	const out: Record<string, string> = { PATH: path, MCPORTER_CONFIG: configFile(env), XDG_DATA_HOME: dataHome };
	for (const name of VAULT_VARIABLES) {
		const value = env[name];
		if (value !== undefined) out[name] = value;
	}
	return out;
}
