# Obsidian Mind

A personal Notion workspace, used as an external brain for work notes, decisions, performance tracking, and agent context. The name `obsidian-mind` stays from the Obsidian template that this repository started as.

One Notion workspace is the only store of notes. Any client reads it through Notion MCP. Only a Claude Code session that loads the hooks of this repository writes to it. This repository holds the hooks, the commands, the subagents, and the setup. It holds no notes.

## Vault Structure

The vault is one root page, "obsidian-mind", with seven databases and a few pages under it. `notion-map.json` in the repository root holds the ID of each object (see `.claude/rules/notion-calls.md`).

| Object | Holds | Key views or sections |
|--------|-------|-----------------------|
| Home (page) | **Entry point**: linked views, Current Focus from North Star, Open Questions | Open this first |
| North Star (page) | Goals and focus areas, and the Recent Context section | Read at session start |
| People & Context (page) | Org context, with linked `People` and `Teams` views | Role & Org, Teams, People |
| Recently Touched (page) | One linked view of each database, sorted by `Changed` | The answer to "what's most recent" |
| `Work` | Work notes, decisions, incidents, 1:1 notes, inbox items, thinking notes. `Type` tells them apart. `Status` replaces the active and archive folders. `Project` groups a workstream | Active Work, Stale Actives, Completed, Incidents, 1:1 History, All by Quarter |
| `People` | One row for each person | By Team, All People |
| `Teams` | One row for each team | |
| `Competencies` | One row for each competency, with `Evidence` from work rows | Competency Map |
| `Perf docs` | PR evidence, review briefs, review artifacts, brag quarters | Review Evidence: By Cycle, Review Evidence: By Person, Brag quarters |
| `Knowledge` | Brain topics (Key Decisions, Patterns, Gotchas), reference notes, domain notes, event-log satellites, archive notes | Brain index |
| `Templates` | One row for each template. The row body is the template | |

The repository:

| Path | Purpose |
|------|---------|
| `vault-manifest.json` | Root marker of the hook commands, and hook settings (budgets, required properties, open-loop sections) |
| `brain/Skills.md` | The command catalog, with usage notes and workflows |
| `.claude/` | Hooks, commands, subagents, skills, rules, and the mod |
| `notion-map.json` | The Notion IDs that the setup writes. Not committed |

## Commands

Commands live in `.claude/commands/` as Markdown with YAML frontmatter. `brain/Skills.md` is the catalog. Invoke them as `/om-standup`, `/om-dump`, and so on.

## Notion Calls

Each Notion call is a `Bash` command through `mcporter`. Write with an outbox file, read with `--args '<JSON>' --output json`, and never pipe or redirect a call. The forms, and the rule for text that names both `mcporter` and `notion`, are in `.claude/rules/notion-calls.md`. Read it before the first call of a session.

## Search

Search with `notion-search` before you fetch pages. Give it short keywords, and the `data_source_url` of one database when you know where a note lives. Then fetch only the pages that match. Search before you create a row, to find a duplicate, and after, to find rows that should link to it.

## Session Workflow

### Starting a Substantial Session

Run `/om-standup`. The manual steps are in `.claude/rules/session-workflow.md`.

### Ending a Substantial Session

**When the user says "wrap up", "let's wrap", "wrapping up", or similar, invoke `/om-wrap-up` automatically.** This runs a full review of the session.

Without it, the minimum checklist is in `.claude/rules/session-workflow.md`.

### Thinking Workflow

Drafting before a final note? Read `.claude/rules/thinking.md`.

### Creating Notes

