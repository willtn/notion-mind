---
description: "Prep for any meeting by topic — subject-forward briefing with open tasks, blockers, and brainstormed considerations the user may not have thought of yet."
---

# Meeting Prep

Deep briefing on a subject before a meeting. Leads with the topic, not the people. Surfaces what's unresolved and brainstorms considerations, risks, and angles that may not have been raised yet.

## Notion access

Read with `mcporter call notion.<tool> --args '<JSON>' --output json`. Use no pipe and no redirect. Put no single quote in the JSON. Read `notion-map.json` in the project root for the `data_source` URL and the view URLs of each database. This command makes no write.

## Usage

```
/om-meeting <topic>
```

Examples:
- `/om-meeting Janus Project`
- `/om-meeting Legal sign-off workflow`
- `/om-meeting Qwen font exploration`
- `/om-meeting ComfyUI model server access`

## Workflow

1. **Search Notion**. Run `notion-search` with short keywords of "$ARGUMENTS". The search is keyword-based, so run it again with synonyms and related terms to find content that uses other words:
   `mcporter call notion.notion-search --args '{"query":"<keywords>","query_type":"internal"}' --output json`

2. **Load all related rows**. Read every relevant result with `notion-fetch`: work notes, decisions, incidents, person rows, team rows. A meeting about one topic often touches adjacent projects and prior decisions. Follow the `Work.Related`, `Work.Decisions`, and `Work.Parent` relations of each row to find more.

3. **Build the subject picture**. Synthesize what Notion knows:
   - Current status and recent changes (`Work.Status`, `Work.Changed`)
   - How this topic connects to other active work
   - Prior decisions that affect this topic
   - Outstanding items directly tied to this subject

4. **Surface open items**. Collect all unresolved threads related to the topic:
   - Open checkboxes (`- [ ]`) from related rows (`Work.Open tasks` and `Work.Open loops` show which rows have them)
   - Documented blockers
   - Questions raised but not answered
   - Rows with no recent movement (`Work.Days untouched`)

5. **Brainstorm considerations**. Go beyond what's in Notion. Think through:
   - What could go wrong that hasn't been written down yet
   - Dependencies on other teams, people, or systems not yet flagged
   - Decisions that will likely need to be made, and what the options are
   - Edge cases or failure modes worth raising
   - Things that have tripped up similar work before (check `Page > Gotchas`)
   - Stakeholders who aren't in the room but whose work this affects

6. **Note relevant people**. List who's involved and their role relative to this topic only (not relationship history or 1:1 context, that's `/om-prep-1on1`)

7. **Present the briefing**:

   ### Current State
   Concise synthesis of where things stand on this topic right now.

   ### Open Items
   All unresolved tasks, blockers, and unanswered questions, in checklist format.

   ### Likely Decisions
   What will probably need to be decided or agreed in this meeting, with options if known.

   ### Considerations Worth Raising
   Brainstormed angles, risks, dependencies, and edge cases, especially things NOT already in Notion. This is the most valuable section.

   ### People Involved
   Who's relevant to this topic and in what capacity (role only, no 1:1 context).

   ### Questions to Ask
   Suggested questions based on gaps, risks, or unresolved threads.

## After the Meeting

Use `/om-dump` to capture outcomes, decisions, and new context. It will route everything to the right rows.

## Important

- **Lead with the subject, not the people**. This is a topic briefing, not a relationship prep
- The Considerations section is the core value. Push beyond what's already documented
- If the topic has no rows in Notion, say so and offer to create a stub before the meeting
- Keep it scannable. The user needs to absorb this quickly before walking in
- This is NOT for 1:1 prep. Use `/om-prep-1on1` for person-focused meeting prep with wins and brag context
