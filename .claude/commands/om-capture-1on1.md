# Capture 1:1 Meeting

Take a meeting transcript, notes, or a Google Meet summary and create a structured Notion row with key takeaways, quotes, action items, and DM context.

## Notion access

Read with `mcporter call notion.<tool> --args '<JSON>' --output json`. Use no pipe and no redirect. Put no single quote in the JSON. Read `notion-map.json` in the project root for the `data_source` URL and the view URLs of each database.

Write in two steps. First use the `Write` tool to make `.claude/state/outbox/<name>.json` with the JSON arguments. Then run `mcporter call notion.<tool> --args "$(cat .claude/state/outbox/<name>.json)"`. `notion-create-pages` needs `"allow_async": false`.

## Usage

```
/om-capture-1on1 <participant>
```

User will paste the transcript/notes. Example: `/om-capture-1on1 <name>`

## Workflow

1. **Parse the input**. Handle Google Meet transcripts, raw notes, or meeting summaries.

2. **Create the row** in the `Work` database with `notion-create-pages`. The title is `<Participant> <YYYY-MM-DD>`. Set these properties:

   - `Work.Type = 1:1`
   - `Date` as `date:Date:start`, the meeting date
   - `Description`, a one-line summary of the key topics discussed
   - `Tags`, with `work-note`
   - `Work.Status = completed`
   - `Work.Person`, a relation to the `People` row of the participant

3. **Structure the body** with these sections:
   - **Key Takeaways**: bullet points of the most important things discussed, grouped by topic
   - **Decisions Made**: anything agreed upon
   - **Action Items**: with checkboxes, who owns each
   - **Quotes Worth Noting**: direct quotes that reveal priorities, feedback, or dynamics (use blockquotes)
   - **What Went Well**: what landed, what resonated
   - **What to Watch**: things to monitor, concerns, ambiguous signals
   - **Context From DMs**: check relevant DMs before/after the meeting for color (ask user for channel IDs if needed)
   - **Related**: page mentions of relevant rows, each as `<mention url="<page URL>">Title</mention>`

4. **Update related rows**:
   - The `People` row of the participant (add a 1:1 section or update the existing one). Find it with `notion-search` and change it with `notion-update-page`.
   - The views replace the hand-kept lists. `Work > 1:1 History` lists the new row, so add nothing to an index.
   - The `Page > North Star` page, if any context changed (manager dynamics, priorities, etc.)

5. **Check for stale context**. If the meeting reveals something that contradicts existing rows, flag and update.

## Important

- Preserve the conversational tone. Do not over-formalize quotes
- Flag sensitive interpersonal items. Note if they should stay private
- Separate what was SAID from what it MEANS (interpretation goes in "What to Watch")
- Cross-reference with DMs from the same day for fuller picture
