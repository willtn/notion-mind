---
description: "Prep for an upcoming 1:1 — load person context, surface open items, suggest agenda based on Notion state."
---

# Prep for 1:1

Prepare for an upcoming 1:1 by gathering everything relevant about the person and current work context.

## Notion access

Read with `mcporter call notion.<tool> --args '<JSON>' --output json`. Use no pipe and no redirect. Put no single quote in the JSON. Read `notion-map.json` in the project root for the `data_source` URL and the view URLs of each database. This command makes no write.

## Usage

```
/om-prep-1on1 <person>
```

Example: `/om-prep-1on1 Scott Detweiler`

## Workflow

1. **Load person context**. Find the `People` row of "$ARGUMENTS" with `notion-search`, then read it with `notion-fetch` for role, relationship, key moments, and any standing dynamics. Its `People.Work` property lists each `Work` row that names the person.

2. **Load recent 1:1 history**. Query `Work > 1:1 History` (newest first) and keep the rows that are in `People.Work`. Read them with `notion-fetch`:
   `mcporter call notion.notion-query-data-sources --args '{"data":{"mode":"view","view_url":"<view URL from notion-map.json>","page_size":100}}' --output json`
   Surface:
   - Unresolved action items from last meeting
   - Topics that recurred across sessions
   - Anything flagged in "What to Watch"

2b. **Carry-forward check**. Open the person's last THREE 1:1 rows and diff their Action Items. Any unchecked item that appears (same or near-same wording) in **two or more consecutive rows is a chronic loop**, not just an open one. List these separately with their first-seen date. "Carried 3× since <date>" is the prep signal that a single row can never show. (The hygiene flag of open loops reads only the latest row. This step is where the chronic pattern shows.)

3. **Load active work**. Query `Work > Active Work` and read the relevant rows with `notion-fetch`. Grouped workstreams share one `Work.Project` value. Identify:
   - Projects this person is connected to (through `Work.Person`, a mention, or a shared `Work.Team`)
   - Blockers or open questions that need a decision or support
   - Work in progress worth giving visibility to

4. **Check North Star alignment**. Read `Page > North Star` with `notion-fetch`. Flag:
   - Goals drifting or with no active work
   - Emerging focus that hasn't been written down yet

5. **Surface wins to share**. Read the row of the current quarter in `Perf docs > Brag quarters` for completed work or milestones since the last 1:1 with this person

6. **Check open tasks**. Query `Work > Open tasks` and `Work > Active Work` (rows with `Work.Open tasks` above 0). Flag any stalled or overdue items

7. **Present the prep brief**:

   - **Who**: one-line reminder: role, relationship, standing dynamics
   - **Since Last Time**: unresolved action items, open "What to Watch" signals
   - **Chronic Loops**: items carried across 2+ consecutive 1:1s (from step 2b), oldest first. Each one is either blocked (raise it), obsolete (kill it), or under-prioritized (say so)
   - **Wins to Share**: completed work and milestones worth mentioning, with enough context to explain impact
   - **Things to Raise**: blockers needing a decision, projects needing visibility, North Star drift
   - **Questions to Ask**: based on gaps or unclear priorities in Notion
   - **Suggested Agenda**: rough order if there are 3+ items: wins → updates → asks → questions

## Important

- This is prep, not a script. Surface the relevant context, let the user decide what to raise
- If no prior 1:1 rows exist for this person, lean harder on active work and North Star for agenda material
- Keep the output scannable. The user is about to walk into a meeting, not read an essay
- Flag sensitive interpersonal items but don't lead with them

## After the Meeting

Run `/om-capture-1on1 $ARGUMENTS` to file the notes as a `Work` row with `Work.Type = 1:1` and update the person row.
