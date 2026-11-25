/**
 * The form of a Notion write, as a `Bash` hook sees it.
 *
 * Claude Code reaches Notion through `mcporter`, so a write is a shell command
 * string. A hook can check a write only when it can read the arguments, so one
 * form is the write form: the JSON arguments are in an outbox file, and the
 * command is `mcporter call notion.<tool> --args "$(cat <outbox file>)"`.
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

/** A tool that the table does not list is a write, so a new tool of the server gets the check. */
export const isNotionWrite = (tool: string): boolean => !Object.hasOwn(NOTION_TOOLS, tool) || NOTION_TOOLS[tool as keyof typeof NOTION_TOOLS] === "write";

export const OUTBOX_DIR = ".claude/state/outbox";

/** The one command that writes to Notion with the arguments in `outbox`. */
export const outboxCommand = (tool: string, outbox: string): string => `mcporter call notion.${tool} --args "$(cat ${outbox})"`;

const OUTBOX_COMMAND = /^mcporter +call +notion\.([A-Za-z0-9_-]+) +--args +"\$\(cat +(\.claude\/state\/outbox\/[A-Za-z0-9][A-Za-z0-9._-]*\.json)\)"$/;

export type JsonObject = { readonly [key: string]: unknown };

export type ParsedCommand =
	| { readonly kind: "not-notion-write" }
	| { readonly kind: "outbox-write"; readonly tool: string; readonly outbox: string; readonly args: JsonObject }
	/** `tool` is null when the command names the `notion` server but its selector does not show the tool. */
	| { readonly kind: "unparsed-write"; readonly cause: "form"; readonly tool: string | null }
	| { readonly kind: "unparsed-write"; readonly cause: "missing" | "not-json" | "not-object"; readonly tool: string; readonly outbox: string };

/**
 * Classify a `Bash` command. `readOutbox` returns the text of an outbox file,
 * or null when it cannot read the file. The path is the one in the command,
 * relative to the working directory of the shell.
 */
export function parseCommand(command: string, readOutbox: (outbox: string) => string | null): ParsedCommand {
	const writes = notionCalls(command).filter((tool) => tool === null || isNotionWrite(tool));
	if (writes.length === 0) return { kind: "not-notion-write" };

	const form = OUTBOX_COMMAND.exec(command.trim());
	const [, tool, outbox] = form ?? [];
	if (tool === undefined || outbox === undefined) return { kind: "unparsed-write", cause: "form", tool: writes[0] ?? null };

	const text = readOutbox(outbox);
	if (text === null) return { kind: "unparsed-write", cause: "missing", tool, outbox };
	let args: unknown;
	try {
		args = JSON.parse(text);
	} catch {
		return { kind: "unparsed-write", cause: "not-json", tool, outbox };
	}
	if (args === null || typeof args !== "object" || Array.isArray(args)) return { kind: "unparsed-write", cause: "not-object", tool, outbox };
	return { kind: "outbox-write", tool, outbox, args: args as JsonObject };
}

export type Decision = { readonly kind: "pass" } | { readonly kind: "deny"; readonly reason: string };

const outboxSteps = (tool: string): string =>
	[
		`1. Write the JSON arguments to ${OUTBOX_DIR}/<name>.json with the Write tool.`,
		`2. Run this command from the project root, with no other command, pipe, redirect, or argument:`,
		`   ${outboxCommand(tool, `${OUTBOX_DIR}/<name>.json`)}`,
	].join("\n");

const OUTBOX_PROBLEM = {
	missing: "The shell cannot read the outbox file from its working directory",
	"not-json": "The outbox file is not valid JSON",
	"not-object": "The outbox file must hold one JSON object",
} as const;

/** The guard checks the form only. Content findings are warnings after the write. */
export function decide(parsed: ParsedCommand): Decision {
	switch (parsed.kind) {
		case "not-notion-write":
			return { kind: "pass" };
		case "unparsed-write": {
			const problem = parsed.cause === "form" ? "The command is not in the outbox form, so the hooks cannot check the write." : `${OUTBOX_PROBLEM[parsed.cause]}: ${parsed.outbox}.`;
			return { kind: "deny", reason: `Notion write denied. ${problem}\n${outboxSteps(parsed.tool ?? "<tool>")}` };
		}
		case "outbox-write":
			// Without it the reply holds a task and no page ID, so the write hook cannot find the page.
			if (parsed.tool === "notion-create-pages" && parsed.args["allow_async"] !== false) {
				return { kind: "deny", reason: `Notion write denied. Set "allow_async": false at the top level of ${parsed.outbox}, then run the same command again.` };
			}
			return { kind: "pass" };
	}
}

const NO_TOOL_CALL = new Set(["list", "auth", "config", "daemon", "vault", "resource", "inspect-cli", "emit-ts", "generate-cli"]);
const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh"]);

const baseName = (word: string): string => word.slice(word.lastIndexOf("/") + 1);
const namesNotion = (word: string): boolean => word === "notion" || word === "--server=notion" || /^https?:\/\/[^/]*\bnotion\.(?:com|so)\b/.test(word);

