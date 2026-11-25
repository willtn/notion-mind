/**
 * The parse classes of a `Bash` command and the decision of the guard for
 * each class (lib/notion-write.ts).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { NOTION_TOOLS, OUTBOX_DIR, decide, isNotionWrite, outboxCommand, parseCommand, simpleCommands } from "../lib/notion-write.ts";
import { CAPTURED_POST_TOOL_USE, CAPTURED_PRE_TOOL_USE } from "./notion-write-payloads.ts";

const CREATE_ARGS = { parent: { page_id: "<page-id>" }, allow_async: false, pages: [{ properties: { title: "A page" }, content: "Line one.\n\n[[North Star]]" }] };
const OUTBOX = `${OUTBOX_DIR}/note.json`;

/** An outbox of files by path. A path that it does not hold cannot be read. */
const outboxOf =
	(files: Readonly<Record<string, string>>) =>
	(path: string): string | null =>
		files[path] ?? null;
const withCreate = outboxOf({ [OUTBOX]: JSON.stringify(CREATE_ARGS) });
const parse = (command: string) => parseCommand(command, withCreate);
const denial = (command: string, read = withCreate): string => {
	const decision = decide(parseCommand(command, read));
	assert.equal(decision.kind, "deny", command);
	return decision.kind === "deny" ? decision.reason : "";
};

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

	test("a tool that the table does not list is a write", () => {
		assert.equal(isNotionWrite("notion-new-tool"), true);
		assert.equal(isNotionWrite("constructor"), true);
		assert.equal(isNotionWrite("notion-fetch"), false);
		assert.equal(isNotionWrite("notion-update-page"), true);
	});

	test("each write tool needs the outbox form, and each read tool passes with inline arguments", () => {
		for (const [tool, toolClass] of Object.entries(NOTION_TOOLS)) {
			const parsed = parse(`mcporter call notion.${tool} --args '{"id":"x"}'`);
			assert.equal(parsed.kind, toolClass === "read" ? "not-notion-write" : "unparsed-write", tool);
		}
	});
});

describe("the captured payloads of a headless session", () => {
	for (const [event, payload] of [
		["PreToolUse", CAPTURED_PRE_TOOL_USE],
		["PostToolUse", CAPTURED_POST_TOOL_USE],
	] as const) {
		test(`the ${event} command has inline arguments, so the guard cannot parse the write`, () => {
			assert.deepEqual(parse(payload.tool_input.command), { kind: "unparsed-write", cause: "form", tool: "notion-create-pages" });
		});
	}

	test("the denial of the captured command shows the outbox form for its tool", () => {
		const reason = denial(CAPTURED_PRE_TOOL_USE.tool_input.command);
		assert.match(reason, /^Notion write denied\. The command is not in the outbox form/);
		assert.ok(reason.includes(`mcporter call notion.notion-create-pages --args "$(cat ${OUTBOX_DIR}/<name>.json)"`), reason);
		assert.ok(reason.includes("with the Write tool"), reason);
	});
});

describe("a Notion write in the outbox form", () => {
	test("gives the tool, the outbox file, and the parsed arguments", () => {
		assert.deepEqual(parse(outboxCommand("notion-create-pages", OUTBOX)), {
			kind: "outbox-write",
			tool: "notion-create-pages",
			outbox: OUTBOX,
			args: CREATE_ARGS,
		});
	});

	test("passes", () => {
		assert.deepEqual(decide(parse(outboxCommand("notion-create-pages", OUTBOX))), { kind: "pass" });
		assert.deepEqual(decide(parse(`  ${outboxCommand("notion-create-pages", OUTBOX)}\n`)), { kind: "pass" });
	});

	test("the form that a denial shows is the form that the parser accepts", () => {
		const shown = /^ {3}(mcporter .+)$/m.exec(denial(INLINE))?.[1] ?? assert.fail("the denial shows no command");
		const command = shown.replaceAll("<name>", "note");
		assert.equal(parse(command).kind, "outbox-write", command);
	});

	for (const [label, args] of [
		["has no allow_async", { pages: [] }],
		["has allow_async true", { allow_async: true, pages: [] }],
		["has allow_async as the text \"false\"", { allow_async: "false", pages: [] }],
		["has allow_async only inside a page", { pages: [{ allow_async: false }] }],
	] as const) {
		test(`notion-create-pages is denied when the outbox file ${label}`, () => {
			const reason = denial(outboxCommand("notion-create-pages", OUTBOX), outboxOf({ [OUTBOX]: JSON.stringify(args) }));
			assert.equal(reason, `Notion write denied. Set "allow_async": false at the top level of ${OUTBOX}, then run the same command again.`);
		});
	}

	test("a write tool other than notion-create-pages needs no allow_async", () => {
		const read = outboxOf({ [OUTBOX]: JSON.stringify({ page_id: "<page-id>", command: "update_properties", properties: {} }) });
		const parsed = parseCommand(outboxCommand("notion-update-page", OUTBOX), read);
		assert.equal(parsed.kind, "outbox-write");
		assert.deepEqual(decide(parsed), { kind: "pass" });
	});

	test("a tool that the table does not list passes in the outbox form", () => {
		assert.equal(parse(outboxCommand("notion-new-tool", OUTBOX)).kind, "outbox-write");
	});
});

