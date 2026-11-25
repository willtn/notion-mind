# Slack Deep Scan

Deep scan Slack channels and DMs for evidence involving a specific person or project. Extracts every touchpoint with timestamps for review evidence or project documentation.

## Notion access

Read with `mcporter call notion.<tool> --args '<JSON>' --output json`. Use no pipe and no redirect. Put no single quote in the JSON. Read `notion-map.json` in the project root for the `data_source` URL and the view URLs of each database.

Write in two steps. First use the `Write` tool to make `.claude/state/outbox/<name>.json` with the JSON arguments. Then run `mcporter call notion.<tool> --args "$(cat .claude/state/outbox/<name>.json)"`.

## Usage

```
/om-slack-scan <target> [channels...] [date-range]
```

Examples:
- `/om-slack-scan "Jane Doe" C0EXAMPLE1 C0EXAMPLE2 "after:2026-03-16"`
- `/om-slack-scan "project:example" C0EXAMPLE1 C0EXAMPLE2 C0EXAMPLE3 C0EXAMPLE4`

## Workflow

1. **Read each channel** fully (paginate with cursor until all messages are fetched):
   ```
   mcp slack_read_channel channel_id=<id> limit=100
   ```

2. **Search for the person** across public+private channels:
   ```
   mcp slack_search_public_and_private query="from:<@USER_ID> after:<date>"
   mcp slack_search_public_and_private query="<Name> after:<date> -from:<@USER_ID>"
   ```

3. **Check DMs** the user points to. Read full history for the relevant period.

4. **For each message involving the target**, extract:
   - Timestamp and channel
   - What was said/done
   - Context (what prompted it, what followed)
   - Whether it's evidence of: technical work, leadership, collaboration, problem-solving, initiative

5. **Organize by date** with clear headers per day. Separate:
   - **Project evidence** goes to the relevant `Work` row
   - **Review/personal context** goes to the `People` row or to a `Perf docs` row for review prep
   - **Team dynamics** goes to the `People` row

   Find each row with `notion-search`. Add the text with `notion-update-page` and `insert_content`.

6. **Flag items that need correction** in existing Notion rows.

## Important

- Be meticulous. Timestamps matter for evidence
- Capture exact quotes when they show initiative, leadership, or problem-solving
- Note when the person was tagged by others (shows they're a go-to person)
- Separate project work from review prep from personal conversations
- Don't mix contexts. Put data where it belongs in Notion
- Check for threads (slack_read_thread) when a message has replies
- Look for screen recordings, files shared, PRs linked
