---
description: "Voice-calibrated editing — makes Claude-drafted text sound like you wrote it, not like AI wrote it."
---

Edit a note to match your writing voice. This is voice calibration, not pattern removal. Learn HOW you write, not just what to avoid.

## Notion access

Read with `mcporter call notion.<tool> --args '<JSON>' --output json`. Use no pipe and no redirect. Put no single quote in the JSON. Read `notion-map.json` in the project root for the `data_source` URL and the view URLs of each database.

Write in two steps. First use the `Write` tool to make `.claude/state/outbox/<name>.json` with the JSON arguments. Then run `mcporter call notion.<tool> --args "$(cat .claude/state/outbox/<name>.json)"`.

## Usage

```
/om-humanize <page URL or note title>
```

## Workflow

### 1. Load Voice Samples

Read 2-3 recent notes you actually wrote or heavily edited to calibrate voice. Use `notion-fetch`:
- `Page > North Star`: how you write about yourself
- The newest row of `Work > 1:1 History`: natural conversational voice
- Any row of `Knowledge > Brain index` with your authentic writing style

Extract voice fingerprint: sentence length, punctuation habits, how you open sections, how you qualify statements, ratio of direct-to-hedged language, use of dashes and fragments.

### 2. Read Target Note

Read the note specified in $ARGUMENTS with `notion-fetch`. If the argument is a title, find the page with `notion-search` first.

Detect context from the properties of the row:
- **`Work.Type = 1:1`** → conversational, direct, uses "I", okay to be informal
- **A `Perf docs` row** (review content) → corporate-confident but human, evidence-based, respect the character limits
- **`Work.Type = Incident`** → precise, factual, timeline-oriented, no filler
- **A `Knowledge` row** → terse shorthand, fragments okay
- **Default** → colleague-to-colleague, like explaining something in a 1:1

### 3. Edit In-Place

Rewrite the note's content to match your voice. Use `notion-update-page` with `update_content`, one search-and-replace for each passage. Do not use `replace_content`, because it can remove child pages. Key principles:

**Voice rules (from samples):**
- Direct statements, not hedged ones ("This was stressful" not "This presented some challenges")
- Match your natural rhythm: fragments, dashes, whatever you actually use
- Observations should be sharp, not softened
- A concise 600-char section is better than a padded 950-char one

**Anti-patterns (kill these):**
- "Notably", "significantly", "demonstrates", "leveraged", "facilitated"
- "It's worth noting that..." — just note it
- "This showcases..." — just describe what happened
- Hedge stacking: "potentially", "arguably", "it could be said that"
- Empty transitions: "Moving forward", "In terms of", "With regard to"
- Passive voice where active is natural: "was identified" → "found"
- Bullet points that all start with the same word pattern
- Rhetorical questions followed by immediate answers

**Preserve untouched:**
- All properties of the row (change none)
- Page mentions (`<mention>` tags) and their titles
- Linked views and synced blocks
- Callout blocks
- Code blocks
- Tables (content can be edited, structure preserved)
- Checkboxes and task items

### 4. Summarize Changes

Present a brief summary (NOT a full diff):
- **Tone shift**: what changed overall (e.g., "removed hedging, shortened sentences")
- **Key rewrites**: 2-3 examples of before/after for the most significant changes
- **Preserved**: confirm what was left untouched and why

Don't show unchanged sections. The user can open the page history for the full picture (`notion-get-version-changes` lists the versions).

## Important

- This is NOT "remove AI words from a list." It's "make this sound like the same person who wrote the other notes in this workspace."
- If the note is already well-written, say so and make minimal changes. Don't edit for the sake of editing.
- Respect the context. A peer review needs to stay professional even after humanizing. A 1:1 note can be loose.
- If the character count matters (review content in `Perf docs`), count after editing. Use the `Write` tool to put each section in `.claude/state/count/<name>.txt`, then run `wc -m .claude/state/count/<name>.txt`. Compare the count with the limit of the review.

Content to edit:
$ARGUMENTS
