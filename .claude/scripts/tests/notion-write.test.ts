/**
 * The parse classes of a `Bash` command and the decision of the guard for
 * each class (lib/notion-write.ts).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { NOTION_TOOLS, OUTBOX_DIR, bashCommand, decide, isNotionCommand, outboxCommand, parseCommand, readCommand } from "../lib/notion-write.ts";
import type { Host } from "../lib/notion-write.ts";
import { VERIFIER_CASES } from "./notion-guard-cases.ts";
import { CAPTURED_POST_TOOL_USE, CAPTURED_PRE_TOOL_USE } from "./notion-write-payloads.ts";

const CREATE_ARGS = { parent: { page_id: "<page-id>" }, allow_async: false, pages: [{ properties: { title: "A page" }, content: "Line one.\n\n[[North Star]]" }] };
const OUTBOX = `${OUTBOX_DIR}/note.json`;
const QUERY = `${OUTBOX_DIR}/query.json`;
const RUNTIME = "/usr/local/lib/node_modules/pkg-1/dist";

/** A host with an outbox of files by path. A path that it does not hold cannot be read. */
const hostOf = (files: Readonly<Record<string, string>>, runtimePaths: readonly string[] = []): Host => ({ readOutbox: (path) => files[path] ?? null, runtimePaths });
const HOST = hostOf({ [OUTBOX]: JSON.stringify(CREATE_ARGS), [QUERY]: '{"query":"it\'s"}', [`${OUTBOX_DIR}/ok.json`]: '{"allow_async":false,"pages":[]}' });
const parse = (command: string) => parseCommand(command, HOST);
const denial = (command: string, host = HOST): string => {
	const decision = decide(parseCommand(command, host));
	assert.equal(decision.kind, "deny", command);
	return decision.kind === "deny" ? decision.reason : "";
};
const refusal = (command: string, host = HOST): string | null => {
	const parsed = parseCommand(command, host);
	return parsed.kind === "refused" ? parsed.cause : null;
};

const CREATE = outboxCommand("notion-create-pages", OUTBOX);
const INLINE = `mcporter call notion.notion-create-pages --args '${JSON.stringify(CREATE_ARGS)}'`;

describe("the Notion tool table", () => {
	const READ_NAME = /^notion-(?:calendar-)?(?:get|query|list|search|fetch|view|read|download|wait|memory-search)(?:-|$)/;

	test("a tool is a read only when its name starts with a read verb", () => {
		for (const [tool, toolClass] of Object.entries(NOTION_TOOLS)) {
			assert.equal(toolClass, READ_NAME.test(tool) ? "read" : "write", tool);
		}
	});

	test("the table lists each tool of the server schema", () => {
		const classes = Object.values(NOTION_TOOLS);
		assert.deepEqual(
			{ all: classes.length, read: classes.filter((c) => c === "read").length, write: classes.filter((c) => c === "write").length },
			{ all: 77, read: 39, write: 38 },
		);
	});

	test("each read tool passes with inline arguments, and each write tool needs the outbox file", () => {
		for (const [tool, toolClass] of Object.entries(NOTION_TOOLS)) {
			const inline = parse(`mcporter call notion.${tool} --args '{"id":"x"}'`);
			assert.deepEqual({ kind: inline.kind, cause: refusal(`mcporter call notion.${tool} --args '{"id":"x"}'`) }, toolClass === "read" ? { kind: "read", cause: null } : { kind: "refused", cause: "write-form" }, tool);
			assert.equal(parse(outboxCommand(tool, OUTBOX)).kind, toolClass, tool);
		}
	});

	test("a tool that the table does not list is refused in each form", () => {
		for (const tool of ["notion-new-tool", "constructor", "notion-create-page", "NOTION-FETCH"]) {
			assert.equal(refusal(outboxCommand(tool, OUTBOX)), "unknown-tool", tool);
			assert.equal(refusal(`mcporter call notion.${tool}`), "unknown-tool", tool);
			assert.ok(denial(outboxCommand(tool, OUTBOX)).includes(`does not list ${tool}`));
		}
	});
});

