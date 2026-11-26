---
date: 2026-04-07
description: "Workspace workflows and slash commands: reusable patterns for review prep, project tracking, and workspace maintenance"
tags:
  - brain
  - index
---

# Skills

Custom slash commands, subagents, and reusable workflows. Defined in `.claude/commands/` and `.claude/agents/`. **This file is the canonical command catalog** for a reader that does not get the in-session skills list of Claude Code. Keep it current when commands change. AGENTS.md has no command table on purpose. This file stays in the repository, because it catalogs repository commands, not notes.

## Slash Commands

### Daily Workflow

| Command | Purpose |
|---------|---------|
| `/om-standup` | Morning kickoff: load context, review yesterday, surface tasks, identify priorities |
| `/om-dump` | Freeform capture: dump anything, and it goes to the right Notion rows with properties and relations |
| `/om-wrap-up` | Full session review: verify rows, links, and properties, and suggest improvements. Runs on "wrap up" |

### Editing & Synthesis

| Command | Purpose |
|---------|---------|
| `/om-humanize` | Voice-calibrated editing: makes text that Claude drafted sound like you wrote it |
| `/om-weekly` | Weekly synthesis: cross-session patterns, North Star alignment, uncaptured wins |

### Meeting Prep & Capture

| Command | Purpose |
|---------|---------|
| `/om-prep-1on1` | Prep for an upcoming 1:1: load person context, open items, wins to share, suggested agenda |
| `/om-capture-1on1` | Capture a 1:1 transcript into a structured `Work` row with quotes, action items, and DM context |
| `/om-incident-capture` | Capture an incident from Slack channels and DMs into structured rows: timeline, people, analysis, brag entry |
| `/om-slack-scan` | Deep scan Slack channels and DMs for evidence: timestamped touchpoints, organized by context |
| `/om-meeting` | Prep for any meeting by topic: a subject-forward briefing with open items, blockers, and considerations |
| `/om-intake` | Process the meeting notes inbox: classify the `Work` rows with `Type` Inbox item and route them to the right rows |

### Performance & Review

| Command | Purpose |
|---------|---------|
| `/om-peer-scan` | Deep scan the GitHub PRs of a peer for review prep. Saves a `Perf docs` row with `Type` PR evidence |
| `/om-review-brief` | Generate a review brief (manager or peer version) from workspace data |
| `/om-self-review` | Write a self-assessment for the review tool: projects, competencies, principles |
| `/om-review-peer` | Write a peer review: projects, principles, performance summary |

### Workspace Maintenance

| Command | Purpose |
|---------|---------|
| `/om-correct` | Sweep a corrected fact through Notion: search, apply at the single source, replace restatements with mentions, keep pages that record what was believed at the time. The acting half of Write-Correctness Law 2 |
| `/om-vault-audit` | Deep structural audit: scaffold pages, databases, properties, links, views, and the rows edited outside the hooks |
| `/om-project-archive` | Mark a completed project done: set `Status` to `completed` on each row of its `Project`, so it leaves the active views |
| `/om-tidy` | Self-maintenance pass: acts on every hygiene flag. Completes finished work, groups loose clusters, splits oversized rows, reports open loops. Never deletes |

## Usage Notes

**Daily:**
- `/om-standup` replaces the manual session start. It reads North Star, active work, open tasks, and the recent changes
- `/om-dump` processes freeform text and routes each piece to the correct database and `Type`
- `/om-wrap-up` runs when you say "wrap up". It runs the full session review

**Editing & Synthesis:**
- `/om-humanize` calibrates against your real writing samples, not a word blacklist. It reads the context from the properties of the row (review → corporate-confident, incident → precise, 1:1 → conversational). Run it after you draft any note.
- `/om-weekly` bridges standup and review brief. Run it at the end of the week for cross-session patterns, North Star drift, and uncaptured wins. Its output is transient. It offers to promote findings to the brag quarter or North Star.