1. **Always set the properties.** Each database has `Name`, `Date`, `Description` (about 150 characters), and `Tags`. Work rows also need `Status` and `Quarter` (for example `Q1-2026`). Incidents need `Ticket`, `Severity`, and `Role`. The required properties for each type come from `frontmatter_required` in `vault-manifest.json`, and the write hook warns when one is empty.
2. **Use templates** from the `Templates` database. Replace each `{{placeholder}}` with a real value.
2b. **Write fully, organize structurally. The workspace tidies itself.** Size is a STRUCTURE signal, never a brevity signal. When a note passes the ~25KB organization threshold (bytes, not lines), the write hook flags it, and the hygiene scan flags it at session boundaries. The answer is always a SPLIT (domain notes, event-log satellites, or a `Project` group, with content moved verbatim, a one-line index left behind, and links moved to the new rows), never a trim. The same hook flags topic clusters at write time. Token overlap is blind, so judge real shared context before you group. `/om-tidy` is the acting half. Exempt: notes with "Archive" in the title.
3. **Put each row in the right database**:
   - Work notes, decisions, incidents, 1:1 notes, inbox items, thinking notes: `Work`, with the right `Type`
   - Completed work: same row, `Status` set to `completed`
   - Performance content and PR evidence: `Perf docs`
   - Competency definitions: `Competencies`
   - People: `People`. Teams: `Teams`
   - Agent operational knowledge and codebase knowledge: `Knowledge`
   - No note in the repository. The repository holds infrastructure only.
4. **Name rows descriptively.** Use the note title as the name. **Date convention:** a point-in-time note gets a date in its name: 1:1 notes (`<Person> YYYY-MM-DD`), dated captures, meeting exports. **A living or entity note gets a bare title**: work notes, people, teams, competencies, brain topics. *Why:* a creation date in the name of a note that changes every day makes it look old. For "what's most recent", use the Recently Touched page (`Changed`), never dates in names.
5. **Group a multi-note workstream with `Project`.** Once a workstream has more than one note, give each row the same `Project` value. Links stay the primary organization.

### Note Types

| Type | Database | Naming | Key Sections |
|------|----------|--------|--------------|
| Work note | `Work`, `Type` Work note | Descriptive title | Context, What/Why, Links, Related |
| Decision | `Work`, `Type` Decision | Descriptive title | Context, Options, Decision, Consequences |
| Incident | `Work`, `Type` Incident | Ticket number or descriptive title | Context, Root Cause, Timeline, Impact, Analysis, Related |
| 1:1 note | `Work`, `Type` 1:1 | `<Person> YYYY-MM-DD` | Key Takeaways, Action Items, Quotes, What to Watch, Related |
| Inbox item | `Work`, `Type` Inbox item | As exported | Raw meeting notes. `/om-intake` routes them |
| PR analysis | `Perf docs`, `Type` PR evidence | `<Person> PRs - <Period>` | PR Count, Projects, Quality, Growth, Full Table |
| Review brief | `Perf docs`, `Type` Review brief | `<Cycle> Review Brief` | Arc, Impact, Competencies, Documentation Trail |
| Person | `People` | Full name | Role & Team, Relationship, Key Moments, Notes |
| Team | `Teams` | Team name | Members, Scope, Interactions |
| Competency | `Competencies` | Competency name | Definition, level criteria. Evidence comes from the `Evidence` relation |
| Brain topic | `Knowledge`, `Type` Brain topic | Topic name | Topic-specific content |
| Domain note | `Knowledge`, `Type` Domain note | `<Index> - <Domain>` | The substance of a split index. The index keeps a one-line entry. Never put it back into the index |
| Event-log satellite | `Knowledge` or `People`, `Parent` set to the core row | `<Core> — <Event> Log` or a dated title | Dated entries moved verbatim from a core note |
| Archive note | `Knowledge`, `Type` Archive note, `Parent` set to the live row | `<Live Name> Archive[ — <window>]` | Bulk by design, exempt from the size rule. The live row keeps a one-line index and a mention |

### Linking -- This Is Critical

**Graph-first, not database-first.** Databases group by purpose. Links group by meaning. Both matter, but links are the primary organizational tool.

**A note without links is a bug.** After you write a new row, the FIRST next step is its links. Every new row links to at least one existing row.

**Atomicity rule**: Before you write or append to a row, ask: "Does this cover several distinct concepts that could be separate rows?" If a row has or would have 3 or more independent sections, split it into atomic rows that link to each other.

Two kinds of link:

- **A relation property** when a view, a rollup, or a hygiene check reads the link. A body mention does not fill a relation.
- **A page mention** in the body for every other link: `<mention url="<page URL>">Title</mention>`. Always put the title inside the mention.

Note types have graph roles:

