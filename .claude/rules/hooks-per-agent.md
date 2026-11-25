Shared section: Claude Code and Grok load it at session start; other agents read it when AGENTS.md points here.

## Hooks

The hook scripts in `.claude/scripts/` are agent-agnostic TypeScript and shell, executed natively by Node via `--experimental-strip-types` — no build step, no runtime dependencies, no Claude SDK. Claude Code loads them through `.claude/settings.json`.

| Script | Purpose | Claude event |
|--------|---------|--------------|
| `session-start.ts` | Inject vault context at startup | SessionStart |
| `classify-message.ts` | Classify messages, inject routing hints, hand over the last Stop report | UserPromptSubmit |
| `validate-write.ts` | Validate frontmatter and wikilinks | PostToolUse |
| `pre-compact.ts` | Back up transcript before compaction | PreCompact |
| `stop-checklist.ts` | Wrap-up checklist and vault-hygiene drift findings, per response, deduped | Stop |
