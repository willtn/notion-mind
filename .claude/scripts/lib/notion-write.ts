/**
 * The allow list of Notion commands, as a `Bash` hook sees them.
 *
 * Claude Code reaches Notion through `mcporter`, so a Notion call is a shell
 * command string. No parser can find each write in shell text. So the guard
 * does not look for a write. It takes each command that names Notion, and it
 * passes only the two forms below. A hook can read the tool and the arguments
 * of each form.
 *
 * A write: `mcporter call notion.<tool> --args "$(cat <outbox file>)"`
 * A read:  `mcporter call notion.<read tool> --args '<JSON object>' --output json`
 */

export type ToolClass = "read" | "write";

/** Each tool of the `notion` server. A read changes no state. */
export const NOTION_TOOLS = {
	"notion-search": "read",
	"notion-memory-search": "read",
	"notion-get-tool-access": "read",
	"notion-fetch": "read",
	"notion-create-attachment": "write",
	"notion-create-file-upload": "write",
	"notion-download-attachment": "read",
	"notion-get-file-download-urls": "read",
	"notion-create-pages": "write",
	"notion-update-page": "write",
	"notion-delete-pages": "write",
	"notion-delete-databases": "write",
	"notion-restore-pages": "write",
	"notion-convert-page-to-skill": "write",
	"notion-upload-skill": "write",
	"notion-download-skill": "read",
	"notion-get-enabled-skills": "read",
	"notion-update-skill-settings": "write",
	"notion-complete-mcp-setup": "write",
	"notion-move-pages": "write",
	"notion-duplicate-page": "write",
	"notion-create-database": "write",
	"notion-create-folder": "write",
	"notion-update-folder": "write",
	"notion-update-data-source": "write",
	"notion-create-comment": "write",
	"notion-get-comments": "read",
	"notion-update-comment": "write",
	"notion-delete-comment": "write",
	"notion-set-discussion-resolved": "write",
	"notion-set-comment-reaction": "write",
	"notion-create-suggested-edit": "write",
	"notion-get-suggested-edit": "read",
	"notion-resolve-suggested-edit": "write",
	"notion-get-async-task": "read",
	"notion-get-teams": "read",
	"notion-get-groups": "read",
	"notion-get-users": "read",
	"notion-query-data-sources": "read",
	"notion-query-multiple-data-sources": "read",
	"notion-query-meeting-notes": "read",
	"notion-list-private-pages": "read",
	"notion-list-shared-pages": "read",
	"notion-list-favorite-pages": "read",
	"notion-list-recent-pages": "read",
	"notion-search-agents": "read",
	"notion-search-sessions": "read",
	"notion-query-sessions": "read",
	"notion-spawn-session": "write",
	"notion-get-session-status": "read",
	"notion-wait-session": "read",
	"notion-stop-session": "write",
	"notion-send-message-to-session": "write",
	"notion-list-session-events": "read",
	"notion-read-session-event": "read",
	"notion-create-view": "write",
	"notion-update-view": "write",
	"notion-get-version-changes": "read",
	"notion-view-version": "read",
	"notion-restore-version": "write",
	"notion-list-page-backlinks": "read",
	"notion-get-sidebar-tabs": "read",
	"notion-update-sidebar-tabs": "write",
	"notion-update-page-favorites": "write",
	"notion-calendar-list-calendars": "read",
	"notion-calendar-list-events": "read",
	"notion-calendar-list-coworkers-events": "read",
	"notion-calendar-list-calendar-resources": "read",
	"notion-calendar-list-contacts": "read",
	"notion-calendar-create-events": "write",
	"notion-calendar-update-events": "write",
	"notion-calendar-cancel-events": "write",
	"notion-get-self": "read",
	"notion-link-meeting-note-to-calendar-event": "write",
	"notion-convert-to-meetings-database": "write",
	"notion-create-meeting-note": "write",
	"notion-get-setup-guide": "read",
} as const satisfies Record<string, ToolClass>;