- **Evidence rows** (work notes, 1:1 notes, PR analyses): link out to the concepts they show
- **Concept rows** (competencies, patterns): stay definitional. Evidence arrives through the reverse relation and backlinks
- **Index pages** (Home, People & Context, North Star): curate links actively
- **Person rows**: link to projects, teams, and evidence

#### When to Link

| Link | Relation |
|------|----------|
| Work note and decision, both ways | `Work.Decisions` and `Decision of` |
| Work note to competency | `Work.Competencies` (reverse: `Competencies.Evidence`) |
| Work note to team | `Work.Team` |
| Work note to person, 1:1 notes, incident people | `Work.Person` |
| Person to PR evidence | `Perf docs.Person` |
| Person to team | `People.Team` (reverse: `Teams.Members`) |
| Brag quarter to work note and competency | `Perf docs.Work evidence`, `Perf docs.Competencies` |
| Thinking note to the note it feeds | `Work.Feeds into` |
| Split note to its core note | `Parent` (reverse: `Children`) |

### Maintaining Indexes

Saved views replace the hand-kept indexes. A new row shows in its views at once. Keep these by hand:

- **North Star**: goals and focus, and the Recent Context section
- **People & Context**: the prose sections, when people, teams, or org structure change
- **Brag quarter rows** in `Perf docs`: log wins, with `Work evidence` set
- **`brain/Skills.md`** in the repository: register new commands and workflows

### Decision Records

**When a decision earns a record.** Any ONE of these is enough:

- **Hard to reverse**: to undo it later costs real work (a schema, a public contract, a naming scheme).
- **Surprising without context**: a competent reader would ask "why is it like this?" and the code alone cannot answer. This clause stops the next contributor from "fixing" something deliberate.
- **A real trade-off**: something was given up, so the case of the losing option is worth keeping.

None holds → no record. The tracker and the commit message are enough. The gate is symmetric: it asks for records where they are missing, and it permits *no* record everywhere else. That keeps the record set worth reading.

Once it clears the gate:

1. Create a `Work` row with `Type` Decision from the Decision Record template
2. Set the `Decisions` relation from the work rows that led to it
3. If significant, mention it in the Key Decisions row of `Knowledge`. Its linked view lists every decision

### Wins & Achievements

When significant work is complete, add it to the brag quarter row of `Perf docs`, with `Work evidence` set to the work rows. Categorize it under Impact, Technical Growth, Collaboration, or Feedback.

## North Star

The North Star page is a living document of goals and focus areas.

- **Read it** at the start of substantial sessions
- **Reference it** when you suggest priorities or trade-offs
- **Update it** when the user signals a shift in goals
- Both the user and the agent write to it

## Tags Convention

Use the `Tags` multi-select, not inline tags. The setup adds the tags of this convention:

- **Type**: `work-note`, `decision`, `incident`, `perf`, `review`, `thinking`, `north-star`, `competency`, `person`, `team`, `brain`, `org`
- **Index**: `index`, `moc`

`Status`, `Team`, `Cycle`, `Person`, and `Project` are properties, not tags.

## Properties for Querying

- `Status`: `active`, `completed`, `archived`, `proposed`, `accepted`, `deprecated`, `superseded`, `draft`, `inbox`
- `Quarter`: for example `Q1-2026`
- `Cycle`: for example `h1-2025`
- `Team`, `Person`: relations
- `Ticket`, `Severity`, `Role`: incidents

A select takes only an option that its database has. `Quarter`, `Project`, `Cycle`, and the level selects start empty. The `PostToolUseFailure` hook adds a missing option after a write fails, and you run the same command again.

## Memory System

| System | Location | Purpose |
|--------|----------|---------|
| **Workspace memories** | Brain topic rows of `Knowledge`, and the Recent Context section of North Star | All durable knowledge lives here. Linked, searchable, and in page history. |

When asked to "remember" something:

1. Find or create the right brain topic row in `Knowledge` (Gotchas, Patterns, Key Decisions, or a new topic with `Type` Brain topic)
2. Add the knowledge there, with a mention of its context
3. A new topic row shows in the Brain index view. No index needs an update

### When to Consult Brain Topics

Debugging, "how do we usually…", "why did we decide"? Read `.claude/rules/brain-topics.md` first.