**Capture:**
- `/om-capture-1on1` takes transcripts, raw notes, or summaries
- `/om-incident-capture` takes Slack URLs and produces structured incident rows
- Run `/om-slack-scan` AFTER `/om-peer-scan` to add context beyond code (leadership, communication, collaboration evidence)

**Performance:**
- `/om-peer-scan` works best as parallel agents (one for each person)
- `/om-review-brief` needs the private brief first. It makes the filtered versions from it

**Maintenance:**
- Run `/om-vault-audit` at the end of substantial sessions. It catches empty properties, orphans, and mixed context
- `/om-project-archive` sets the status. Notion has no folders, so no file moves

## Subagents

| Agent | Purpose | Invoked by |
|-------|---------|------------|
| `brag-spotter` | Finds uncaptured wins and competency gaps | `/om-wrap-up`, `/om-weekly` |
| `context-loader` | Loads all Notion context about a person, project, incident, or concept | Direct: "load context on X" |
| `correction-sweep` | Finds every page that restates a corrected fact and classifies it. Never edits | `/om-correct` |
| `cross-linker` | Finds missing relations and mentions, orphans, and one-way links | `/om-vault-audit` |
| `people-profiler` | Bulk creates or updates `People` rows from Slack profiles | `/om-incident-capture` |
| `review-prep` | Aggregates all performance evidence for a review period | `/om-review-brief` |
| `slack-archaeologist` | Full Slack reconstruction: every message, thread, and profile, as one timeline | `/om-incident-capture` |
| `vault-librarian` | Deep workspace maintenance: orphans, broken links, empty properties, stale rows | `/om-vault-audit` |
| `review-fact-checker` | Verifies every claim in a review draft against Notion sources | `/om-self-review`, `/om-review-peer` |
| `vault-migrator` | Classifies and migrates content from a source vault. The import tool takes it over | None until the import tool lands |

Subagents run in isolated context windows through `.claude/agents/`. They do not fill the main conversation.

## Hooks

| Hook | When | What |
|------|------|------|
| SessionStart | On startup and resume | Reads the workspace and injects North Star, brain topics, recent changes, open tasks, active work, the listing, and the hygiene findings |
| UserPromptSubmit | Every message | Classifies content (decision, incident, 1:1, win, architecture, person, project update) and injects routing hints |
| PreToolUse | Before each `Bash` command | Passes a Notion command only in the write, read, schema, or login form |
| PostToolUse | After a Notion write | Checks the properties and the links, sets the derived properties, and deletes the outbox file |
| PostToolUseFailure | After a failed Notion write | Adds a missing select option, then asks for the same command again |
| PreCompact | Before context compaction | Backs up the session transcript to `.claude/state/session-logs/` |
| Stop | After every response | Checklist and hygiene findings, once per session and again when they change. Ask the agent to run `/om-tidy` to act |

## Search

Search with `notion-search` in the read form of `.claude/rules/notion-calls.md`. Give it short keywords, and the `data_source_url` of one database when you know where the note lives. Then fetch only the pages that match.

## Workflow: Weekly Review

1. **`/om-weekly`**: synthesize the activity of the week, check alignment, find patterns
2. Promote any uncaptured wins to the brag quarter
3. Update North Star if focus shifted
4. **`/om-wrap-up`**: close the session cleanly

## Workflow: Full Review Cycle Prep

1. **`/om-review-brief manager`**: generate the manager context transfer doc
2. **`/om-review-brief peers`**: generate the peer context transfer doc
3. **`/om-peer-scan`** (parallel, one for each peer): deep scan the PRs of each peer
4. **`/om-slack-scan`**: scan relevant channels for your own evidence and peer context
5. **`/om-capture-1on1`**: capture the review 1:1 with your manager
6. **`/om-vault-audit`**: tidy up after all the new data

## Workflow: Project Ramp-Up

1. **`/om-slack-scan`**: scan project channels for history and decisions
2. **`/om-peer-scan`** (if needed): learn what teammates have already built
3. Create a work row from the gathered context
4. **`/om-vault-audit`**: make sure everything links properly
