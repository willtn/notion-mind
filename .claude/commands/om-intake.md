---
description: "Process all unread meeting notes in the Notion inbox — reads each row, classifies content, routes to the right rows, then clears the inbox."
---

# Meeting Intake

Scans the inbox of the `Work` database for unprocessed meeting exports and routes everything to the correct rows automatically. No arguments needed — just drop the notes and run.

## Notion access

Read with `mcporter call notion.<tool> --args '<JSON>' --output json`. Use no pipe and no redirect. Put no single quote in the JSON. Read `notion-map.json` in the project root for the `data_source` URL and the view URLs of each database.

Write in two steps. First use the `Write` tool to make `.claude/state/outbox/<name>.json` with the JSON arguments. Then run `mcporter call notion.<tool> --args "$(cat .claude/state/outbox/<name>.json)"`. `notion-create-pages` needs `"allow_async": false`.

## Usage

```
/om-intake
```

Put any exported or raw meeting note in the inbox first. An inbox item is a row of `Work` with `Work.Type = Inbox item` and `Work.Status = inbox`. Run this command after. Naming convention for the title: `YYYY-MM-DD <Topic or Person>`.

## Workflow

### 1. Scan the Inbox

List the rows with `Work.Type = Inbox item`. Use a SQL query on the `Work` data source:

`mcporter call notion.notion-query-data-sources --args '{"data":{"data_source_urls":["<data source URL>"],"query":"SELECT * FROM \"<data source URL>\" WHERE Type = ?","params":["Inbox item"]}}' --output json`

If there is no inbox row, say so and stop.

For each row found, read the full content with `notion-fetch` before doing anything else.

### 2. Identify Meeting Type

For each note, determine what kind of meeting it was:

- **1:1** — between two people; personal, career, feedback, or relationship content
- **Project meeting** — status update, check-in, or planning session tied to a specific project
- **Team meeting** — standup, sprint planning, retrospective, or all-hands
- **Decision meeting** — primary purpose was to reach a decision
- **Mixed** — multiple types in one note (process each piece separately)

Use the note's content, title, and any attendee list to make this call.

### 3. Search for Related Context

Before routing, run `notion-search` with the meeting topic or person name to find existing rows the content should attach to. Run it again with related words, because the search matches keywords. Prefer appending to existing rows over creating new ones for small updates.

`mcporter call notion.notion-search --args '{"query":"<meeting topic or person name>","query_type":"internal"}' --output json`

### 4. Route Content

Apply these routing rules to each piece of content:

| Content Type | Destination |
|---|---|
| 1:1 with a specific person | Create a `Work` row titled `<Person> YYYY-MM-DD` with `Work.Type = 1:1`, using the 1:1 note structure |
| Project status update | Append to the relevant `Work` row with `Work.Status = active` (`notion-update-page` with `insert_content`) |
| New project or initiative not in Notion | Create a `Work` row with `Work.Type = Work note` and `Work.Status = active` |
| Decision reached | Create a `Work` row with `Work.Type = Decision` from `Template > Decision Record`, and set `Work.Decisions` on the related work row. `Page > Key Decisions` lists it through its view |
| Action item / open task | Append as `- [ ]` to the relevant work row |
| Win or recognition | Add to the brag quarter row of `Perf docs` with `Perf docs.Type = Brag quarter`, and set `Perf docs.Work evidence` to the source row |
| New person mentioned not in Notion | Create a stub row in `People` |
| Blocker identified | Append to the relevant active row under `## Blockers` or `## Open / Next Steps` |
| Question raised but unanswered | Append to the relevant row under `## Open Questions` |

For 1:1 rows, set these properties: `Date` (as `date:Date:start`), `Description` ("1:1 with <Person> — <one-line summary>"), `Work.Person` (a relation to the `People` row), `Tags` (`work-note`), and `Work.Status = completed`. Use this body:

```markdown
# 1:1 with <Person> — YYYY-MM-DD

## Key Takeaways

## Action Items

- [ ] 

## Quotes / Direct Feedback

## What to Watch

## Related

- <mention url="<person page URL>"><Person></mention>
```

### 5. Cross-Link

After routing all content:

- Every new row must have at least one relation or page mention to an existing row
- Every existing row updated must have its Related section checked. Add any new links that are now relevant
- If a person was mentioned, link to their `People` row from the work row and the other way. Set `Work.Person` as well as the mention

### 6. Clear the Inbox

After processing each inbox row, confirm what was routed and ask:

> "Done processing `<title>`. Move it to the trash?"

If yes, run `notion-delete-pages` with `user_confirmed` set to true. If no, leave the row and move on.

After all rows are processed, present a summary:

### Summary Format

```
## Intake Complete

Processed: <N> row(s)

### Routed
- <title> → <list of rows created or updated>
- ...

### New Rows Created
- <page URL>
- ...

### Action Items Captured
- [ ] <item> → <row>
- ...

### Decisions Logged
- <decision> → <row>
- ...

### Wins Added to the Brag Quarter
- <win>
- ...

### Items That Needed a Judgment Call
(anything you weren't sure how to classify — ask the user)
```

## Important

- **Never delete a row without confirmation** — always ask first
- If a note is ambiguous (can't tell who the meeting was with, or what project it belongs to), ask before routing
- Prefer appending to existing rows over creating new ones for small updates
- If the title has no date, use today's date
- This command handles structured exports — for freeform brainstorming or ad hoc capture, use `/om-dump`
