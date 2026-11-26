# Incident Capture

Capture an incident from Slack channels, DMs, and threads into structured Notion rows. Produces a complete incident row with timeline, people, analysis, and brag entry.

## Notion access

Read with `mcporter call notion.<tool> --args '<JSON>' --output json`. Use no pipe and no redirect. Put no single quote in the JSON. Read `notion-map.json` in the project root for the `data_source` URL and the view URLs of each database.

Write in two steps. First use the `Write` tool to make `.claude/state/outbox/<name>.json` with the JSON arguments. Then run `mcporter call notion.<tool> --args "$(cat .claude/state/outbox/<name>.json)"`. `notion-create-pages` needs `"allow_async": false`.

## Usage

```
/om-incident-capture <slack-urls>
```

Provide one or more Slack URLs: incident channels, DM conversations, threads. The more context, the better.

## Subagents

This command orchestrates two subagents for heavy lifting:
- **`slack-archaeologist`** — reads all Slack sources, builds unified timeline with attribution
- **`people-profiler`** — bulk creates/updates `People` rows for everyone involved

Launch both in parallel when starting the capture.

## Workflow

### 1. Gather Raw Data

For each Slack URL provided:
- Read the full channel/DM/thread using `slack_read_channel` or `slack_read_thread`
- Read ALL sub-threads within the channel (check for "Thread: N replies" indicators)
- Note every timestamp, person, and message — nothing is too small
- Download and examine any shared images or files

### 2. Identify People

For every person who posted or was mentioned:
- Fetch their Slack profile (`slack_read_user_profile`)
- Check if they have a row in `People` (`notion-search` with the name)
- Note their role, team, and title
- Track who did what (reported, investigated, fixed, confirmed, etc.)

### 3. Build the Timeline

Reconstruct a detailed timeline from all sources:
- Every message with exact timestamp (CET)
- Attribution: who said/did what
- Cross-reference between channels (same person posting in incident channel + DMs)
- Key moments: first report, incident declared, root cause identified, fix created, fix merged, resolution confirmed

### 4. Create the Incident Row

Create a row in the `Work` database with `notion-create-pages`. The title is the incident name. Set these properties:

- `Work.Type = Incident`
- `Date` as `date:Date:start`, `YYYY-MM-DD`
- `Work.Quarter`, for example `Q1-2026`
- `Description`, about 150 characters
- `Work.Project`, the relevant project
- `Work.Status = active`
- `Work.Ticket`, `TICKET-XXXX`
- `Work.Severity`, `high`, `medium`, or `low`
- `Work.Role`, your role
- `Tags`, with `work-note` and `incident`
- `Work.Person`, a relation to the `People` rows of everyone involved
- `Work.Competencies`, a relation to the `Competencies` rows that the incident shows

Sections of the body:
- **Context** — what happened, what triggered it, who was involved
- **Root Cause** — technical explanation
- **Resolution** — fix PR(s), what changed
- **Timeline** — full detailed table with timestamps
- **Impact** — users affected, business impact
- **Involved Personnel** — with a page mention of each `People` row
- **Notes** — key actions by the user, analysis
- **Analysis** — what this means strategically (pattern, visibility, competencies)
- **Related** — page mentions of all related rows and competencies. Set `Work.Related` as well

Each page mention is `<mention url="<page URL>">Title</mention>` and holds the page title.

### 5. Create/Update People Rows

For key people involved who don't have a row in `People`:
- Create the row with `Name`, `Description`, `People.Role` (the title of the person), `People.Team` (a relation to the `Teams` row), and `Tags` with `person`
- `Page > People & Context` shows the new row through its linked view, so add nothing to an index

For existing `People` rows:
- Add the incident as a Key Moment with `notion-update-page` and `insert_content`

### 6. Update Related Pages

- `Work > Incidents` lists the new row. Add nothing to an index
- `Page > North Star` — add the incident summary to the Recent Context section
- `Page > Patterns` — if this reveals a recurring pattern
- `Page > Gotchas` — if this reveals a technical gotcha
- `Perf docs > Brag quarters` — add to the row of the relevant quarter, and set `Perf docs.Work evidence` and `Perf docs.Competencies`
- Add the detailed brag entry to the body of that quarter row

### 7. Prepare Incident Report Draft (if applicable)

If you are or may lead the post-mortem:
- Check your org's post-mortem template (add it as a `Knowledge` row with `Knowledge.Type = Reference` if you have one)
- Create a `Work` row titled `TICKET-XXXX Post-Mortem Draft` with `Work.Type = Incident`, `Work.Status = draft`, and `Work.Parent` set to the incident row. Follow your org's post-mortem template
- Include: Executive Summary, Narrative Timeline (4-column), 5 Whys analysis, Action Items table

### 8. Offer Next Steps

After capturing, suggest:
- "Want me to prepare the incident ticket fields?" (Points of Time, Impact, RCA)
- "Want me to draft a message for the incident channel?"
- "Want me to create a root cause analysis document?"
- "Should I run `/om-vault-audit` to verify everything links properly?"

## Important

- **Read every message** — don't skim or summarize prematurely
- **Preserve exact timestamps** — incident timelines need precision
- **Attribute everything** — who said what, who did what
- **Cross-reference** — the same event may be described differently in DMs vs incident channel
- **Check Slack profiles** — roles and teams matter for the story
- **Be blameless in public docs** — use commit SHAs, not names, in shareable documents
- **Private analysis is honest** — the Notion row can include strategic analysis about credit, visibility, etc.
