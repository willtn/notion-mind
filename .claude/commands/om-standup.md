---
description: "Morning kickoff. Load today's context, review yesterday, surface open tasks, and identify priorities."
---

Run the morning standup.

## Notion access

Read with `mcporter call notion.<tool> --args '<JSON>' --output json`. Use no pipe and no redirect. Put no single quote in the JSON. Read `notion-map.json` in the project root for the `data_source` URL and the view URLs of each database.

**Start from the SessionStart injection. Do NOT read again what it already carries.** The hook has already injected: the North Star excerpt, active work, recent changes, open tasks, hygiene flags (incl. open loops), and the brain index. A second read of `Page > North Star` or of `Work > Active Work` doubles the token cost for zero new information.

Gather only what the injection does NOT have:

1. Read the rows that changed yesterday and today. Query `Work > Recently changed` and keep the rows whose `Work.Changed` is in that range:
   `mcporter call notion.notion-query-data-sources --args '{"data":{"mode":"view","view_url":"<view URL from notion-map.json>","page_size":50}}' --output json`
2. List the tasks in active work that has a project. The injected Open Tasks section covers only loose active notes. Query `Work > Active Work` and keep the rows where `Work.Open tasks` is above 0.
3. Read a page with `notion-fetch` ONLY if the injected active-work list needs status detail that the summary will actually use.
4. Check for unprocessed inbox items. Query `Work > Hygiene: inbox pressure`. The hygiene flags name the inbox items when they age. Each inbox item has `Work.Type = Inbox item`.

Present a structured standup summary:
- **Yesterday**: What got done (from the injected recent changes and the rows of step 1)
- **Active Work**: Current projects (rows with `Work.Status = active`) with their status
- **Open Tasks**: Pending items
- **Open Loops**: stale follow-ups from the injected hygiene flags. Is there anything to chase today?
- **North Star Alignment**: How active work maps to current goals
- **Suggested Focus**: What to prioritize today based on goals + open items. Act on injected hygiene flags here

Keep it concise. This is a quick orientation, not a deep dive.
