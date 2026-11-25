/**
 * The hook payloads that Claude Code 2.1.329 sent for one `mcporter` write
 * through `Bash` in a headless session. They are verbatim, with a placeholder
 * for each ID and each local path.
 */

type CapturedPayload = { readonly hook_event_name: string; readonly tool_name: string; readonly tool_input: { readonly command: string } };

export const CAPTURED_PRE_TOOL_USE = JSON.parse(String.raw`{
 "session_id": "<session-id>",
 "transcript_path": "<transcript-path>",
 "cwd": "<scratch-worktree>",
 "prompt_id": "<prompt-id>",
 "permission_mode": "auto",
 "effort": {
  "level": "high"
 },
 "hook_event_name": "PreToolUse",
 "tool_name": "Bash",
 "tool_input": {
  "command": "mcporter call notion.notion-create-pages --args '{\"parent\":{\"page_id\":\"<page-id>\"},\"allow_async\":false,\"pages\":[{\"properties\":{\"title\":\"hook capture page\"},\"content\":\"Line one of the body.\\\\n\\\\n[[North Star]]\"}]}'",
  "description": "Create a Notion page through mcporter"
 },
 "tool_use_id": "<tool-use-id>"
}`) as CapturedPayload;

export const CAPTURED_POST_TOOL_USE = JSON.parse(String.raw`{
 "session_id": "<session-id>",
 "transcript_path": "<transcript-path>",
 "cwd": "<scratch-worktree>",
 "prompt_id": "<prompt-id>",
 "permission_mode": "auto",
 "effort": {
  "level": "high"
 },
 "hook_event_name": "PostToolUse",
 "tool_name": "Bash",
 "tool_input": {
  "command": "mcporter call notion.notion-create-pages --args '{\"parent\":{\"page_id\":\"<page-id>\"},\"allow_async\":false,\"pages\":[{\"properties\":{\"title\":\"hook capture page\"},\"content\":\"Line one of the body.\\\\n\\\\n[[North Star]]\"}]}'",
  "description": "Create a Notion page through mcporter"
 },
 "tool_response": {
  "stdout": "{\n  \"pages\": [\n    {\n      \"id\": \"<page-id>\",\n      \"url\": \"https://app.notion.com/p/<page-id>?pvs=204\",\n      \"properties\": {\n        \"title\": \"hook capture page\"\n      }\n    }\n  ]\n}",
  "stderr": "",
  "interrupted": false,
  "isImage": false,
  "noOutputExpected": false
 },
 "tool_use_id": "<tool-use-id>",
 "duration_ms": 2074
}`) as CapturedPayload;
