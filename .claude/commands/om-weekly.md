---
description: "Weekly synthesis — cross-session review of Notion activity, North Star alignment, patterns, uncaptured wins, and forward priorities."
---

Cross-session synthesis of the past week. Bridges daily standup (lightweight) and quarterly review brief (comprehensive). This is ANALYSIS, not verification — find patterns, surface drift, detect uncaptured work.

## Notion access

Read with `mcporter call notion.<tool> --args '<JSON>' --output json`. Use no pipe and no redirect. Put no single quote in the JSON. Read `notion-map.json` in the project root for the `data_source` URL and the view URLs of each database. This command makes no write unless the user asks for one.

## Subagent

- **`brag-spotter`** — run with weekly scope to find uncaptured wins and competency gaps

## Workflow

### 1. Gather Week's Activity

Automated — no user input needed:

- Read the linked views of `Page > Recently Touched`. There is one view for each database, and each one lists the rows whose `Changed` date is in the last 7 days. The view URLs are in `notion-map.json`:
  `mcporter call notion.notion-query-data-sources --args '{"data":{"mode":"view","view_url":"<view URL from notion-map.json>","page_size":100}}' --output json`
- Read the 1:1 rows from this week (`Work > 1:1 History`, newest first)
- Check `Work > Active Work` for status changes. `notion-get-version-changes` lists the versions of one page:
  `mcporter call notion.notion-get-version-changes --args '{"page":"<page URL or ID>","start_time":"<7 days ago, ISO 8601>"}' --output json`
- Check `Work > Incidents` for new or updated incidents

### 2. North Star Alignment

Read `Page > North Star` and compare actual activity against stated focus:

- **Aligned work**: which Current Focus items got attention this week?
- **Drift**: work that doesn't map to any stated goal (not necessarily bad — flag it)
- **Silent goals**: focus items with zero changed rows and zero mentions
- **Emerging themes**: work patterns suggesting a focus shift that hasn't been written down yet

### 3. Cross-Day Patterns

Look across the week's rows for:
- Recurring themes (same topic in multiple rows or days)
- Multiple incidents or issues touching the same system
- Topics appearing in BOTH work rows and 1:1s (these are signals)
- Context that evolved across sessions (decisions that shifted, understanding that deepened)

### 4. Uncaptured Win Detection

Run the `brag-spotter` subagent with its standard (quarterly) scope, then filter its findings down to wins that clearly occurred in the past 7 days.

Additionally check:
- Were completed items logged in the row of the current quarter in `Perf docs > Brag quarters`?
- Any 1:1 feedback or kudos not captured?
- Incident contributions not bragged about?

### 5. Competency Signal Mapping

For each row of `Competencies > Competency Map`:
- Was it exercised this week? (check `Work.Competencies` of the changed rows, incident roles, 1:1 topics)
- If yes, is the competency explicitly linked from the evidence row? (`Competencies.Evidence` must list it)

Present as a compact table: competency name, exercised (yes/no), linked (yes/no).

### 6. Hygiene Sweep

Act on the current hygiene flags (the SessionStart/Stop scan): complete finished work, group genuine clusters, split oversized rows, and list stale open loops for the user to chase or park. This is `/om-tidy`'s mechanical tier on a schedule — invoke `/om-tidy` directly for the full pass with its report.

### 7. Forward Look

- Blocked items or upcoming deadlines from active work rows
- North Star goals that need attention next week
- Scheduled 1:1s or meetings worth preparing for
- Suggested priority ordering for next week based on goals + momentum + gaps

### 8. Present Synthesis

Structure the output as:

- **This Week**: 3-5 bullet summary of what actually happened
- **North Star Check**: alignment status — what's on track, what drifted, what's silent
- **Patterns**: cross-day themes worth noting
- **Uncaptured Wins**: anything that should be in the brag quarter row (from brag-spotter)
- **Competency Coverage**: compact table
- **Next Week**: suggested priorities and attention areas

After presenting, offer:
- "Want me to add any of these wins to the brag quarter row?"
- "Should I update North Star with any focus shifts?"
- "Want me to save this as a `Work` row with `Work.Type = Thinking`, titled `weekly-YYYY-MM-DD`?"

## Important

- This is transient analysis by default — do NOT create a row unless the user asks.
- Keep the tone analytical, not cheerful. This is a status check, not a celebration.
- Be honest about drift and silent goals — the value is in surfacing what's NOT happening, not just what is.
- Don't duplicate standup (daily, what's next) or wrap-up (session, verify quality). This is SYNTHESIS across days.
- If it was a light week (few changed rows, no new rows), say so. Don't pad the analysis.