describe("a Notion write that the guard cannot parse", () => {
	const create = outboxCommand("notion-create-pages", OUTBOX);
	const FORM: ReadonlyArray<readonly [string, string]> = [
		["inline --args", INLINE],
		["inline --args in double quotes", `mcporter call notion.notion-create-pages --args "{\\"pages\\":[]}"`],
		["a here-document", `mcporter call notion.notion-create-pages --args "$(cat <<'EOF'\n${JSON.stringify(CREATE_ARGS)}\nEOF\n)"`],
		["a pipe into the call", `cat ${OUTBOX} | xargs -0 mcporter call notion.notion-create-pages --args`],
		["a pipe out of the call", `${create} | jq .`],
		["a redirect", `${create} > /tmp/reply.json`],
		["a stderr redirect", `${create} 2>&1`],
		["a command before the call", `cd /tmp && ${create}`],
		["a command after the call", `${create}; rm ${OUTBOX}`],
		["two writes", `${create}\n${create}`],
		["a background call", `${create} &`],
		["an extra argument", `${create} --output json`],
		["an environment prefix", `FOO=1 ${create}`],
		["an outbox file outside the outbox", `mcporter call notion.notion-create-pages --args "$(cat /tmp/note.json)"`],
		["an outbox file above the outbox", `mcporter call notion.notion-create-pages --args "$(cat ${OUTBOX_DIR}/../note.json)"`],
		["an outbox file in a sub-folder", `mcporter call notion.notion-create-pages --args "$(cat ${OUTBOX_DIR}/a/note.json)"`],
		["an outbox file that is not .json", `mcporter call notion.notion-create-pages --args "$(cat ${OUTBOX_DIR}/note.txt)"`],
		["an unquoted substitution", `mcporter call notion.notion-create-pages --args $(cat ${OUTBOX})`],
		["key:value arguments", `mcporter call notion.notion-update-page page_id:abc command:update_properties`],
		["a file argument", `mcporter call notion.notion-create-comment page_id=abc markdown=@comment.md`],
		["the function-call syntax", `mcporter call 'notion.notion-create-pages(pages: [])'`],
		["no call word", `mcporter notion.notion-create-pages --args '{}'`],
		["a path to mcporter", `./node_modules/.bin/mcporter call notion.notion-create-pages --args "$(cat ${OUTBOX})"`],
		["npx", `npx mcporter call notion.notion-create-pages --args "$(cat ${OUTBOX})"`],
		["sh -c", `bash -lc 'mcporter call notion.notion-create-pages --args "$(cat ${OUTBOX})"'`],
		["eval", `eval "mcporter call notion.notion-delete-pages --args '{}'"`],
		["a command substitution", `echo "$(mcporter call notion.notion-move-pages --args '{}')"`],
		["backquotes", "ID=`mcporter call notion.notion-duplicate-page page_id:abc`"],
		["a sub-shell", `(mcporter call notion.notion-create-view --args '{}')`],
		["a line continuation", `mcporter call \\\nnotion.notion-create-pages --args '{}'`],
		["a loop", `for id in a b; do mcporter call notion.notion-delete-pages page_ids:$id; done`],
		["a read and a write", `mcporter call notion.notion-fetch id:abc && ${create}`],
		["a tool that the table does not list", `mcporter call notion.notion-new-tool --args '{}'`],
	];

	for (const [label, command] of FORM) {
		test(`${label} is not the outbox form`, () => {
			const parsed = parse(command);
			assert.deepEqual({ kind: parsed.kind, cause: parsed.kind === "unparsed-write" ? parsed.cause : null }, { kind: "unparsed-write", cause: "form" }, command);
			assert.match(denial(command), /not in the outbox form[\s\S]+--args "\$\(cat \.claude\/state\/outbox\/<name>\.json\)"/);
		});
	}

	const NO_TOOL: ReadonlyArray<readonly [string, string]> = [
		["--server and --tool", `mcporter call --server notion --tool notion-create-pages --args '{}'`],
		["a server word and a tool word", `mcporter call notion notion-create-pages --args '{}'`],
		["--server=notion", `mcporter call --server=notion --tool=notion-create-pages`],
		["a URL selector", `mcporter call https://mcp.notion.com/mcp.notion-create-pages --args '{}'`],
	];

	for (const [label, command] of NO_TOOL) {
		test(`${label} names the server but hides the tool, so it counts as a write`, () => {
			assert.deepEqual(parse(command), { kind: "unparsed-write", cause: "form", tool: null });
			assert.ok(denial(command).includes("mcporter call notion.<tool> --args"), denial(command));
		});
	}

	test("an outbox file that the shell cannot read is denied", () => {
		const command = outboxCommand("notion-create-pages", `${OUTBOX_DIR}/absent.json`);
		assert.deepEqual(parse(command), { kind: "unparsed-write", cause: "missing", tool: "notion-create-pages", outbox: `${OUTBOX_DIR}/absent.json` });
		assert.match(denial(command), /^Notion write denied\. The shell cannot read the outbox file from its working directory: \.claude\/state\/outbox\/absent\.json\.\n1\. Write/);
	});

	test("an outbox file that is not JSON is denied", () => {
		const read = outboxOf({ [OUTBOX]: `{"pages": [{"content": "a\nb"}]` });
		assert.deepEqual(parseCommand(create, read), { kind: "unparsed-write", cause: "not-json", tool: "notion-create-pages", outbox: OUTBOX });
		assert.match(denial(create, read), /The outbox file is not valid JSON: \.claude\/state\/outbox\/note\.json\.\n/);
	});

	for (const [label, text] of [
		["an array", "[]"],
		["null", "null"],
		["a string", `"{}"`],
		["a number", "1"],
	] as const) {
		test(`an outbox file that holds ${label} is denied`, () => {
			const read = outboxOf({ [OUTBOX]: text });
			assert.deepEqual(parseCommand(create, read), { kind: "unparsed-write", cause: "not-object", tool: "notion-create-pages", outbox: OUTBOX });
			assert.match(denial(create, read), /The outbox file must hold one JSON object: \.claude\/state\/outbox\/note\.json\.\n/);
		});
	}
});

