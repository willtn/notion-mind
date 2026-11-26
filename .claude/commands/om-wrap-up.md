# Wrap Up

Full session review before ending. Review context, ways of working, rows modified, consistency, and suggest improvements.

## Notion access

Read with `mcporter call notion.<tool> --args '<JSON>' --output json`. Use no pipe and no redirect. Put no single quote in the JSON. Read `notion-map.json` in the project root for the `data_source` URL and the view URLs of each database.

Write in two steps. First use the `Write` tool to make `.claude/state/outbox/<name>.json` with the JSON arguments. Then run `mcporter call notion.<tool> --args "$(cat .claude/state/outbox/<name>.json)"`.

## Usage

```
/om-wrap-up
```

Triggered when the user says "wrap up", "let's wrap", "wrapping up", or similar. The agent should invoke this automatically.

## Subagent

- **`brag-spotter`** — run at the end to find uncaptured wins and competency gaps from the session

## Workflow

### 1. Review What Was Done

Scan the conversation for:
- Rows created or modified (list them all with page URLs)
- `People` rows created or updated
- Brag quarter entries added
- Brain pages updated (`Page > Patterns`, `Page > Gotchas`, `Page > Key Decisions`, `Page > North Star`)

### 2. Verify Note Quality

For each row created or modified this session, fetch it with `notion-fetch` and check:
- Properties complete? (`Date`, `Work.Quarter`, `Description`, `Tags`, type-specific fields)
- At least one relation or page mention to another row?
- In the correct database with the right `Work.Type`? (a decision is `Work.Type = Decision`, an incident is `Work.Type = Incident`)
- Description accurate and ~150 chars?
- `Work.Status` correct?

### 3. Check View Consistency

- `Work > Active Work` — are new rows listed? Are completed projects out of it and in `Work > Completed`?
- `Page > North Star` — does the Recent Context section reflect what happened this session?
- `Page > People & Context` — any new people or relationship changes to capture?
- `Perf docs > Brag quarters` — any wins or achievements from this session?
- `Page > Home` — are its linked views still valid?

The hand-kept indexes are views now. Do not edit them.

### 4. Check for Orphans

- Any new rows not linked from at least one other row? Check with `notion-list-page-backlinks`:
  `mcporter call notion.notion-list-page-backlinks --args '{"page_id":"<page URL or ID>"}' --output json`
- Any new people not in `People`?
- Any `Work` rows with `Work.Type = Thinking` that should be promoted or deleted?

### 5. Status Check

- Any `Work.Status` still `active` that should be `completed`? Set it with `notion-update-page` and `update_properties`. Step 6's `/om-tidy` handles the clusters, so do not set a whole cluster by hand here.

### 6. Act on Hygiene

Invoke `/om-tidy` while the conversation and tools are still live. It runs the same hygiene scan the hooks use. If that reports drift, complete its safe mechanical tier now and bring its judgment-tier findings to the user instead of leaving them to a reminder that cannot act on them. Fold the tidy receipt into this wrap-up report. Do not create a second report unless the findings need to survive the session.

### 7. Ways of Working Review

**Index-first**: read the `Knowledge > Brain index` view, then open ONLY the topics this session actually touched. It gives the same knowledge transfer at a fraction of the tokens. Check if this session revealed:
- A new pattern that should be on `Page > Patterns`?
- A new gotcha that should be on `Page > Gotchas`?
- A workflow improvement for the command catalog of the repository?
- An AGENTS.md update needed (new convention, stale reference)?
- A new or improved slash command?
- A hook that should be added or modified?

### 8. Suggest Improvements

Based on how the session went:
- Were there friction points in the workflow?
- Did we do something manually that could be automated?
- Did we repeat a pattern that should be a skill?
- Are there views that should be created or updated?
- Any properties that would help future queries?

### 9. Report

Present a concise summary:
- **Done**: what was captured this session
- **Fixed**: issues found and resolved
- **Flagged**: things that need user input
- **Suggested**: improvements for next time

## Important

- This is a READ + VERIFY pass, not a creation pass. Fix small issues (broken links, missing properties), but flag larger changes for user approval.
- Be honest about what's missing — the goal is leaving Notion in a better state than you found it.
- If North Star goals shifted during the session, suggest updating it.
