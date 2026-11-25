---
description: "Freeform capture mode. Dump anything — conversations, decisions, incidents, wins, thoughts — and I'll route it all to the right Notion rows with proper properties and relations."
---

Process the following freeform dump. For each distinct piece of information:

## Notion access

Read with `mcporter call notion.<tool> --args '<JSON>' --output json`. Use no pipe and no redirect. Put no single quote in the JSON. Read `notion-map.json` in the project root for the `data_source` URL and the view URLs of each database.

Write in two steps. First use the `Write` tool to make `.claude/state/outbox/<name>.json` with the JSON arguments. Then run `mcporter call notion.<tool> --args "$(cat .claude/state/outbox/<name>.json)"`. `notion-create-pages` needs `"allow_async": false`.

## Steps

1. **Classify** it: decision, incident, 1-on-1 content, win/achievement, architecture, project update, person context, or general work note.
2. **Search first**: Use `notion-search` with short keywords to check if a related row already exists:
   `mcporter call notion.notion-search --args '{"query":"<keywords>","query_type":"internal","data_source_url":"<data source URL>"}' --output json`
   Prefer appending to an existing row (`notion-update-page` with `insert_content`) over creating a new row for small updates.
3. **Create or update** the row in the right database:
   - Decision: `Work`, with `Work.Type = Decision`
   - Incident: `Work`, with `Work.Type = Incident`
   - 1-on-1 content: `Work`, with `Work.Type = 1:1`
   - Project update or general work note: `Work`, with `Work.Type = Work note`
   - Win or achievement: the brag quarter row of `Perf docs`, with `Perf docs.Type = Brag quarter`
   - Architecture: `Knowledge`, with `Knowledge.Type = Reference`
   - Person context: a row of `People`
   
   Set the properties that the type needs: `Date` (as `date:Date:start`), `Description`, `Tags`, `Work.Status`, `Work.Quarter`, and the type-specific ones (`Work.Ticket`, `Work.Severity`, `Work.Role`). Fetch the database first with `notion-fetch` to get the exact property names. The write hook sets `Work.Changed`, `Work.Bytes`, `Work.Open tasks`, `Work.Open loops`, and `Work.Hook stamp`. Do not set them.
   
   Set a relation for each link that a view or a rollup reads: `Work.Person`, `Work.Team`, `Work.Competencies`, `Work.Decisions`, `Work.Related`. Put every other link in the body as a page mention, `<mention url="<page URL>">Title</mention>`. A mention must hold the page title.
4. **Check the views**: The views replace the hand-kept indexes. Add nothing to an index. A new person row appears in `People > All People`. A win goes into the brag quarter row, with `Perf docs.Work evidence` set to the work row.
5. **Cross-link**: Ensure every new row has at least one relation or mention to an existing row, and has a backlink from at least one existing row. Check with `notion-list-page-backlinks`:
   `mcporter call notion.notion-list-page-backlinks --args '{"page_id":"<page URL or ID>"}' --output json`

After processing everything, provide a summary:
- What was captured and where each piece was filed
- Any new rows created (with page URLs)
- Any existing rows updated
- Any items you weren't sure how to classify (ask the user)

Content to process:
$ARGUMENTS