describe("a command that is not a Notion write", () => {
	const READS: ReadonlyArray<readonly [string, string]> = [
		["inline --args", `mcporter call notion.notion-fetch --args '{"id":"abc"}'`],
		["key:value arguments", `mcporter call notion.notion-search query:"north star" page_size:5`],
		["a pipe", `mcporter call notion.notion-query-data-sources --args '{"data":{}}' | jq '.results[]'`],
		["a redirect", `mcporter call notion.notion-get-self > /tmp/self.json 2>&1`],
		["a here-document", `mcporter call notion.notion-fetch --args "$(cat <<'EOF'\n{"id":"abc"}\nEOF\n)"`],
		["the function-call syntax", `mcporter call 'notion.notion-fetch(id: "abc")'`],
		["no call word", `mcporter notion.notion-get-self`],
		["two reads", `mcporter call notion.notion-get-users && mcporter call notion.notion-get-teams`],
		["a read with a write tool name in its arguments", `mcporter call notion.notion-search query:notion-create-pages`],
		["a read with a write command in its arguments", `mcporter call notion.notion-search --args '{"query":"mcporter call notion.notion-create-pages"}'`],
	];
	for (const [label, command] of READS) {
		test(`a read call passes with ${label}`, () => {
			assert.deepEqual(parse(command), { kind: "not-notion-write" }, command);
			assert.deepEqual(decide(parse(command)), { kind: "pass" });
		});
	}

	const OTHER: ReadonlyArray<readonly [string, string]> = [
		["a command with no mcporter", "npm test"],
		["an empty command", ""],
		["a search for the write command", `rg -n "mcporter call notion.notion-create-pages" .claude`],
		["a search for mcporter", "rg mcporter .claude/scripts | rg notion-create-pages"],
		["a commit message that quotes the write command", `git commit -m "docs: show mcporter call notion.notion-create-pages --args '{}'"`],
		["an echo of the write command", `echo 'mcporter call notion.notion-create-pages --args {}'`],
		["a comment", `ls # mcporter call notion.notion-create-pages --args '{}'`],
		["a here-document that quotes the write command", `gh pr create --body "$(cat <<'EOF'\n## Usage\nmcporter call notion.notion-create-pages --args '{}'\nEOF\n)"`],
		["a here-document with a tab-stripped end", `cat <<-EOF > notes.txt\n\tmcporter call notion.notion-create-pages --args '{}'\n\tEOF\nls`],
		["a file write of the outbox", `cat ${OUTBOX}`],
		["the tool list of the server", "mcporter list notion --schema"],
		["the login of the server", "mcporter auth notion"],
		["a call to another server", `mcporter call slack.post_message text="see https://www.notion.com/x and notion.notion-create-pages"`],
		["a call to another server with a Notion link", "mcporter call slack.post_message channel:general text:https://app.notion.com/p/abc"],
		["the help of mcporter", "mcporter call --help"],
	];
	for (const [label, command] of OTHER) {
		test(`${label} passes`, () => {
			assert.deepEqual(parse(command), { kind: "not-notion-write" }, command);
			assert.deepEqual(decide(parse(command)), { kind: "pass" });
		});
	}

	test("a command after a here-document is still a command", () => {
		const command = `cat <<EOF > notes.txt\ntext\nEOF\nmcporter call notion.notion-delete-pages --args '{}'`;
		assert.equal(parse(command).kind, "unparsed-write");
	});

	test("the parser does not read an outbox file for a command that is not a write", () => {
		const read = (): string | null => assert.fail("the parser read a file");
		assert.equal(parseCommand(`mcporter call notion.notion-fetch --args "$(cat ${OUTBOX})"`, read).kind, "not-notion-write");
		assert.equal(parseCommand("ls", read).kind, "not-notion-write");
	});
});