describe("the captured payloads of a headless session", () => {
	for (const [event, payload] of [
		["PreToolUse", CAPTURED_PRE_TOOL_USE],
		["PostToolUse", CAPTURED_POST_TOOL_USE],
	] as const) {
		test(`the ${event} command has inline arguments, so the write is refused`, () => {
			assert.deepEqual(parse(payload.tool_input.command), { kind: "refused", cause: "write-form", tool: "notion-create-pages" });
		});
	}

	test("the denial of the captured command shows the outbox form for its tool", () => {
		const reason = denial(CAPTURED_PRE_TOOL_USE.tool_input.command);
		assert.match(reason, /^Notion command denied\. notion-create-pages changes Notion/);
		assert.ok(reason.includes(`mcporter call notion.notion-create-pages --args "$(cat ${OUTBOX_DIR}/<name>.json)"`), reason);
		assert.ok(reason.includes("with the Write tool"), reason);
	});
});

describe("the commands of the verifier", () => {
	for (const [id, kind, passedDetection, command] of VERIFIER_CASES) {
		test(`${id} is ${kind}${passedDetection && kind === "refused" ? ", and it passed the guard that looked for a write" : ""}`, () => {
			assert.equal(parse(command).kind, kind, command);
			assert.equal(decide(parse(command)).kind, kind === "refused" ? "deny" : "pass", command);
		});
	}

	test("of the 28 commands that passed the guard that looked for a write, two still pass", () => {
		const bypasses = VERIFIER_CASES.filter(([id, , passedDetection]) => passedDetection && !id.startsWith("ctl-"));
		assert.equal(bypasses.length, 28);
		// A script file holds the call, and base64 hides the word mcporter, so neither command text names it.
		assert.deepEqual(
			bypasses.filter(([, kind]) => kind !== "refused").map(([id]) => id),
			["script-file", "base64-eval"],
		);
	});
});

describe("a write in the outbox form", () => {
	test("gives the tool, the outbox file, and the parsed arguments", () => {
		assert.deepEqual(parse(CREATE), { kind: "write", tool: "notion-create-pages", outbox: OUTBOX, args: CREATE_ARGS });
	});

	test("passes, also with space around it", () => {
		assert.deepEqual(decide(parse(CREATE)), { kind: "pass" });
		assert.deepEqual(decide(parse(`  mcporter  call   notion.notion-create-pages  --args  "$(cat  ${OUTBOX})"\n`)), { kind: "pass" });
	});

	test("the form that a denial shows is the form that the parser accepts", () => {
		const shown = /^ {3}(mcporter call notion\.notion-create-pages .+)$/m.exec(denial(INLINE))?.[1] ?? assert.fail(denial(INLINE));
		assert.equal(parse(shown.replace("<name>", "note")).kind, "write");
	});

	const ASYNC: ReadonlyArray<readonly [string, object]> = [
		["has no allow_async", { pages: [] }],
		["has allow_async true", { allow_async: true, pages: [] }],
		['has allow_async "false" as text', { allow_async: "false", pages: [] }],
		["has allow_async false below the top level", { pages: [{ allow_async: false }] }],
	];
	for (const [label, args] of ASYNC) {
		test(`notion-create-pages is denied when the outbox file ${label}`, () => {
			const reason = denial(CREATE, hostOf({ [OUTBOX]: JSON.stringify(args) }));
			assert.equal(reason, `Notion command denied. Set "allow_async": false at the top level of ${OUTBOX}, then run the same command again.`);
		});
	}

	test("a write tool other than notion-create-pages needs no allow_async", () => {
		const host = hostOf({ [OUTBOX]: JSON.stringify({ page_id: "abc", command: "update_properties" }) });
		assert.deepEqual(decide(parseCommand(outboxCommand("notion-update-page", OUTBOX), host)), { kind: "pass" });
	});
});

