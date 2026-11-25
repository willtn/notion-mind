# Vault Audit

Deep structural audit of the Notion workspace. Checks the scaffold pages, database layout, properties, links, views, and consistency. Fix what can be fixed, flag what needs user input.

**When to use**: After substantial sessions, after reorganization, or periodically to maintain workspace health. For lighter end-of-session checks, use `/om-wrap-up` instead.

## Notion access

Read with `mcporter call notion.<tool> --args '<JSON>' --output json`. Use no pipe and no redirect. Put no single quote in the JSON. Read `notion-map.json` in the project root for the `data_source` URL and the view URLs of each database.

Write in two steps. First use the `Write` tool to make `.claude/state/outbox/<name>.json` with the JSON arguments. Then run `mcporter call notion.<tool> --args "$(cat .claude/state/outbox/<name>.json)"`.

A query of a saved view (`"mode":"view"`) has no quota. A SQL query on a data source is limited on this plan, so use it only where a step says so. A read of the links of one page costs one call, so a full link scan of 500 rows takes 6 to 9 minutes. When a reply says `rate_limited`, wait for the time that it names and then go on.

## Usage

```
/om-vault-audit
```

## Subagents

This command orchestrates two subagents for deep analysis:
- **`vault-librarian`** — orphan detection, broken links, property validation, stale rows, page consistency
- **`cross-linker`** — finds missing links, orphan rows, broken backlinks

Launch `vault-librarian` first for the structural audit, then `cross-linker` for link quality.

## Workflow

### 1. Check Layout

Verify the workspace matches the expected layout:
- The root page "obsidian-mind" holds the seven databases (`Work`, `People`, `Teams`, `Competencies`, `Perf docs`, `Knowledge`, `Templates`) and the scaffold pages. Compare each `data_source` and view URL of `notion-map.json` with a `notion-fetch` of the database
- Each database has its saved views (the view names of the content model)
- `Work.Type` and `Tags` agree: a row with the `incident` tag has `Work.Type = Incident`, and a 1:1 row has `Work.Type = 1:1`
- `Work > Active Work` holds only rows with `Work.Status = active`. `Work > Completed` holds only completed rows
- `People` holds only people, and `Teams` holds only teams
- `Templates` holds only template rows (with `{{placeholders}}`)
- `Work.Type = Thinking` rows are clean (no leftover drafts that should have been promoted)
- Nothing unexpected under the root page: each child page is in `notion-map.json`

### 2. Check Pages and Views

Read each scaffold page and verify:
- `Page > Home` — do its linked views point at existing views? Are its quick links valid?
- `Page > North Star` — is the Recent Context section current? Any stale claims?
- `Page > People & Context` — are roles, peer selections, and project assignments current?
- `Perf docs > Brag quarters` — do PR counts and project descriptions match reality?
- The command catalog of the repository — are all slash commands registered? Workflows still valid?

### 3. Check Property Completeness

For each row type, verify required properties:

**Work rows** (`Work.Type = Work note`, or `Work.Status` completed):
- Required: `Date`, `Work.Quarter`, `Description`, `Work.Status`, `Tags` with `work-note`
- Optional: `Work.Project`, `Work.Team`

**Incident rows** (`Work.Type = Incident`):
- Required: `Date`, `Work.Quarter`, `Description`, `Tags` with `work-note` and `incident`
- Required for main incident rows: `Work.Ticket`, `Work.Severity`, `Work.Role`, `Work.Status`

**Person rows** (`People`):
- Required: `Date`, `People.Role`, `Description`, `Tags` with `person`
- Optional but recommended: `People.Team`

**Team rows** (`Teams`):
- Required: `Date`, `Description`, `Tags` with `team`

**Brain rows** (`Knowledge`, `Knowledge.Type = Brain topic`):
- Required: `Description`, `Tags` with `brain`

**1:1 rows** (`Work.Type = 1:1`):
- Required: `Date`, `Work.Quarter`, `Description`, `Tags` with `work-note`

### 4. Check for Duplicate Options