describe("the simple commands of a shell command line", () => {
	const CASES: ReadonlyArray<readonly [string, string, string[][]]> = [
		["words", "a b  c", [["a", "b", "c"]]],
		["control operators", "a; b && c || d | e & f", [["a"], ["b"], ["c"], ["d"], ["e"], ["f"]]],
		["single quotes", `a 'b; c' d`, [["a", "b; c", "d"]]],
		["double quotes with an escape", `a "b \\" c" d`, [["a", `b " c`, "d"]]],
		["an empty word", `a '' b`, [["a", "", "b"]]],
		["a backslash", `a\\ b c\\;d`, [["a b", "c;d"]]],
		["a substitution in double quotes", `a "x$(b c)y"`, [["b", "c"], ["a", "xy"]]],
		["a nested substitution", `a $(b $(c))`, [["c"], ["b", ""], ["a", ""]]],
		["a redirect", "a > b 2>&1 < c &> d", [["a", "b", "2", "1", "c", "d"]]],
		["a here-string", "a <<< b", [["a", "b"]]],
		["a here-document", "a <<EOF\nb; c\nEOF\nd", [["a"], ["d"]]],
		["a here-document with no end", "a <<EOF\nb; c", [["a"]]],
		["a comment", "a # b; c\nd", [["a"], ["d"]]],
		["a hash inside a word", "a b#c", [["a", "b#c"]]],
		["an open quote", `a 'b; c`, [["a", "b; c"]]],
	];
	for (const [label, command, expected] of CASES) {
		test(label, () => assert.deepEqual(simpleCommands(command), expected));
	}
});