describe("a read in the read form", () => {
	const READS: ReadonlyArray<readonly [string, string, object, string | null]> = [
		["no arguments", "mcporter call notion.notion-get-self", {}, null],
		["inline arguments", `mcporter call notion.notion-fetch --args '{"id":"abc"}'`, { id: "abc" }, null],
		["inline arguments and an output format", readCommand("notion-fetch", '{"id":"abc"}'), { id: "abc" }, null],
		["an output format and no arguments", "mcporter call notion.notion-get-teams --output json", {}, null],
		["inline arguments on more than one line", `mcporter call notion.notion-search --args '{\n  "query": "north star"\n}'`, { query: "north star" }, null],
		["a shell text in its arguments", `mcporter call notion.notion-search --args '{"query":"$(rm -rf x) | \`y\` > z; mcporter call notion.notion-create-pages"}'`, { query: "$(rm -rf x) | `y` > z; mcporter call notion.notion-create-pages" }, null],
		["a single quote as \\u0027", `mcporter call notion.notion-search --args '{"query":"it\\u0027s"}'`, { query: "it's" }, null],
		["arguments from an outbox file", outboxCommand("notion-search", QUERY), { query: "it's" }, QUERY],
		["arguments from an outbox file and an output format", `${outboxCommand("notion-search", QUERY)} --output raw`, { query: "it's" }, QUERY],
	];
	for (const [label, command, args, outbox] of READS) {
		test(`a read with ${label} passes`, () => {
			const parsed = parse(command);
			assert.deepEqual(parsed, { kind: "read", tool: /notion\.([a-z-]+)/.exec(command)?.[1], args, outbox }, command);
			assert.deepEqual(decide(parsed), { kind: "pass" });
		});
	}

	for (const format of ["json", "text", "markdown", "raw"]) {
		test(`the output format ${format} passes`, () => assert.equal(parse(`mcporter call notion.notion-get-self --output ${format}`).kind, "read"));
	}

	test("the read form that a denial shows is the form that the parser accepts", () => {
		const reason = denial("mcporter call notion.notion-fetch id:abc");
		const shown = /^ {3}(mcporter call notion\.<read tool> .+)$/m.exec(reason)?.[1] ?? assert.fail(reason);
		assert.equal(parse(shown.replace("<read tool>", "notion-fetch").replace("<JSON object>", '{"id":"abc"}')).kind, "read");
	});
});

describe("a command that names Notion in another form", () => {
	const FORM: ReadonlyArray<readonly [string, string]> = [
		["a write with inline --args in double quotes", `mcporter call notion.notion-create-pages --args "{\\"pages\\":[]}"`],
		["a write with a here-document", `mcporter call notion.notion-create-pages --args "$(cat <<'EOF'\n${JSON.stringify(CREATE_ARGS)}\nEOF\n)"`],
		["a here-document with no quotes that runs the write", `cat <<EOF\n$(mcporter call notion.notion-update-page --args '{"page_id":"<page-id>","command":"update_properties","properties":{"title":"A title"}}')\nEOF`],
		["a here-document with no quotes that runs the write in backquotes", "cat <<EOF\n`mcporter call notion.notion-delete-pages --args '{}'`\nEOF"],
		["a pipe into the call", `cat ${OUTBOX} | xargs -0 mcporter call notion.notion-create-pages --args`],
		["a pipe out of a write", `${CREATE} | jq .`],
		["a redirect of a write", `${CREATE} > /tmp/reply.json`],
		["a stderr redirect", `${CREATE} 2>&1`],
		["a command before the call", `cd /tmp && ${CREATE}`],
		["a command after the call", `${CREATE}; rm ${OUTBOX}`],
		["two writes", `${CREATE}\n${CREATE}`],
		["a background call", `${CREATE} &`],
		["an environment prefix", `FOO=1 ${CREATE}`],
		["an outbox file outside the outbox", `mcporter call notion.notion-create-pages --args "$(cat /tmp/note.json)"`],
		["an outbox file above the outbox", `mcporter call notion.notion-create-pages --args "$(cat ${OUTBOX_DIR}/../note.json)"`],
		["an outbox file in a sub-folder", `mcporter call notion.notion-create-pages --args "$(cat ${OUTBOX_DIR}/a/note.json)"`],
		["an outbox file that is not .json", `mcporter call notion.notion-create-pages --args "$(cat ${OUTBOX_DIR}/note.txt)"`],
		["an unquoted substitution", `mcporter call notion.notion-create-pages --args $(cat ${OUTBOX})`],
		["key:value arguments of a write", "mcporter call notion.notion-update-page page_id:abc command:update_properties"],
		["a file argument", "mcporter call notion.notion-create-comment page_id=abc markdown=@comment.md"],
		["the function-call syntax", `mcporter call 'notion.notion-create-pages(pages: [])'`],
		["no call word", `mcporter notion.notion-create-pages --args '{}'`],
		["a path to mcporter", `./node_modules/.bin/mcporter call notion.notion-create-pages --args "$(cat ${OUTBOX})"`],
		["a loop", "for id in a b; do mcporter call notion.notion-delete-pages page_ids:$id; done"],
		["a read and a write", `mcporter call notion.notion-fetch --args '{"id":"abc"}' && ${CREATE}`],
		["--server and --tool", `mcporter call --server notion --tool notion-create-pages --args '{}'`],
		["a server word and a tool word", `mcporter call notion notion-create-pages --args '{}'`],
		["a URL selector", `mcporter call https://mcp.notion.com/mcp.notion-create-pages --args '{}'`],
		["a here-document that quotes the write command", `gh pr create --body "$(cat <<'EOF'\n## Usage\nmcporter call notion.notion-create-pages --args '{}'\nEOF\n)"`],
	];
	for (const [label, command] of FORM) {
		test(`${label} is denied with the two forms`, () => {
			assert.equal(refusal(command), "form", command);
			const reason = denial(command);
			assert.ok(reason.includes(`mcporter call notion.<tool> --args "$(cat ${OUTBOX_DIR}/<name>.json)"`), reason);
			assert.ok(reason.includes("mcporter call notion.<read tool> --args '<JSON object>' --output json"), reason);
		});
	}

	const READ_FORM: ReadonlyArray<readonly [string, string]> = [
		["key:value arguments", `mcporter call notion.notion-search query:"north star" page_size:5`],
		["a tool:<name> argument that replaces the tool", "mcporter call notion.notion-get-self tool:notion-create-pages"],
		["a --tool flag that replaces the tool", `mcporter call notion.notion-get-self --tool notion-create-pages --args '{}'`],
		["a --server flag", "mcporter call notion.notion-get-self --server other"],
		["inline arguments in double quotes", `mcporter call notion.notion-fetch --args "{\\"id\\":\\"abc\\"}"`],
		["a variable in double quotes", `mcporter call notion.notion-fetch --args "$ARGS"`],
		["arguments with no quotes", "mcporter call notion.notion-fetch --args {}"],
		["arguments from stdin", "mcporter call notion.notion-fetch --args '-'"],
		["arguments that are a list", "mcporter call notion.notion-fetch --args '[1]'"],
		["two inline strings", `mcporter call notion.notion-fetch --args '{"id":"a"}''{"id":"b"}'`],
		["the --params flag", `mcporter call notion.notion-fetch --params '{"id":"abc"}'`],
		["an output format before the arguments", `mcporter call notion.notion-fetch --output json --args '{"id":"abc"}'`],
		["an unknown output format", "mcporter call notion.notion-get-self --output yaml"],
		["a flag after the form", "mcporter call notion.notion-get-self --output json --save-images /tmp"],
		["a pipe", `mcporter call notion.notion-fetch --args '{"id":"abc"}' | jq .`],
		["a redirect", "mcporter call notion.notion-get-self > /tmp/self.json"],
		["two reads", "mcporter call notion.notion-get-users && mcporter call notion.notion-get-teams"],
		["a second line", "mcporter call notion.notion-get-self\nrm -rf x"],
		["a tab between the words", "mcporter\tcall notion.notion-get-self"],
		["a tool name with more text", "mcporter call notion.notion-fetch.x"],
	];
	for (const [label, command] of READ_FORM) {
		test(`a read with ${label} is denied`, () => assert.equal(refusal(command), "form", command));
	}

	test("a write tool with an output format is denied", () => {
		assert.equal(refusal(`${CREATE} --output json`), "write-form");
	});

	test("a write tool with no arguments is denied", () => {
		assert.equal(refusal("mcporter call notion.notion-complete-mcp-setup"), "write-form");
	});
});

