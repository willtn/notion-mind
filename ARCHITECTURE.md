# Architecture

This document describes how obsidian-mind works after the Notion port: where the notes live, how a client reads them, how a write reaches Notion, what each hook checks, and how the port is held to the behavior of the last Obsidian version. It is for a contributor who changes a hook, the content model, or the setup.

The design record [`NOTION-PORT-DESIGN.md`](NOTION-PORT-DESIGN.md) holds the measurements, the ledger of each capability at the reference commit `fae7be4`, the content model, the parity table, and the choices. This document describes the result. Where the two disagree, the code and this document describe the shipped state, and the pull request that changed it says why.

## System Overview

```
 any MCP client ──── read ────────────────────────────────┐
 (Claude apps, Claude Code, other clients)                 │
                                                           ▼
 Claude Code session in this repository          ┌──────────────────────┐
 ┌───────────────────────────────────────────┐   │  Notion workspace    │
 │ agent ─ Write tool ─► .claude/state/outbox │   │  root "obsidian-mind" │
 │   │                                        │   │   7 databases        │
 │   └─ Bash: mcporter call notion.<tool> ────┼──►│   scaffold pages     │
 │        ▲ PreToolUse guard (form check)     │   │   saved views        │
 │        ▼ PostToolUse write check           │   │   Reader map         │
 │          (findings, derived properties) ───┼──►│                      │
 │ SessionStart, Stop: view queries ◄─────────┼───│                      │
 │ UserPromptSubmit, PreCompact: no Notion    │   └──────────────────────┘
 └───────────────────────────────────────────┘
            ▲
            │ notion-map.json (IDs), vault-manifest.json (root marker, settings)
```

Three facts shape the design:

- **One store.** Every note is a Notion page. The repository holds only infrastructure (row U06 of the ledger).
- **One writer.** Only a Claude Code session that loads the hooks of this repository writes. Other clients read. Notion cannot tell a hooked write from another MCP write (measured, choice 5 of the record), so the hooks stamp each write and a view shows the rows changed outside them.
- **One transport.** Claude Code reaches Notion through `mcporter`, not through a native MCP server in `.mcp.json` (the operator decision in the record). So each Notion call is a `Bash` command string, and the hooks parse it.

## Division of Responsibility

**Procedural code owns the environment. The agent owns content.**

| Concern | Owner |
|---|---|
| The content model: databases, properties, views, scaffold pages, templates | `lib/notion-model.ts`, built by `notion-setup.ts` |
| Which call forms may run | The guard, `guard-notion-write.ts` |
| Required properties, links, size, hard wraps, topic clusters | The write check, `validate-write.ts` and `lib/write-check.ts` |
| The derived properties `Bytes`, `Open tasks`, `Open loops`, `Has content`, `Changed`, `Hook stamp` | The write hook, `lib/write-hook.ts` |
| Session context and the hygiene scan | `session-start.ts`, `stop-checklist.ts`, `lib/hygiene-scan.ts` |
| Routing hints | `classify-message.ts`, `lib/signals.ts` |
| What a note says, where it goes, what it links to | The agent, following `AGENTS.md`, the rules, and the commands |

## Design Principles

### 1. Graph-first, not database-first

A note lives in one database and links to many notes. A link becomes a relation property when a view, a rollup, or a hygiene check reads it (`Work.Decisions`, `Work.Competencies`, `Work.Person`, `Work.Team`, `Work.Feeds into`, `Perf docs.Work evidence`, `Parent`). Every other link is a page mention, which `notion-list-page-backlinks` finds. A body mention does not fill a relation, so the agent sets both where both matter.

### 2. Workspace-first memory

Durable knowledge lives in the brain topic rows of `Knowledge` and the Recent Context section of North Star. The auto-memory folder of Claude Code holds only `MEMORY.md`, an index of links. The write hook warns when another file appears there (VW-03).

### 3. Progressive disclosure