`Tags` is a multi-select, so a row cannot hold one tag twice. Check the option lists of `Tags`, `Work.Project`, and `Work.Quarter` for near-duplicates (for example `person` and `People`). Merge any that you find, and ask the user first.

### 5. Check Status and Type Alignment

- Decision rows (`Work.Type = Decision`) hold `Work.Status` of `proposed`, `accepted`, or `deprecated`
- No `Work.Status = active` row in `Work > Completed`, and no completed row in `Work > Active Work`
- A `Work.Type = Inbox item` row has `Work.Status = inbox`

### 6. Check Views and Derived Properties

For each saved view of each database:
- Query it in view mode. Do the rows match the filters that the view should have?
- Do the properties that it reads exist? Compare with `notion-fetch` of the database
- Do the formulas (`Stale`, `Oversized`, `Edited outside hooks`) still return "yes" or "no"?

Then refresh the derived properties. A row that was edited outside a hooked session has stale `Changed`, `Bytes`, `Open tasks`, `Open loops`, and `Hook stamp`. Read `Work > Hygiene: edited outside hooks` and the view `Hygiene: edited outside hooks` of each other database. For each row listed, make one write with `notion-update-page` and `update_properties` that sets `Description` to its current value. The write hook recomputes the derived properties and sets `Hook stamp`. Skip a row whose derived values do not change. If a row is still in the view after its write, report it to the user and do not retry. (unverified: the hook may treat a write of the same value as no change)

### 7. Check for Orphans

- Are there `Work` rows with `Work.Status = active` and no `Work.Project`? They are in `Work > Hygiene: loose active`
- Are there incident rows missing from `Work > Incidents`?
- Are there `People` rows missing from `Page > People & Context`? Its linked view lists each row
- Are there rows without any inbound links at all? Query the data source for rows whose relation properties are all empty, then confirm each one with `notion-list-page-backlinks`:
  `mcporter call notion.notion-list-page-backlinks --args '{"page_id":"<page URL or ID>"}' --output json`
- Are there `Work.Type = Thinking` rows that should have been promoted or deleted?

### 8. Check Links

- Scan for page mentions that point at pages that don't exist (broken links)
- Check that the relations hold where expected (`Work.Person`, `Work.Competencies`, `Work.Decisions`). A mention in the body does not fill a relation, so set the relation too
- Verify the `Related` sections aren't empty on work rows

### 9. Check for Stale Context

- Read the Recent Context section of `Page > North Star`. Is anything outdated?
- Read `Page > People & Context`. Any roles, teams, or relationships that changed?
- Check `Page > Key Decisions`, `Page > Patterns`, `Page > Gotchas` for outdated claims
- Check `Page > North Star`. Does Current Focus reflect reality?

### 10. Check for Mixed Context

Per the note rules, each row should cover ONE concept. Flag rows that:
- Mix project work with review prep
- Mix personal conversations with project evidence
- Have 3+ independent sections that don't need each other

### 11. Check Claude Config

- `.claude/settings.json` — are hooks well-formed?
- `.claude/commands/` and `.claude/agents/` — do all files name only databases, properties, and views that exist? The link check of the repository proves it
- `AGENTS.md` and `.claude/rules/` — any stale instructions that contradict the current Notion layout?
- No `CLAUDE.md` at the repository root: Claude Code reads it and skips `AGENTS.md` (the hygiene flags say so too)

### 12. Fix and Report

- Fix what's clearly wrong (broken links, missing properties, wrong `Work.Type`)
- For ambiguous issues, list them and ask the user
- Summarize:
  - **Fixed**: issues resolved
  - **Flagged**: needs user input
  - **Suggested**: improvements for the workspace

## Important

- Don't delete anything without asking
- Don't create new rows during audit — just fix existing ones
- Preserve existing properties when editing
- If a row has the wrong `Work.Type`, change the property. Do not copy the row
- Use parallel agents for large audits (e.g., one checking `Work`, one checking `People` and `Teams`, one checking `Perf docs`)