describe("arguments that the guard cannot read", () => {
	test("an outbox file that the shell cannot read is denied", () => {
		const command = outboxCommand("notion-update-page", `${OUTBOX_DIR}/absent.json`);
		assert.deepEqual(parse(command), { kind: "refused", cause: "missing", outbox: `${OUTBOX_DIR}/absent.json` });
		assert.match(denial(command), /cannot read the outbox file from its working directory: \.claude\/state\/outbox\/absent\.json\./);
	});

	test("a read from an outbox file that the shell cannot read is denied", () => {
		assert.equal(refusal(outboxCommand("notion-fetch", `${OUTBOX_DIR}/absent.json`)), "missing");
	});

	test("an outbox file that is not JSON is denied", () => {
		const host = hostOf({ [OUTBOX]: "{not json" });
		assert.deepEqual(parseCommand(CREATE, host), { kind: "refused", cause: "not-json", outbox: OUTBOX });
		assert.equal(denial(CREATE, host), `Notion command denied. The outbox file ${OUTBOX} is not valid JSON.`);
	});

	for (const [label, text] of [
		["a list", "[]"],
		["a string", '"text"'],
		["null", "null"],
	] as const) {
		test(`an outbox file that holds ${label} is denied`, () => {
			const host = hostOf({ [OUTBOX]: text });
			assert.deepEqual(parseCommand(CREATE, host), { kind: "refused", cause: "not-object", outbox: OUTBOX });
			assert.equal(denial(CREATE, host), `Notion command denied. The outbox file ${OUTBOX} must hold one JSON object.`);
		});
	}

	test("inline arguments that are not JSON are denied", () => {
		const command = "mcporter call notion.notion-fetch --args '{id: abc}'";
		assert.deepEqual(parse(command), { kind: "refused", cause: "not-json", outbox: null });
		assert.equal(denial(command), "Notion command denied. The inline --args value is not valid JSON.");
	});

	test("the parser reads no outbox file for a command in another form", () => {
		const host: Host = { readOutbox: () => assert.fail("the parser read a file"), runtimePaths: [] };
		assert.equal(parseCommand("ls", host).kind, "other");
		assert.equal(parseCommand(`${CREATE} | jq .`, host).kind, "refused");
		assert.equal(parseCommand(`mcporter call notion.notion-fetch --args '{"id":"abc"}'`, host).kind, "read");
	});
});