SessionStart injects titles, counts, and short excerpts under a byte budget, not full pages. The agent searches with `notion-search` and fetches only the pages that match. Each row has a `Description` of about 150 characters, so a search result or a view is enough to decide whether to fetch.

### 4. Every write is readable

A hook can check only a write whose arguments it can read. The guard therefore passes a Notion write only in the outbox form: the arguments are a JSON file that the `Write` tool made, and the command reads that file. The write check reads the same file after the call. An inline JSON argument was measured to store a literal `\n` (choice 7 of the record), so the outbox form also avoids a shell escape.

### 5. Derived state makes the scan cheap

Without derived properties, the hygiene scan needs one fetch for each page, about 500 calls for 500 notes, and Stop cannot finish inside a useful timeout (choice 8). The write hook sets `Bytes`, `Open tasks`, `Open loops`, and `Has content` on each write, so the scan is a few view queries. A property write moves Notion's own `Last edited` (measured), so every age rule reads the derived `Changed` instead.

## The Content Model

`lib/notion-model.ts` holds the model as tables: each database with its properties, select options, formulas, and saved views, each scaffold page with its body sources and linked views, and each template row.

| Database | Note types | Replaces |
|---|---|---|
| `Work` | Work note, Decision, Incident, 1:1, Inbox item, Thinking | the work folders and the thinking folder |
| `People` | Person | the people folder |
| `Teams` | Team | the teams folder |
| `Competencies` | Competency | the competencies folder |
| `Perf docs` | PR evidence, Review brief, Review artifact, Brag quarter | the perf folders |
| `Knowledge` | Brain topic, Reference, Domain note, Event-log satellite, Archive note | the brain and reference folders |
| `Templates` | Template | the templates folder |

`Status` replaces the active and archive folders, and `Project` replaces a workstream subfolder. One `Work` database holds six note types because a view reads one data source, and this plan cannot query several at once (measured, `full_version_required`).

