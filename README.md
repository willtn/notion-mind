🌐 **English** | [日本語](README.ja.md) | [中文](README.zh-CN.md) | [한국어](README.ko.md)

<p align="center">
  <img src="obsidian-mind-logo.png" alt="Obsidian Mind" width="120">
</p>

<h1 align="center">Obsidian Mind</h1>

[![Claude Code](https://img.shields.io/badge/claude%20code-writes%20%2B%20hooks-D97706)](https://docs.anthropic.com/en/docs/claude-code)
[![Notion](https://img.shields.io/badge/notion-the%20only%20note%20store-000000)](https://www.notion.com)
[![mcporter](https://img.shields.io/badge/mcporter-notion%20mcp-4B5563)](https://github.com/openclaw/mcporter)
[![Node](https://img.shields.io/badge/node-22.6%2B-339933)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> **A Notion workspace that gives AI coding agents persistent memory.** Claude Code writes to it through hooks that check every write. Any client reads it through Notion MCP. Start a session, talk about your day, and the agent handles the rest: notes, links, views, performance tracking. Every conversation builds on the last.

This repository started as an Obsidian vault template. The name stays. The notes moved: one Notion workspace is now the only store of notes, and the repository holds only the hooks, the commands, the subagents, and the setup.

---

## 🔴 The Problem

AI coding agents are powerful, but they forget. Every session starts from zero: no context on your goals, your team, your patterns, your wins. You explain the same things again. You lose decisions made three conversations ago. The knowledge never compounds.

## 🟢 The Solution

Give your agent a brain.

```
You: "start session"
Agent: *reads North Star, checks active projects, scans recent changes*
Agent: "You're working on Project Alpha, blocked on the BE contract.
        Last session you decided to split the coordinator. Your 1:1
        with your manager is tomorrow. The review brief is ready."
```

The brain is a Notion workspace. You read it on your phone, in the Notion app, or from any AI client that speaks Notion MCP. Only a Claude Code session in this repository writes to it, so every note that lands passes the same checks.

---

## ⚡ See It In Action

**Morning kickoff:**

```bash
/om-standup
# → loads North Star, active projects, open tasks, rows changed in the last 48 hours
# → "You have 2 active projects. The auth refactor is blocked on API contract.
#    Your 1:1 with Sarah is at 2pm. Last time she flagged observability."
```

**Brain dump after a meeting:**

```bash
/om-dump Just had a 1:1 with Sarah. She's happy with the auth work but wants
us to add error monitoring before release. Also, Tom mentioned the cache
migration is deferred to Q2, and we decided to focus on the API contract first.
Decision: defer Redis migration. Win: Sarah praised the auth architecture.
```

```
→ Updated the People row "Sarah Chen" with meeting context
→ Created the Work row "Sarah 2026-03-26" (Type 1:1) with key takeaways
→ Created the Work row "Defer Redis migration to Q2" (Type Decision)
→ Added to the Q1 brag quarter in Perf docs: "Auth architecture praised by manager"
→ Updated the Work row "Auth Refactor" with an error monitoring task
```

**Incident response:**

```bash
/om-incident-capture https://slack.com/archives/C0INCIDENT/p123456
# → slack-archaeologist reads every message, thread, and profile
# → people-profiler creates People rows for new people involved
# → Full timeline, root cause analysis, brag entry
```

**End of day:**

```
You: "wrap up"
# → verifies that every new row has a link
# → brag-spotter finds uncaptured wins
# → suggests improvements
```

---

## 🚀 Quick Start

### 📋 Requirements

- **Claude Code**: the only client that writes. The mod needs 2.1.287 or later.
- **Node.js 22.6 or later**: the hooks run TypeScript with `--experimental-strip-types`. No build step, no npm dependency at run time.
- **[mcporter](https://github.com/openclaw/mcporter)**: the hooks and the agent reach Notion through it.
- **A Notion workspace** that you can log in to through Notion MCP.

### 📦 Install

1. Clone the repository:

   ```bash
   git clone https://github.com/willtn/notion-mind.git obsidian-mind
   cd obsidian-mind
   ```

2. Add the Notion MCP server to `mcporter` and log in:

   ```bash
   mcporter config add notion https://mcp.notion.com/mcp
   mcporter auth notion
   ```

3. Build the workspace. The setup makes a private root page "obsidian-mind" with the databases, the views, the pages, and the templates, and writes `notion-map.json`:

   ```bash
   node --experimental-strip-types .claude/scripts/notion-setup.ts
   ```

   The setup finds each object by its name and makes only what is missing, so a second run makes nothing. `--check` makes nothing and fetches each object of the map file.

4. Open Claude Code in the repository and accept the trust prompt. The hooks and the mod load from `.claude/`.

5. Fill in North Star, add your people and your competencies, and run `/om-standup`.

> [!NOTE]
> `notion-map.json` holds the IDs of your workspace. It is in `.gitignore`. `notion-map.example.json` shows its shape with placeholders.

---

## ⚙️ How It Works

**Procedural code owns the environment. The agent owns content.** The hooks in `.claude/scripts/` handle classification, validation, the derived properties, and lifecycle injection. They are deterministic and tested. Writing notes, filing them, linking them, and drafting briefs are judgments, and they stay with the agent.

**Databases group by purpose. Links group by meaning.** A note lives in one database but links to many notes. Your agent keeps this graph: it links work rows to people, decisions, and competencies with relation properties. When review season arrives, the `Evidence` relation of each competency is already the evidence trail. A note without links is a bug.

**Workspace-first memory** keeps context across sessions and machines. All durable knowledge lives in the brain topic rows of `Knowledge`. Claude Code's `MEMORY.md` in `~/.claude/` is an index that points to Notion pages, never the storage itself.

**Sessions have a designed lifecycle.** The `SessionStart` hook injects your North Star goals, active projects, recent changes, open tasks, and the workspace listing, so the agent starts every session with context. At the end, say "wrap up" and the agent runs `/om-wrap-up`. `AGENTS.md` governs everything in between: where to file things, how to link, when to split a note, what to do with decisions and incidents.

### 📖 The read path

Any client reads the workspace through Notion MCP: Claude Code, the Claude apps, or another MCP client. A read needs no hook. A remote client cannot read a repository file, so the setup also writes a "Reader map" page under the root. It lists each database, view, and page that `notion-map.json` holds.

Inside a hooked Claude Code session, a read is a `Bash` command:

```bash
mcporter call notion.notion-search --args '{"query":"auth refactor","query_type":"internal"}' --output json
```

### ✍️ The write path

Only a Claude Code session that loads the hooks of this repository writes. A write has two steps:

1. The agent writes the JSON arguments to `.claude/state/outbox/<name>.json` with the `Write` tool.
2. It runs `mcporter call notion.<tool> --args "$(cat .claude/state/outbox/<name>.json)"`.

Three hooks watch that call:

- **The guard** (`PreToolUse`) passes a Notion command only in the write, read, schema, or login form, and denies each other form with the reason. A hook can only check a write whose arguments it can read, so the guard makes every write readable. When the guard cannot run, the command denies, so the guard fails closed.
- **The write check** (`PostToolUse`) reads the outbox file. It warns about empty required properties, a note with no link, and hard-wrapped prose. It flags a note past 25 KB (split, don't trim) and a topic cluster. Then it sets the derived properties of the row (`Bytes`, `Open tasks`, `Open loops`, `Has content`, `Changed`, `Hook stamp`) and deletes the outbox file.
- **The repair** (`PostToolUseFailure`) adds a missing select option to the database after a failed write, and asks the agent to run the same command again.

The derived properties let the hygiene scan run as view queries instead of one fetch for each page. `Changed` is the age of a note: a property write moves Notion's own `Last edited`, so no age rule reads it. `Hook stamp` marks a hooked write. The view "Hygiene: edited outside hooks" lists each row that another client changed later, and `/om-vault-audit` reads it.

The full call forms are in [`.claude/rules/notion-calls.md`](.claude/rules/notion-calls.md).

### 🔗 Hooks

| Hook | When | What |
|------|------|------|
| 🚀 SessionStart | On startup, resume, `/clear`, and compaction | Reads the workspace and injects North Star, the brain topics, recent changes, open tasks, active work, the listing, and the hygiene findings, under a byte budget that fits the hook output cap of Claude Code. Ends with a size meter |
| 💬 UserPromptSubmit | Every message | Classifies content (decision, incident, win, 1:1, architecture, person, project update) and injects routing hints that name the right database. Also hands the agent the Stop report of the previous turn |
| 🛡️ PreToolUse | Before each `Bash` command | The guard: passes a Notion command only in the forms that the write check can read |
| ✍️ PostToolUse | After a Notion write, and after a `Write` or `Edit` | The write check and the derived properties. For a `Write` or `Edit`: flags a misplaced memory file |
| 🩹 PostToolUseFailure | After a failed Notion write | Adds the missing select options, then asks for the same command again |
| 💾 PreCompact | Before context compaction | Backs up the session transcript to `.claude/state/session-logs/`, outside the note store |
| 🏁 Stop | After every response | Checklist and the hygiene findings from the saved hygiene views, shown once per session and again only when they change. You see a short summary, and the agent gets the full report with your next message |

> [!TIP]
> You just talk. The hooks handle the routing.

### 🧩 The Claude Code mod

On Claude Code 2.1.287 or later, the repository also ships a mod: `.claude/skills/obsidian-mind/`, a plugin whose code runs inside Claude Code. It runs the same hook scripts and changes only how their output reaches the session:

- **Session context arrives as an instruction file**, the way `AGENTS.md` does. Claude Code reads it again whole after compaction and `/clear`, it reaches general-purpose subagents, and the 10,000-character hook limit does not cut it. Its budget is `eager_layer_instruction_budget_bytes` in `vault-manifest.json`. `/memory` lists it as `.claude/session-context.md`.
- **The Stop report becomes one line under the answer.** When the findings change, you see a line under the reply of Claude that starts with the name of the mod: `obsidian-mind: vault check: …`. When another plugin also answers on Stop, Claude Code joins the names with `+`. Claude gets the full report with your next message, unseen. A finding marked urgent gets the attention of Claude at once instead, once for each message you send.

For each event it handles, the mod tells the matching hook to stand down. Where the mod does not load, the hooks run as before: older Claude Code, a session started in a subfolder (launch from the repository root, or `/cd` there and `/clear`), or a folder you have not trusted.

A mod is unsandboxed code that runs with your permissions, so check what it does before you trust the folder: `claude plugin validate .claude/skills/obsidian-mind` lists every event it hooks and every call it makes. To turn it off, add `"enabledPlugins": { "obsidian-mind@skills-dir": false }` to `.claude/settings.local.json`.

<!-- mod-validate:start -->
The two lines that matter in its output, for this version of the mod:

```text
  ❯ ./register.ts hooks: classic.SessionStart, prompt.context, classic.Stop, turn.complete, prompt.submit, turn.start
  ❯ ./register.ts calls: $.fs.write, $.process.run (via runScript), $.prompt.submit, $.session.root, $.state.get, $.state.set, $.store.get (via setShown, shownFor), $.store.set (via setShown), $.ui.invalidate
```
<!-- mod-validate:end -->

### ⚡ Token Efficiency

obsidian-mind does **not** dump your workspace into context:

| Tier | What | When | Cost |
|------|------|------|------|
| **Always** | `AGENTS.md`, `.claude/rules/`, and the SessionStart context (North Star excerpt, recent changes, tasks, listing) | Session start | Capped by the budget in `vault-manifest.json`, under the 10,000-character hook output cap. The meter reports the real size every session |
| **On demand** | `notion-search` results, then the pages that match | When the agent needs specific context | Targeted |
| **Triggered** | Classification routing hints | Every message | ~100 tokens |
| **Triggered** | Write check findings | After a Notion write | ~200 tokens |

SessionStart loads titles, counts, and short excerpts, not full pages. Over the budget, the cheapest sections become pointers, and the meter names each one that it dropped. A group of the listing past a row-count threshold folds to one count line.

---

## 🗂️ The Workspace

The setup builds one private root page, "obsidian-mind", with seven databases:

| Database | Holds |
|----------|-------|
| `Work` | Work notes, decisions, incidents, 1:1 notes, inbox items, and thinking notes, told apart by `Type`. `Status` replaces the active and archive folders, and `Project` groups a workstream |
| `People` | One row for each person, with `Team` |
| `Teams` | One row for each team, with `Members` |
| `Competencies` | One row for each competency, with `Evidence` from work rows and an `Evidence count` rollup |
| `Perf docs` | PR evidence, review briefs, review artifacts, and brag quarters |
| `Knowledge` | Brain topics (Key Decisions, Patterns, Gotchas), reference notes, domain notes, event-log satellites, and archive notes |
| `Templates` | One row for each template |

And these pages: **Home** (the dashboard, with linked views and the Current Focus of North Star), **North Star**, **People & Context**, **Recently Touched** (one view of each database sorted by `Changed`), and **Reader map**.

**Relations replace wikilinks** where a view, a rollup, or a hygiene check reads the link: `Work.Decisions`, `Work.Competencies`, `Work.Person`, `Work.Team`, `Work.Feeds into`, `Perf docs.Work evidence`, and `Parent`. Every other link is a page mention in the body.

**Saved views replace the Bases and the hand-kept indexes.** Examples: Active Work, Stale Actives, Completed, Incidents, 1:1 History, Competency Map, Review Evidence, Brain index. The hooks read the hygiene views (oversized, open loops, inbox pressure, loose active) in view mode, which has no plan quota.

**Templates** are rows of `Templates`: Work Note, Decision Record, Thinking Note, Competency Note, and Review Template.

---

## 📅 Daily Workflow

**Morning**: Run `/om-standup`. Your agent loads your North Star, active projects, open tasks, and recent changes. You get a structured summary and suggested priorities.

**Throughout the day**: Talk naturally. Mention a decision you made, an incident that happened, a 1:1 you just had, a win you want to remember. The classification hook nudges the agent to file each piece in the right database. For bigger brain dumps, use `/om-dump` and narrate everything at once.

**End of day**: Say "wrap up" and the agent invokes `/om-wrap-up`. It verifies rows, checks links, and spots uncaptured wins.

**Weekly**: Run `/om-weekly` for cross-session synthesis: North Star alignment, patterns, uncaptured wins, and next-week priorities. Run `/om-vault-audit` to catch orphan rows, empty properties, and rows edited outside the hooks.

**Review season**: Run `/om-review-brief manager` and get a structured review prep document with all the evidence already linked.

---

## 🛠️ Commands

Defined in `.claude/commands/`. Run them in Claude Code.

| Command | What It Does |
|---------|-------------|
| `/om-standup` | Morning kickoff: loads context, reviews yesterday, surfaces tasks, suggests priorities |
| `/om-dump` | Freeform capture: talk naturally about anything, and it routes each piece to the right rows |
| `/om-wrap-up` | Full session review: verify rows, links, and properties, and suggest improvements |
| `/om-humanize` | Voice-calibrated editing: makes text that Claude drafted sound like you wrote it |
| `/om-weekly` | Weekly synthesis: cross-session patterns, North Star alignment, uncaptured wins |
| `/om-capture-1on1` | Capture a 1:1 meeting transcript into a structured `Work` row |
| `/om-incident-capture` | Capture an incident from Slack into structured rows |
| `/om-slack-scan` | Deep scan Slack channels and DMs for evidence |
| `/om-peer-scan` | Deep scan the GitHub PRs of a peer for review prep |
| `/om-review-brief` | Generate a review brief (manager or peer version) |
| `/om-self-review` | Write your self-assessment for review season: projects, competencies, principles |
| `/om-review-peer` | Write a peer review: projects, principles, performance summary |
| `/om-tidy` | Self-maintenance: acts on every hygiene flag. Completes, groups, splits. Never deletes |
| `/om-correct` | Sweep a corrected fact: applies it at the single source, links restatements, keeps dated records |
| `/om-vault-audit` | Audit properties, links, orphans, views, and rows edited outside the hooks |
| `/om-prep-1on1` | Prep for an upcoming 1:1: person context, open items, suggested agenda |
| `/om-meeting` | Prep for any meeting by topic: a subject-forward briefing with open items and considerations |
| `/om-intake` | Process the meeting notes inbox: classify the inbox items and route them to the right rows |
| `/om-project-archive` | Mark a completed project done, so it leaves the active views |

---

## 🤖 Subagents

Specialized agents that run in isolated context windows. They handle heavy operations without filling your main conversation.

| Agent | Purpose | Invoked by |
|-------|---------|------------|
| `brag-spotter` | Finds uncaptured wins and competency gaps | `/om-wrap-up`, `/om-weekly` |
| `context-loader` | Loads all Notion context about a person, project, or concept | Direct |
| `correction-sweep` | Finds every page that restates a corrected fact and classifies it. Never edits | `/om-correct` |
| `cross-linker` | Finds missing relations and mentions, orphans, and one-way links | `/om-vault-audit` |
| `people-profiler` | Bulk creates or updates `People` rows from Slack profiles | `/om-incident-capture` |
| `review-prep` | Aggregates all performance evidence for a review period | `/om-review-brief` |
| `slack-archaeologist` | Full Slack reconstruction: every message, thread, and profile | `/om-incident-capture` |
| `vault-librarian` | Deep workspace maintenance: orphans, broken links, empty properties, stale rows | `/om-vault-audit` |
| `review-fact-checker` | Verifies every claim in a review draft against Notion sources | `/om-self-review`, `/om-review-peer` |
| `vault-migrator` | Imports a Markdown vault of the Obsidian template with `notion-import.ts`: a dry run to approve, the import, a second run that must make no page, and a check of each page | Direct |

> [!NOTE]
> Subagents are defined in `.claude/agents/`. You can add your own for domain-specific workflows.

---

## 📊 Performance Graph

The workspace doubles as a performance tracking system:

1. **`Competencies` rows** define the competency framework of your org, one row for each competency
2. **Work rows** set their `Competencies` relation, with what was demonstrated in the body
3. **Evidence accumulates automatically**: the reverse relation `Evidence` and the `Evidence count` rollup fill as you go, and the Competency Map view sorts by them
4. **Brag quarters** in `Perf docs` collect wins for each quarter, with `Work evidence` set
5. **`/om-peer-scan`** deep-scans the GitHub PRs of a colleague and writes a `Perf docs` row with `Type` PR evidence
6. **`/om-review-brief`** generates a full review brief from brag quarters, decisions, incidents, competency evidence, and 1:1 feedback

> [!TIP]
> To get started: create competency rows from the template, then link your work rows to them as you go. The graph does the rest.

---

## 🧪 Parity With the Obsidian Version

Commit `fae7be4` is the last Obsidian version, and it is the reference for each hook. The parity harness in `.claude/scripts/parity/` runs the hook at that commit on a Markdown fixture vault and the ported hook on the same notes in Notion, then compares the findings, the notes, and the counts:

```bash
cd .claude/scripts
node --experimental-strip-types parity/run-parity.ts                       # the reference against itself
node --experimental-strip-types parity/run-parity.ts --notion --hook validate-write
node --experimental-strip-types parity/run-mutations.ts --notion --hook validate-write
```

`--notion` needs a second root for the fixtures, made with `notion-setup.ts --root-title "obsidian-mind parity fixtures" --map notion-map.fixtures.json` and filled by `parity/write-notion-fixture.ts`. `npm test` runs the same comparison offline on a stand-in runtime. The live tests run only with `NOTION_LIVE=1` and a map file, and skip in each other run. The record of each check and each known difference is [`NOTION-PORT-DESIGN.md`](NOTION-PORT-DESIGN.md), part (d).

---

## 📥 Importing an Existing Vault

`notion-import.ts` moves a Markdown vault of the Obsidian template into the workspace ([#14](https://github.com/willtn/notion-mind/pull/14)). Run the setup first, because the import needs the map file. Then run these commands from the repository root:

```bash
node --experimental-strip-types .claude/scripts/notion-import.ts --vault ../my-vault --dry-run
node --experimental-strip-types .claude/scripts/notion-import.ts --vault ../my-vault
node --experimental-strip-types .claude/scripts/notion-import.ts --vault ../my-vault --verify
```

The dry run makes no Notion call. It prints the place of each note, each file that the import leaves out, and each construct that loses form. The import reads the vault and never changes it. Each note becomes a row with its path in the property `Source path`, so a second run makes no page and writes only a note that changed. `--verify` fetches each page and compares it with the plan. The `vault-migrator` subagent runs these steps, and it asks for your approval after the dry run.

---

## ⚠️ Known Limits

Each limit below comes from a measurement in the pull request that it links.

- **The guard trusts a cooperative agent.** A command that hides the word `notion` or `mcporter` on purpose, or a script file that holds the call, passes the guard. The `Hook stamp` audit flags such a write after the fact. A guard that runs past its 5 s timeout lets the call run. ([#6](https://github.com/willtn/notion-mind/pull/6))
- **Text that names both `mcporter` and `notion` is a denied command.** Write a commit message or a PR body to a file and use `git commit -F` or `gh pr create --body-file`. ([#6](https://github.com/willtn/notion-mind/pull/6))
- **Notion cannot tell clients apart.** A write from another MCP client looks the same as a hooked write. Only the `Hook stamp` view shows it. ([#5](https://github.com/willtn/notion-mind/pull/5), [#8](https://github.com/willtn/notion-mind/pull/8))
- **A select takes no new option on a write.** `Quarter`, `Project`, `Cycle`, and the level selects start empty. The first write with a new option fails, the repair hook adds it, and the agent runs the command again. ([#5](https://github.com/willtn/notion-mind/pull/5), [#8](https://github.com/willtn/notion-mind/pull/8))
- **An empty property and an absent property are one state.** The check for a missing field (VW-08) fires on an empty property. ([#8](https://github.com/willtn/notion-mind/pull/8))
- **A page mention counts as its title.** The size and link checks read a named mention as `[[Title]]`. A mention with no title adds about 60 bytes. A relation adds no text. ([#8](https://github.com/willtn/notion-mind/pull/8))
- **The write hook does not set `Quarter`.** A missing `Quarter` stays a finding, as at the reference. ([#8](https://github.com/willtn/notion-mind/pull/8))
- **The request limit is 180 calls in 60 s.** The client waits and tries again. A long wait can leave a row with no `Hook stamp`, and the hook says so. ([#8](https://github.com/willtn/notion-mind/pull/8))
- **The Stop hook costs time on every turn.** It reads the hygiene views in parallel, with a timeout of 15 s. A page outside the databases has no `Bytes`, so the size check cannot flag it. ([#11](https://github.com/willtn/notion-mind/pull/11))
- **Recent changes are page titles, not commit subjects.** SessionStart reads `Changed`, so a change of Home or North Star is not in that section. The open tasks section fetches at most 10 rows. ([#12](https://github.com/willtn/notion-mind/pull/12))
- **A completed note cannot sit in the active folder.** `Status` is the only place for state, so that hygiene check (HY-01) has no Notion form. See part (f), choice 2, of the design record.
- **No aliases and no daily notes.** The content model has no alias property and no daily note type, so `cross-linker`, `/om-standup`, and `/om-weekly` lost those steps. ([#9](https://github.com/willtn/notion-mind/pull/9))
- **Notion does not return formula text.** After a change to a formula of the model, run the setup with `--reapply-formulas`. ([#5](https://github.com/willtn/notion-mind/pull/5))
- **A lost reply on the first create of the root leaves no ledger line for it.** The setup still converges. ([#5](https://github.com/willtn/notion-mind/pull/5))
- **The transcript backup stays local**, in `.claude/state/session-logs/`. ([#10](https://github.com/willtn/notion-mind/pull/10))

---

## 📁 Repository Structure

```
obsidian-mind/
├── AGENTS.md                      # The operating manual, read every session
├── vault-manifest.json            # Root marker of the hooks, and hook settings
├── notion-map.example.json        # Shape of notion-map.json (the real one is not committed)
├── NOTION-PORT-DESIGN.md          # The design record of the Notion port
├── brain/Skills.md                # The command catalog
└── .claude/
    ├── commands/                  # Slash commands
    ├── agents/                    # Subagents
    ├── rules/                     # Rules that Claude Code loads beside AGENTS.md
    ├── skills/                    # defuddle, mermaid-visualizer, and the obsidian-mind mod
    ├── settings.json              # Hook configuration
    └── scripts/
        ├── session-start.ts, classify-message.ts, guard-notion-write.ts,
        │   validate-write.ts, pre-compact.ts, stop-checklist.ts   # The hooks
        ├── notion-setup.ts        # Builds the workspace and writes notion-map.json
        ├── notion-import.ts       # Moves a Markdown vault of the Obsidian template into the workspace
        ├── scaffold/              # Source text of the scaffold pages and the templates
        ├── lib/                   # The Notion client, the model, the checks
        ├── parity/                # The parity harness
        └── tests/                 # npm test
```

---

## 🎨 Customize It

This is a starting point. Adapt it to how you work:

| What | Where |
|------|-------|
| Your goals | The North Star page: grounds every session |
| Your org | `People`, `Teams`, and the People & Context page |
| Your competencies | `Competencies`: match the framework of your org |
| Your tools | `.claude/commands/`: edit for your GitHub org and Slack workspace |
| Your conventions | `AGENTS.md`: the operating manual, evolve it as you go (`.claude/rules/` for Claude Code additions) |
| Your model | `.claude/scripts/lib/notion-model.ts`: databases, properties, views. Run the setup again after a change |

> [!IMPORTANT]
> `AGENTS.md` is the operating manual. When you change conventions, update it. Your agent reads it every session.

---

## 🔄 Updating

```bash
git pull
node --experimental-strip-types .claude/scripts/notion-setup.ts
```

The pull updates the hooks, the commands, and the rules. The setup adds what a new version of the model needs and makes nothing else. Your notes stay in Notion and are not touched.

---

## 🩺 Troubleshooting

**Claude Code ignores the conventions.** Claude Code reads a `CLAUDE.md` in place of `AGENTS.md` and skips `AGENTS.md` without saying so. The hygiene flags say `CLAUDE.md present beside AGENTS.md` when one is in the repository root. Move what you added to `.claude/rules/local.md` or into `AGENTS.md`, then delete `CLAUDE.md`. A `CLAUDE.md` in a folder above the repository has the same effect, and the flag cannot see it.

**A Notion command is denied.** Read the reason. It shows the allowed forms. Most often the read has a pipe or a redirect, or a commit message names both `mcporter` and `notion`. See [`.claude/rules/notion-calls.md`](.claude/rules/notion-calls.md).

**A section says `(not read: …)`.** SessionStart or Stop could not read that part of the workspace. Check `mcporter auth notion`, then `node --experimental-strip-types .claude/scripts/notion-setup.ts --check`.

**The setup stops on the workspace.** `--workspace-id` and the map file both name a workspace. The setup stops when the login is in a different one. Log in to the right workspace, or move the old `notion-map.json` away.

---

## 🗺️ Roadmap

**Issues and bug reports welcome.** Code contributions go through assignment: comment on an issue to ask for it, and open a PR once it is assigned to you. A PR for an issue not assigned to you is closed without review. See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## 🙏 Design Influences

- [kepano/obsidian-skills](https://github.com/kepano/obsidian-skills): the agent skills of the Obsidian version
- [James Bedford](https://x.com/jameesy): vault structure philosophy, separation of AI-generated content
- [arscontexta](https://github.com/agenticnotetaking/arscontexta): progressive disclosure through description fields, session hooks

---

## 👤 Author

Created by **[Brenno Ferrari](https://brennoferrari.com)**, Senior iOS Engineer in Berlin, building developer tools with Claude Code.

---

## 📄 License

MIT
