# Hooks and the obsidian-mind Mod (Claude Code)

| Folder | Purpose | Key Files |
|--------|---------|-----------|
| `.claude/scripts/` | Hook scripts, the Notion client, the setup, and the parity harness | `session-start.ts`, `classify-message.ts`, `guard-notion-write.ts`, `validate-write.ts`, `pre-compact.ts`, `stop-checklist.ts`, `notion-setup.ts`, `parity/` |

The hook scripts are TypeScript. Node 22.6 or later runs them directly with `--experimental-strip-types`, so there is no build step. The runtime has no npm dependency. The Notion client imports the runtime of the `mcporter` that `which mcporter` finds.

## Hooks

The lifecycle hooks in `.claude/settings.json`:

| Hook | When | What |
|------|------|------|
| SessionStart | On startup, resume, `/clear`, and compaction | Reads the workspace through `notion-map.json` and injects North Star, the brain topics index, the rows changed in 48 hours, open tasks, active work, the workspace listing (a group past a row-count threshold collapses to one line), and the hygiene findings. The injection stays under a byte budget that fits the 10,000-character hook output cap of Claude Code. Over the budget, low-priority sections become pointers, and the closing size meter names each one that it dropped. A part that the hook cannot read shows `(not read: cause)` |
| UserPromptSubmit | Every message | Classifies content (decision, incident, win, 1:1, architecture, person, project update) and injects routing hints that name the Notion database for each. Also gives the agent a Stop report that was saved since the last prompt |
| PreToolUse | Before each `Bash` command | Passes a command that names `mcporter` and Notion only in the forms of `.claude/rules/notion-calls.md`. Denies each other Notion command with the reason. When the guard cannot run, the command prints a denial, so the guard fails closed |
| PostToolUse | After a Notion write in the outbox form, and after a `Write` or `Edit` | For a Notion write: warns about empty required properties, a note with no link, and hard-wrapped prose. Flags a note past the 25KB organization threshold (split, don't trim) and a write-time topic cluster. Sets the derived properties of the row (`Bytes`, `Open tasks`, `Open loops`, `Has content`, `Changed`, `Hook stamp`) and deletes the outbox file. For a `Write` or `Edit`: flags a misplaced memory file |
| PostToolUseFailure | After a failed Notion write | Adds the select options that the write needs to the database, and says to run the same command again. The outbox file stays |
| PreCompact | Before context compaction | Backs up the session transcript to `.claude/state/session-logs/`, outside the note store |
| Stop | After every response | Checklist and the hygiene findings from the saved hygiene views (the same scan as SessionStart), shown once per session and again only when the findings change. Hands drift to `/om-tidy`. A Stop `systemMessage` reaches only the user, and every Stop output that reaches the agent is also printed in full for the user. So a changed report shows the user a one-line-per-section summary and saves the full report for the next prompt, where the UserPromptSubmit hook hands it to the agent unseen. The agent deals with the message of the user first, then acts, asks, or leaves it. If the report cannot be saved, it goes out as Stop feedback instead. SessionEnd and a Stop without a session id show the full report. For a thorough review, use `/om-wrap-up` instead |

The hooks find the repository root by the marker file `vault-manifest.json`. When SessionStart or Stop cannot read a part of the workspace (no login, no `mcporter`, no map file), the output names the part and the cause, and each other part stays.

**On Claude Code 2.1.287+, the `obsidian-mind` mod** (`.claude/skills/obsidian-mind/`) delivers the SessionStart context as an instruction file instead. It runs `session-start.ts` itself and passes the settings hook `om_mod: "standdown"` for that event. The context then survives compaction whole and reaches general-purpose subagents (Explore and Plan skip instruction files by design). `/memory` shows it as `.claude/session-context.md`. It also presents the Stop report. It runs `stop-checklist.ts` with `om_mod: "report"`, stands the Stop hook down, and draws one line under the answer when the findings changed. It hands the full report to the agent with the next prompt of the user, or with its own prompt for an urgent finding, at most one per prompt that the user sends. A typed prompt, a Remote Control prompt, an SDK prompt, and a Slack ping take the report. A peer message, a notification, and a scheduled prompt do not. Where the mod does not load (older Claude Code, an untrusted folder, a session started in a subfolder), the hooks above run unchanged.