Formulas that a view filters on return the text "yes" or "no". A filter on a true or false formula saved as `"filters": []` and returned no rows (measured in [#5](https://github.com/willtn/notion-mind/pull/5)).

The scaffold pages are Home, North Star, People & Context, Recently Touched, the brain topic rows Key Decisions, Patterns, and Gotchas, and the Reader map. Their text comes from `.claude/scripts/scaffold/`, through `SCAFFOLD_SOURCES` in `lib/notion-model.ts`.

## The Map File and the Manifest

`notion-map.json` in the repository root holds every Notion ID that a local reader needs: the workspace, the root page, each database with its `data_source` URL and its view URLs, each scaffold page, and each template row. The setup writes it. Every hook, command, and subagent reads it. `NOTION_MAP_FILE` in the environment names another file, which the parity harness uses for its fixture root. The file is in `.gitignore`, because `origin` is public. `notion-map.example.json` shows its shape with placeholders.

A remote client cannot read a repository file, so the setup also writes the "Reader map" page under the root from the same data. The file is the source, and the page is a copy.

`vault-manifest.json` stays for two jobs:

- **The root marker.** Each hook command in `.claude/settings.json` walks up from `CLAUDE_PROJECT_DIR` to the nearest folder that holds it (`lib/project-dir.ts`).
- **Hook settings.** `open_loop_types` and `open_loop_sections`, the budgets `eager_layer_budget_bytes` and `eager_layer_instruction_budget_bytes`, `listing_collapse_threshold`, and `frontmatter_required`, which the write check reads as the required properties of each note type. `template`, `version`, and `released` serve the release tooling.

## The Notion Client

`lib/notion-client.ts` calls Notion in-process through the runtime of the `mcporter` that `which mcporter` resolves. It is the one runtime dependency outside Node, and it is not an npm dependency (choice 10). The client has a concurrency limit of 4, a budget of 150 requests a minute under the plan limit of 180, and a bounded retry on a `rate_limited` reply. Each failure is a `NotionError` with a code: `mcporter_missing`, `server_missing`, `login_missing`, `rate_limited`, `plan_required`, `timeout`, `tool_error`, or `transport`. `lib/notion-parse.ts` turns the measured reply forms into typed values.

A warm call takes about 0.35 to 0.6 s, and the first call of a new process about 0.8 s (measured in part (a) of the record). Each hook that calls Notion is a new process, so the first call sets its floor.

## The Read Path

Any client reads through Notion MCP. A read has no hook and no write side effect, so the port needs nothing on the client. Inside a hooked session, a read is a `Bash` command in the form that the guard passes:

```sh
mcporter call notion.<read tool> --args '<JSON object>' --output json
```

The guard denies a pipe, a redirect, a here-document, and a second call in one command, because `mcporter` 0.17.1 lets a `tool:<name>` argument or a `--tool` flag replace the tool of the selector (measured in [#6](https://github.com/willtn/notion-mind/pull/6)). With `--args` as the only source of arguments, the guard can classify each call as a read or a write from one table.

The hooks read views in view mode, which has no plan quota. SQL mode has a quota, and the plan has no query across data sources.

## The Write Path

```
Write tool ─► .claude/state/outbox/<name>.json
Bash: mcporter call notion.<tool> --args "$(cat .claude/state/outbox/<name>.json)"
  PreToolUse    guard-notion-write.ts   pass or deny on the form
  (the call runs)
  PostToolUse   validate-write.ts       findings, derived properties, delete the outbox file
  or PostToolUseFailure                 add the missing select options, ask for the same command again
```

### The guard

`lib/notion-write.ts` holds one table of the Notion tools with the class of each (read or write). A command is a Notion command when its text holds the runtime folder of the `mcporter` on PATH, or both `mcporter` and `notion`, after the shell quote characters and backslashes go. A Notion command passes only as one whole allowed form: the write, the read, `mcporter list notion` with optional `--schema` and `--output json`, or `mcporter auth notion`. `notion-create-pages` also needs `"allow_async": false`, because only that form returns the page IDs.

The guard prints nothing for a command that passes. It does not answer `permissionDecision: "allow"`, because that answer also skips the permission rules of the session. It denies each error after it starts, and the hook command in `.claude/settings.json` prints a denial when `node` itself fails. Claude Code runs the call when a `PreToolUse` hook exits with 1 or runs past its timeout (measured on 2.1.329), so both layers are necessary. The guard does one read of stdin, one scan of PATH, and at most one file read, and adds about 115 ms to each `Bash` call (measured in [#6](https://github.com/willtn/notion-mind/pull/6)).

The threat model is a cooperative agent. A command that hides one of the two words on purpose, or a script file that holds the call, passes. The `Hook stamp` audit flags such a write after the fact.

### The write check

`validate-write.ts` acts on a `Bash` call only when the command can be a Notion write, so other `Bash` calls stay at about 100 ms (measured in [#8](https://github.com/willtn/notion-mind/pull/8)). For a write, it reads the outbox file, builds the note of each written row (`lib/notion-note.ts`), and runs the checks of part d.1 of the record:

| Row | Check |
|---|---|
| VW-07 | The target is not a row of a note database |
| VW-08, VW-09 | A required property is empty |
| VW-10 | Text over 300 characters with no mention and no relation |
| VW-11 | A hard-wrapped paragraph line |
| VW-12 | A ticket ID in a wikilink |
| VW-14 | A note of 25,000 bytes or more with no "Archive" in its title |
| VW-15 | An active `Work` row with no `Project` that shares a title token with another |

The size counts the properties rendered as YAML plus the body, with a named mention counted as `[[Title]]`, so the same note has the same size in both forms. Then the hook sets the derived properties in one update call for each row, and deletes the outbox file. A write updates `Changed` only when the body or a user property changed. A whole run has a budget of 12 s for its Notion calls, inside the 15 s timeout. Ten live runs took a median of 902 ms (measured in [#8](https://github.com/willtn/notion-mind/pull/8)).

For a `Write` or `Edit`, the same hook flags a file in the auto-memory folder of Claude Code other than `MEMORY.md` (VW-03).

### Select options

A select takes no new option on a write. The write fails with a validation error (measured in [#5](https://github.com/willtn/notion-mind/pull/5)). Claude Code sends `PostToolUseFailure`, not `PostToolUse`, for a failed `mcporter` call (measured in [#8](https://github.com/willtn/notion-mind/pull/8)). So that event runs the same hook, which adds the options that the outbox file needs and asks for the same command again. The outbox file stays until a write succeeds.

### The audit of other writers

`Hook stamp` is the time of the last hooked write, set last. The view "Hygiene: edited outside hooks" returns each row whose `Last edited` is later than its `Hook stamp`, and `/om-vault-audit` reads it. A row that the hook could not stamp, for example after a long rate-limit wait, also shows there, and the hook says so in its output.

## Lifecycle Hooks

| Event | Script | Timeout | Notion calls |
|---|---|---|---|
| SessionStart | `session-start.ts` | 30 s | About 28 reads in two rounds: views and page fetches at the same time |
| UserPromptSubmit | `classify-message.ts` | 15 s | None |
| PreToolUse (`Bash`) | `guard-notion-write.ts` | 5 s | None |
| PostToolUse (`Write\|Edit\|Bash`) | `validate-write.ts` | 15 s | For a write: one page fetch and at most one update for each row, and at most one view read |
| PostToolUseFailure (`Bash`) | `validate-write.ts` | 15 s | One schema update when an option is missing |
| PreCompact | `pre-compact.ts` | 30 s | None. The transcript goes to `.claude/state/session-logs/` |
| Stop | `stop-checklist.ts` | 15 s | The hygiene views, at the same time |

**SessionStart** reads the workspace into one value, `SessionSources` (`lib/session-sources.ts`), and builds its sections from it (part d.2): the date, North Star "Current Focus", the brain topics index, the rows with `Changed` in 48 hours, open tasks from the "Open tasks" view and Home, the active work, the listing by database and `Type`, and the hygiene findings. The byte budget ladder, the size meter, and the delivery envelope stay as at the reference. A part that the hook cannot read shows `(not read: cause)`, and each other part stays.

**Stop** runs the hygiene scan (`lib/hygiene-scan.ts`, part d.3) on the saved views "Hygiene: oversized", "Hygiene: open loops", "Hygiene: inbox pressure", and "Hygiene: loose active", and keeps the report key, the once-per-session rule, and the handover to the next prompt. The open-loop watch reads `Type` values (`open_loop_types` in the manifest). Ten live runs took a median of 1,562 ms, and the reference took about 131 ms (measured in [#11](https://github.com/willtn/notion-mind/pull/11)). That cost is the reason for the timeout of 15 s.

**UserPromptSubmit** and **PreCompact** read no notes. The hint text names Notion objects, and the transcript backup stays local (choice 12).

## The Claude Code Mod

On Claude Code 2.1.287 or later, `.claude/skills/obsidian-mind/` loads as a plugin. It runs `session-start.ts` and `stop-checklist.ts` itself, passes `om_mod: "standdown"` to the settings hooks for those events, and changes only the delivery: the session context becomes an instruction file (`.claude/session-context.md`), and the Stop report becomes one line under the answer, with the full report handed over on the next prompt. `tests/mod-timeouts.test.ts` checks that the timeouts of the mod equal those in `.claude/settings.json`. `.github/workflows/mod.yml` validates the mod with a pinned Claude Code and checks that each README quotes its hooks and calls lines once.

## The Setup

`notion-setup.ts` builds the model under one root page and writes the map file.

- It finds each object by its name under the root, compares it with the model, and makes only what is missing. A second run makes nothing.
- It reads back each saved view and fails on a directive that Notion dropped.
- It tests each view on a formula with probe rows, which it then moves to Trash.
- `--check` makes nothing and fetches each object of the map file.
- `--reapply-formulas` sends each formula again. Notion does not return formula text, so the setup cannot see a changed formula.
- `--workspace-id` stops the run when the login is in another workspace. `--ledger` records each object that the model owns.

## The Parity Harness

`.claude/scripts/parity/` holds the proof that each ported hook keeps the behavior of `fae7be4`. One fixture spec (`parity/fixture.ts`) has two forms: a Markdown vault (`markdown-form.ts`) and the same notes in a second Notion root (`write-notion-fixture.ts`). The runner checks out `fae7be4` in a temporary worktree, runs the reference hook on the Markdown form and the port on the Notion form, resets the hook state before each run, and compares the findings by row ID, note, and count (part d of the record).

The wording may differ only to name Notion objects. Each form maps its object names to one closed set of neutral names (`parity/wording.ts`), and the harness compares the rest of the text. `parity/mutations.ts` and `parity/port-mutations.ts` hold mutations of the reference and of the port. Each mutation must give the rows it names, so a check that the harness cannot see shows as a failure.

`npm test` runs the comparison offline on a stand-in runtime of the Notion form (`tests/_offline-notion-form.ts`). `run-parity.ts --notion --hook <name>` and `run-mutations.ts --notion --hook <name>` run it on the real fixture root. One live run makes about 180 calls in a minute, so live runs go one at a time.

## The Import Tool

`.claude/scripts/notion-import.ts` moves a Markdown vault of the Obsidian template into the model (item 11 of part (e) of the record, [#14](https://github.com/willtn/notion-mind/pull/14)). `lib/import-source.ts` reads the vault and never writes to it. `lib/import-place.ts` gives each note its database and its `Type` from its folder and its tags. `lib/import-plan.ts` makes the plan, `lib/import-body.ts` converts each body to Notion-flavored Markdown, and `lib/import-run.ts` writes only what differs.

Each row holds the path of its note in the property `Source path`, and the run finds a row by that value. So a second run makes no page. `--dry-run` makes no Notion call, and it prints the place of each note, each file that the import leaves out, and each construct that loses form (`lib/import-report.ts`). `--verify` fetches each page and compares the title, the place, each property, the body, and the derived values with the plan. It exits 1 on a difference. The `vault-migrator` subagent drives the tool.

## Testing and CI

- `cd .claude/scripts && npm test` runs every test with the Node test runner. The live tests run only with `NOTION_LIVE=1` and a map file, and skip in each other run.
- `npm run typecheck` runs `tsc --noEmit` with TypeScript 5.6.3 and `@types/node` 22.9.0, which CI installs with `npm install --no-save`. The runtime has no npm dependency. `engines.node` in `.claude/scripts/package.json` is `>=22.6.0`.
- `.github/workflows/test.yml` runs both on Ubuntu, macOS, and Windows with Node 22 and 24. It makes a full checkout, so the parity tests find `fae7be4`, and it fails when a test leaves a file behind.
- `.github/workflows/mod.yml` checks the mod. `pr-title.yml` checks the title format. `release.yml` tags a release and writes the changelog.
- `check-commands-agents.ts static` proves that no command or subagent names a local vault path, a local search tool, or another agent. `check-commands-agents.ts links` resolves each Notion name in them against the model and the tool list.

## Extension Seams

| Change | Where |
|---|---|
| A database, a property, a select option, a view, a scaffold page, or a template | `lib/notion-model.ts`, then run the setup again |
| A required property of a note type | `frontmatter_required` in `vault-manifest.json` |
| A routing hint | `lib/signals.ts`, with its Notion object names in `parity/notion-wording.ts` |
| A Notion tool that the server adds | The tool table in `lib/notion-write.ts`. A tool that the table does not list is denied in every form |
| A command or a subagent | `.claude/commands/` or `.claude/agents/`. Run `check-commands-agents.ts` |

## Known Limits

The Known Limits section of [README.md](README.md) lists each known limit, with the pull request that measured it.