export type NotionTool = keyof typeof NOTION_TOOLS;
type ToolOf<Class extends ToolClass> = { [Tool in NotionTool]: (typeof NOTION_TOOLS)[Tool] extends Class ? Tool : never }[NotionTool];

export const OUTBOX_DIR = ".claude/state/outbox";

/** The one command that writes to Notion with the arguments in `outbox`. */
export const outboxCommand = (tool: string, outbox: string): string => `mcporter call notion.${tool} --args "$(cat ${outbox})"`;

/** A read with inline arguments. `args` is the text of one JSON object with no single quote. */
export const readCommand = (tool: string, args: string): string => `mcporter call notion.${tool} --args '${args}' --output json`;

const NOTION_TEXT = ["mcporter", "notion."];

/** Quote characters cannot split a name, and the match ignores case, because macOS finds `MCPORTER` too. */
const bare = (text: string): string => text.replace(/\\\n|['"\\]/g, "").toLowerCase();

/** Whether `command` names Notion anywhere in its text, also in a quoted string or a here-document. */
export const namesNotion = (command: string, runtimePaths: readonly string[]): boolean => {
	const text = bare(command);
	return [...NOTION_TEXT, ...runtimePaths.map(bare)].some((name) => name !== "" && text.includes(name));
};

const OUTBOX_ARGS = String.raw`"\$\(cat +(\.claude\/state\/outbox\/[A-Za-z0-9][A-Za-z0-9._-]*\.json)\)"`;
/** A single-quoted string is inert in a shell. The braces keep out `-` (stdin) and `@<file>`. */
const INLINE_ARGS = String.raw`'(\{[^']*\})'`;
/**
 * `--args` is the only source of arguments, because `mcporter` lets a
 * `tool:<name>` argument or a `--tool` flag replace the tool of the selector.
 */
const FORM = new RegExp(String.raw`^mcporter +call +notion\.([A-Za-z0-9_-]+)(?: +--args +(?:${OUTBOX_ARGS}|${INLINE_ARGS}))?( +--output +(?:json|text|markdown|raw))?$`);

export type JsonObject = { readonly [key: string]: unknown };

export type Refusal =
	| { readonly cause: "form" }
	| { readonly cause: "unknown-tool"; readonly tool: string }
	| { readonly cause: "write-form"; readonly tool: ToolOf<"write"> }
	/** `outbox` is null when the arguments are inline. */
	| { readonly cause: ArgsProblem; readonly outbox: string | null };

type ArgsProblem = "missing" | "not-json" | "not-object";

export type ParsedCommand =
	| { readonly kind: "other" }
	| { readonly kind: "read"; readonly tool: ToolOf<"read">; readonly args: JsonObject; readonly outbox: string | null }
	| { readonly kind: "write"; readonly tool: ToolOf<"write">; readonly args: JsonObject; readonly outbox: string }
	| ({ readonly kind: "refused" } & Refusal);

export type Host = {
	/** The text of an outbox file, or null when the shell cannot read it. The path is relative to the working directory of the shell. */
	readonly readOutbox: (outbox: string) => string | null;
	/** Each folder that holds the `mcporter` runtime on this machine. */
	readonly runtimePaths: readonly string[];
};

const isTool = (name: string): name is NotionTool => Object.hasOwn(NOTION_TOOLS, name);
const isWriteTool = (tool: NotionTool): tool is ToolOf<"write"> => NOTION_TOOLS[tool] === "write";

function jsonObject(text: string | null): JsonObject | ArgsProblem {
	if (text === null) return "missing";
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return "not-json";
	}
	return value === null || typeof value !== "object" || Array.isArray(value) ? "not-object" : (value as JsonObject);
}

/** Classify a `Bash` command. A command that names Notion is a call in one of the two forms, or it is refused. */
export function parseCommand(command: string, host: Host): ParsedCommand {
	if (!namesNotion(command, host.runtimePaths)) return { kind: "other" };

	const [, name, outbox = null, inline = "{}", output] = FORM.exec(command.trim()) ?? [];
	if (name === undefined) return { kind: "refused", cause: "form" };
	if (!isTool(name)) return { kind: "refused", cause: "unknown-tool", tool: name };

	if (isWriteTool(name)) {
		if (outbox === null || output !== undefined) return { kind: "refused", cause: "write-form", tool: name };
		const args = jsonObject(host.readOutbox(outbox));
		return typeof args === "string" ? { kind: "refused", cause: args, outbox } : { kind: "write", tool: name, args, outbox };
	}
	const args = jsonObject(outbox === null ? inline : host.readOutbox(outbox));
	return typeof args === "string" ? { kind: "refused", cause: args, outbox } : { kind: "read", tool: name, args, outbox };
}

export type Decision = { readonly kind: "pass" } | { readonly kind: "deny"; readonly reason: string };

const PLACEHOLDER = `${OUTBOX_DIR}/<name>.json`;

const writeSteps = (tool: string): string =>
	[
		`1. Write the JSON arguments to ${PLACEHOLDER} with the Write tool.`,
		"2. Run this command from the project root, with no other command, pipe, redirect, or argument:",
		`   ${outboxCommand(tool, PLACEHOLDER)}`,
	].join("\n");

const READ_STEPS = [
	`   ${readCommand("<read tool>", "<JSON object>")}`,
	"   `--args` and `--output` are optional. Put the JSON object in single quotes, and write a single quote in it as \\u0027.",
	`   A read can also take its arguments from an outbox file: --args "$(cat ${PLACEHOLDER})"`,
].join("\n");

function refusalReason(refusal: Refusal): string {
	const source = "outbox" in refusal && refusal.outbox !== null ? `The outbox file ${refusal.outbox}` : "The inline --args value";
	switch (refusal.cause) {
		case "form":
			return [
				"The command names `mcporter`, its runtime, or `notion.`, and it is not in a form that the hooks can check.",
				"Use one of the two forms exactly, with no other command, pipe, redirect, variable, or flag.",
				"A write:",
				writeSteps("<tool>"),
				"A read:",
				READ_STEPS,
			].join("\n");
		case "unknown-tool":
			return `The tool table of the guard does not list ${refusal.tool}. Use a tool of NOTION_TOOLS in .claude/scripts/lib/notion-write.ts.`;
		case "write-form":
			return `${refusal.tool} changes Notion, so its arguments must come from an outbox file.\n${writeSteps(refusal.tool)}`;
		case "missing":
			return `The shell cannot read the outbox file from its working directory: ${refusal.outbox}.\n${writeSteps("<tool>")}`;
		case "not-json":
			return `${source} is not valid JSON.`;
		case "not-object":
			return `${source} must hold one JSON object.`;
	}
}

/** The guard checks the form only. Content findings are warnings after the write. */
export function decide(parsed: ParsedCommand): Decision {
	switch (parsed.kind) {
		case "other":
		case "read":
			return { kind: "pass" };
		case "refused":
			return { kind: "deny", reason: `Notion command denied. ${refusalReason(parsed)}` };
		case "write":
			// Without it the reply holds a task and no page ID, so the write hook cannot find the page.
			if (parsed.tool === "notion-create-pages" && parsed.args["allow_async"] !== false) {
				return { kind: "deny", reason: `Notion command denied. Set "allow_async": false at the top level of ${parsed.outbox}, then run the same command again.` };
			}
			return { kind: "pass" };
	}
}

/**
 * The shell command of a `PreToolUse` payload, or null for a tool other than
 * `Bash`. It throws for a payload that it cannot read, so the guard denies.
 */
export function bashCommand(payload: unknown): string | null {
	const { tool_name: tool, tool_input: input } = (payload ?? {}) as { readonly tool_name?: unknown; readonly tool_input?: { readonly command?: unknown } | null };
	if (typeof tool !== "string") throw new Error("The hook payload names no tool.");
	if (tool !== "Bash") return null;
	if (typeof input?.command !== "string") throw new Error("The hook payload of Bash holds no command.");
	return input.command;
}
