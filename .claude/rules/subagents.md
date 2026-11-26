# Subagents (Claude Code)

| Folder | Purpose | Key Files |
|--------|---------|-----------|
| `.claude/agents/` | Subagents | See subagents table below |

## Subagents

Specialized agents in `.claude/agents/` for heavy operations. They run in isolated context windows. Each reads and writes Notion in the forms of `.claude/rules/notion-calls.md`.

| Agent | Purpose | Invoked by |
|-------|---------|------------|
| `brag-spotter` | Finds uncaptured wins and competency gaps | `/om-wrap-up`, `/om-weekly` |
| `context-loader` | Loads all Notion context about a person, project, or concept | Direct |
| `correction-sweep` | Finds every page that restates a corrected fact. Classifies each as authoritative, restatement, or historical. Never edits | `/om-correct` |
| `cross-linker` | Finds missing relations and mentions, orphans, and one-way links | `/om-vault-audit` |
| `people-profiler` | Bulk creates or updates `People` rows from Slack profiles | `/om-incident-capture` |
| `review-prep` | Aggregates all performance evidence for a review period | `/om-review-brief` |
| `slack-archaeologist` | Full Slack reconstruction: every message, thread, and profile | `/om-incident-capture` |
| `vault-librarian` | Deep workspace maintenance: orphans, broken links, empty properties, stale rows | `/om-vault-audit` |
| `review-fact-checker` | Verifies every claim in a review draft against Notion sources | `/om-self-review`, `/om-review-peer` |
| `vault-migrator` | Imports a Markdown vault of the Obsidian template with `notion-import.ts`: a dry run to approve, the import, a second run that must make no page, and a check of each page | Direct |