/** The tool of each `mcporter` call in `command` that names the `notion` server. */
function notionCalls(command: string): (string | null)[] {
	return simpleCommands(command).flatMap((words) => {
		const starts = words.flatMap((word, index) => (baseName(word) === "mcporter" ? [index] : []));
		const direct = starts.flatMap((start, n) => {
			const segment = words.slice(start + 1, starts[n + 1]);
			const subcommand = segment.find((word) => !word.startsWith("-"));
			if (subcommand === undefined || NO_TOOL_CALL.has(subcommand)) return [];
			const tools = segment.flatMap((word) => /^notion\.([A-Za-z0-9_-]+)/.exec(word)?.[1] ?? []);
			if (tools.length > 0) return tools;
			return segment.some(namesNotion) ? [null] : [];
		});
		return [...direct, ...shellScripts(words).flatMap(notionCalls)];
	});
}

function shellScripts(words: readonly string[]): string[] {
	const evalAt = words.indexOf("eval");
	const scripts = evalAt === -1 ? [] : [words.slice(evalAt + 1).join(" ")];
	const shellAt = words.findIndex((word) => SHELLS.has(baseName(word)));
	const flagAt = shellAt === -1 ? -1 : words.findIndex((word, index) => index > shellAt && /^-[a-z]*c$/.test(word));
	const script = flagAt === -1 ? undefined : words[flagAt + 1];
	return script === undefined ? scripts : [...scripts, script];
}

/**
 * The simple commands of a shell command line, each as its words after quote
 * removal. A command substitution gives its own commands too. A here-document
 * body is data, not commands. The lexer covers the POSIX forms that decide
 * where a command starts, and it does not expand a variable.
 */
export function simpleCommands(command: string): string[][] {
	const out: string[][] = [];
	const end = command.length;
	let at = 0;

	const list = (closer: ")" | "`" | null): void => {
		let words: string[] = [];
		let word: string | null = null;
		const hereDocs: { readonly delimiter: string; readonly stripTabs: boolean }[] = [];
		const add = (text: string): void => {
			word = (word ?? "") + text;
		};
		const endWord = (): void => {
			if (word !== null) words.push(word);
			word = null;
		};
		const endCommand = (): void => {
			endWord();
			if (words.length > 0) out.push(words);
			words = [];
		};
		const substitution = (opener: number, nested: ")" | "`"): void => {
			at += opener;
			add("");
			list(nested);
		};

		while (at < end) {
			const char = command[at]!;
			const next = command[at + 1];
			if (char === closer) {
				at += 1;
				break;
			}
			if (char === "\n") {
				endCommand();
				at += 1;
				for (const { delimiter, stripTabs } of hereDocs.splice(0)) {
					while (at < end) {
						const lineEnd = command.indexOf("\n", at);
						const line = command.slice(at, lineEnd === -1 ? end : lineEnd);
						at = lineEnd === -1 ? end : lineEnd + 1;
						if ((stripTabs ? line.replace(/^\t+/, "") : line) === delimiter) break;
					}
				}
			} else if (char === " " || char === "\t") {
				endWord();
				at += 1;
			} else if (char === "#" && word === null) {
				const lineEnd = command.indexOf("\n", at);
				at = lineEnd === -1 ? end : lineEnd;
			} else if (char === "\\") {
				if (next !== "\n") add(next ?? "");
				at += 2;
			} else if (char === "'") {
				const close = command.indexOf("'", at + 1);
				add(command.slice(at + 1, close === -1 ? end : close));
				at = close === -1 ? end : close + 1;
			} else if (char === '"') {
				at += 1;
				add("");
				while (at < end && command[at] !== '"') {
					const inner = command[at]!;
					const after = command[at + 1];
					if (inner === "\\" && after !== undefined && '$`"\\\n'.includes(after)) {
						if (after !== "\n") add(after);
						at += 2;
					} else if (inner === "$" && after === "(") {
						substitution(2, ")");
					} else if (inner === "`") {
						substitution(1, "`");
					} else {
						add(inner);
						at += 1;
					}
				}
				at += 1;
			} else if (char === "$" && next === "(") {
				substitution(2, ")");
			} else if (char === "`") {
				substitution(1, "`");
			} else if (command.startsWith("<<<", at)) {
				endWord();
				at += 3;
			} else if (char === "<" && next === "<") {
				endWord();
				at += 2;
				const stripTabs = command[at] === "-";
				const delimiter = /^[ \t]*([^\s;&|()<>]*)/.exec(command.slice(at + (stripTabs ? 1 : 0)))!;
				at += (stripTabs ? 1 : 0) + delimiter[0].length;
				hereDocs.push({ delimiter: delimiter[1]!.replace(/['"\\]/g, ""), stripTabs });
			} else if ((char === ">" || char === "<") && next === "&") {
				endWord();
				at += 2;
			} else if (char === "&" && next === ">") {
				endWord();
				at += 2;
			} else if (char === ">" || char === "<") {
				endWord();
				at += 1;
			} else if (";&|()".includes(char)) {
				endCommand();
				at += 1;
			} else {
				add(char);
				at += 1;
			}
		}
		endCommand();
	};

	list(null);
	return out;
}