describe("the text that makes a Notion command", () => {
	const NOTION: ReadonlyArray<readonly [string, string]> = [
		["mcporter and notion as words", "mcporter call notion.notion-fetch"],
		["mcporter in a path", "/usr/local/bin/mcporter call notion.notion-fetch"],
		["mcporter as name@version", "npx -y mcporter@0.17.1 call notion.notion-fetch"],
		["mcporter in upper case", "MCPORTER call notion.notion-fetch"],
		["notion in upper case", "mcporter call NOTION.notion-create-pages"],
		["notion in title case", "mcporter call Notion.notion-create-pages"],
		["notion as the word of a flag value", "mcporter call --server notion --tool notion-create-pages"],
		["notion as the word of a list", "mcporter list notion --http-url https://example.com"],
		["notion in a URL", "mcporter call https://mcp.notion.com/mcp.notion-create-pages"],
		["notion in a package name", `mcporter call --stdio "npx -y @notionhq/notion-mcp-server" --tool x`],
		["notion in the tool name", "mcporter call other.notion-like-tool"],
		["quotes inside both words", `mcpor''ter call noti""on notion-create-pages`],
		["a backslash inside mcporter", "mcpor\\ter call notion.x"],
		["a line continuation inside mcporter", "mcpor\\\nter call notion.x"],
		["a line continuation inside notion", "mcporter call noti\\\non.x"],
		["the words in a here-document", "sh <<EOF\nmcporter call notion.notion-create-pages\nEOF"],
		["the words in a variable that holds a command", "X='mcporter call notion.notion-create-pages'; eval $X"],
		["the runtime folder and no other word", `node ${RUNTIME}/dist/index.js`],
		["the runtime folder with Notion", `node ${RUNTIME}/cli.js call --server notion --tool notion-create-pages`],
		["the runtime folder with quotes", `node "/usr/local/lib/node_modules/pkg-1"/dist/index.js`],
		["the runtime folder in an import", `node -e 'import("${RUNTIME}/dist/index.js")'`],
		["the runtime folder with a slack server", `node -e 'import("${RUNTIME}/dist/index.js").then((m) => m.createRuntime().then((r) => r.callTool("slack", "x", {})))'`],
	];
	for (const [label, command] of NOTION) {
		test(`${label} make a Notion command`, () => {
			assert.equal(isNotionCommand(command, [RUNTIME]), true, command);
			assert.notEqual(parseCommand(command, hostOf({}, [RUNTIME])).kind, "other", command);
		});
	}

	const OTHER: ReadonlyArray<readonly [string, string]> = [
		["a command with no such text", "npm test"],
		["an empty command", ""],
		["a file name that starts with notion-", "cat notion-map.json"],
		["a script of this repository", "node --experimental-strip-types .claude/scripts/guard-notion-write.ts"],
		["the word notion with no mcporter", "echo notion"],
		["a selector with no mcporter", "$RUNNER call notion.notion-create-pages"],
		["a call of the Notion API", "curl -X POST https://api.notion.com/v1/pages -d @page.json"],
		["a link to a Notion page", "open https://www.notion.so/abc"],
		["a comment that names a tool", "ls # notion.notion-create-pages"],
		["a read of the outbox", `cat ${OUTBOX}`],
		["a script file that holds the call", `bash ${OUTBOX_DIR}/run.sh`],
		["a variable that builds the word", "m=mcp; ${m}orter call $SELECTOR"],
		["a folder beside the runtime folder", "ls /usr/local/lib/node_modules/pkg-1"],
		["mcporter alone", "mcporter --version"],
		["mcporter in a path", "/usr/local/bin/mcporter --version"],
		["mcporter in upper case", "MCPORTER --version"],
		["mcporter with a backslash", "mcpor\\ter call x"],
		["a call to Slack", "mcporter call slack.post_message channel:general text:hello"],
		["a call to Jira with JSON", `mcporter call jira.get_issue --args '{"key":"A-1"}' --output json`],
		["a call to Grafana", "mcporter call grafana.query_prometheus expr:up"],
		["the tool list of another server", "mcporter list slack --schema"],
		["a search for mcporter", "rg mcporter .claude/scripts"],
		["a commit message that names mcporter", `git commit -m "docs: show the mcporter form"`],
	];
	for (const [label, command] of OTHER) {
		test(`${label} is not a Notion command, so it passes`, () => {
			assert.equal(isNotionCommand(command, [RUNTIME]), false, command);
			assert.deepEqual(parseCommand(command, hostOf({}, [RUNTIME])), { kind: "other" }, command);
			assert.deepEqual(decide({ kind: "other" }), { kind: "pass" });
		});
	}

	test("the runtime folder makes a Notion command only on a machine that has it", () => {
		const command = `node ${RUNTIME}/cli.js call --server slack --tool x`;
		assert.equal(parseCommand(command, hostOf({})).kind, "other");
		assert.equal(parseCommand(command, hostOf({}, [""])).kind, "other");
		assert.equal(parseCommand(command, hostOf({}, [RUNTIME])).kind, "refused");
	});

	test("a command that names Notion in an argument of another server is a Notion command", () => {
		assert.equal(refusal(`mcporter call slack.x --args "$(echo notion)"`), "form");
	});
});