The auto-memory folder of Claude Code holds only its index: `.claude/rules/memory.md`.

## Agent Guidelines

### Graph-First Thinking

- **Databases group by purpose, links group by meaning.** A row lives in ONE database but links to MANY rows.
- When you create a row, add links FIRST. A row without links is a bug.
- Prefer links both ways: if A links to B, B should link back to A, unless B is a concept row that gets backlinks passively.
- Before you add a database or a select option, ask: "Can a property, a relation, or a view do this instead?"
- After every substantial session, check that each new row has at least one inbound link (`notion-list-page-backlinks`).

### Where to Put Things

- **Writing about a person?** `People`
- **Writing about a team?** `Teams`
- **Writing about how the codebase works?** `Knowledge` (Patterns, Gotchas, Key Decisions, or a reference note)
- **Capturing a 1:1 meeting?** `Work`, `Type` 1:1
- **Deep scanning PRs for review?** `Perf docs`, `Type` PR evidence
- **Creating review briefs?** `Perf docs`, `Type` Review brief
- **Tracking active project work?** `Work`, `Status` active
- **Capturing an incident?** use `/om-incident-capture`
- **Dumping unstructured info?** use `/om-dump` to classify and route everything

### Don't Mix Contexts

When you capture data from Slack, DMs, or meetings:

- **Project evidence** (PRs, technical decisions, delivery) goes to the relevant `Work` row
- **Review prep** (peer selection, manager strategy, brag framing) goes to `Perf docs` rows
- **People dynamics** (feedback, relationships, career) goes to `People` rows
- **Personal conversations**: capture only if review-relevant, else skip

## Hooks

Which hook runs on which event, and the obsidian-mind mod: `.claude/rules/hooks-and-mod.md`. Commands and skills: `.claude/rules/skills.md`. Subagents: `.claude/rules/subagents.md`.

## Write-Correctness Laws

Each law exists because its absence caused real correction work in vaults that run this template. To break one re-creates a documented failure.

1. **Single-source status.** The volatile status of a project (version, counts, released or blocked, dates) lives in exactly ONE place: the properties of its row and the status line at its top. Every other row **links** to it and never restates it. *Why: one wrong status statement hardened into ~8 notes downstream and had to be swept out.*
2. **Correction-sweep protocol.** When a fact is corrected, find every restatement and fix them all in the same pass. **`/om-correct "<the corrected fact>"` is the acting half.** A keyword search finds only the notes that copied the wording. The expensive half is the *paraphrase*: the same claim in different words, which no keyword and no structural check can see. It is also the half most likely to survive a manual sweep, because the sweeper stops when the search goes quiet. A correction callout on top of a note whose body still says the wrong thing is NOT a correction. Later sessions absorb the stain again from the body. Notes that correctly record what was believed *at the time* stay as they are (Law 5).
3. **Mark inference.** Anything not verified against a source (code, repo, primary doc, the person) carries an explicit `(TBC)`, `(unverified)`, or `(inferred)` marker. Never state inference bare.
4. **Date-stamp volatile facts.** Counts, versions, org structure, tool maturity: write "as of YYYY-MM-DD" so that staleness is visible instead of silent.
5. **Attribution and creation dates may differ** (`Quarter` against the quarter of `Date`). That is legitimate, not a bug to "fix".
6. **No counts in instruction files.** Hard-coded counts ("11 slash commands") in AGENTS.md or README go stale silently. Describe, don't count.

## Rules

- **For "what's most recent", use the Recently Touched page (`Changed`), never dates in names.** A creation date in the name of a living note inverts the recency signal.
- Write to Notion only in the forms of `.claude/rules/notion-calls.md`. Do not set the derived properties. The write hook sets them.
- Update only the properties that change. Keep the other properties of a row.
- Do not copy a Notion ID, a token, or a user name into a committed file.
- When asked to "remember" something, write to the relevant brain topic row with a mention of its context.
- Always check for and suggest connections between rows.
- Every row has a `Description` of about 150 characters. The agent fills it in.
- **Zero data loss**: when you reorganize, move pages with `notion-move-pages` and keep the content. Never move a page to Trash without explicit user confirmation.