describe("the tool list and the sign-in of the Notion server", () => {
	const INSPECT = [
		"mcporter list notion",
		"mcporter list notion --schema",
		"mcporter list notion --output json",
		"mcporter list notion --schema --output json",
		"mcporter auth notion",
		"  mcporter  auth  notion\n",
	];
	for (const command of INSPECT) {
		test(`${JSON.stringify(command)} passes`, () => {
			assert.deepEqual(parse(command), { kind: "inspect" });
			assert.deepEqual(decide(parse(command)), { kind: "pass" });
		});
	}

	const DENIED = [
		["a flag that the form does not list", "mcporter list notion --http-url https://example.com"],
		["a second server", "mcporter list notion slack"],
		["the options in the other order", "mcporter list notion --output json --schema"],
		["an output format other than json", "mcporter list notion --output text"],
		["the --json flag", "mcporter list notion --json"],
		["a reset of the credentials", "mcporter auth notion --reset"],
		["a stdio server", `mcporter auth --stdio "node x.js" notion`],
		["a second command", "mcporter list notion; mcporter call notion.notion-update-page"],
		["a pipe", "mcporter list notion | jq ."],
		["a redirect", "mcporter auth notion > /tmp/x"],
		["a server name in upper case", "mcporter list NOTION"],
		["another server after a Notion word", "mcporter list slack # notion"],
	] as const;
	for (const [label, command] of DENIED) {
		test(`${label} is denied`, () => assert.equal(refusal(command), "form", command));
	}

	test("the denial shows both forms, and the parser accepts each", () => {
		const reason = denial("mcporter list notion --verbose");
		for (const shown of ["mcporter list notion --schema --output json", "mcporter auth notion"]) {
			assert.ok(reason.includes(`   ${shown}`), reason);
			assert.equal(parse(shown).kind, "inspect");
		}
	});
});

describe("the command of a hook payload", () => {
	test("a Bash payload gives its command", () => {
		assert.equal(bashCommand(CAPTURED_PRE_TOOL_USE), CAPTURED_PRE_TOOL_USE.tool_input.command);
	});

	test("a payload of another tool gives no command", () => {
		assert.equal(bashCommand({ tool_name: "Write", tool_input: { file_path: "a.md" } }), null);
	});

	for (const [label, payload] of [
		["no tool name", { tool_input: { command: "ls" } }],
		["a tool name that is not text", { tool_name: 1, tool_input: { command: "ls" } }],
		["no tool input", { tool_name: "Bash" }],
		["a null tool input", { tool_name: "Bash", tool_input: null }],
		["a command that is not text", { tool_name: "Bash", tool_input: { command: ["ls"] } }],
		["null", null],
		["text", "ls"],
	] as const) {
		test(`a payload with ${label} is an error`, () => assert.throws(() => bashCommand(payload), /hook payload/));
	}
});
