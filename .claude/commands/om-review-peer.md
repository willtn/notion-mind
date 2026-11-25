# Peer Review Writer

Write a peer review for a colleague on your company's review tool. Produces project feedback, principles, and performance summary — all within 1000-char limits, fact-checked against Notion evidence.

## Notion access

Read with `mcporter call notion.<tool> --args '<JSON>' --output json`. Use no pipe and no redirect. Put no single quote in the JSON. Read `notion-map.json` in the project root for the `data_source` URL and the view URLs of each database.

Write in two steps. First use the `Write` tool to make `.claude/state/outbox/<name>.json` with the JSON arguments. Then run `mcporter call notion.<tool> --args "$(cat .claude/state/outbox/<name>.json)"`. `notion-create-pages` needs `"allow_async": false`.

## Usage

```
/om-review-peer <Name>
```

## Context: Review System

Adapt to your company's review system. Common patterns:

- **Peers give comments only** — typically no scores. Manager gives scores.
- **Calibration** may happen at a broader organizational level.
- **Common review fields**: per-project feedback, principles, Strengths, Areas of Development, Confidential Comment (manager-only). Check your tool's character limits.

## Workflow

### 1. Gather Evidence

Load in order:
1. The `People` row of the person (`notion-search`, then `notion-fetch`)
2. PR evidence: the `Perf docs` row with `Perf docs.Type = PR evidence` for the person and the cycle (run `/om-peer-scan` if missing). The `Perf docs.Person` relation finds it
3. Peer review notes: the `Work` rows with `Work.Status = active` that hold review writing notes (`Work > Active Work`)
4. Any brag sheet or impact overview the person shared (user provides)
5. Relevant work rows (`notion-search` for their name, or the `People.Work` property of the person)
6. Slack context if available

### 2. Assess Visibility

For each submitted project, classify your evidence level:
- **Direct**: Worked together daily, first-hand observations
- **Reviewed**: Saw their PRs, reviewed some code, aware of the work
- **Informed**: From their brag sheet or shared documents, limited personal observation

Be explicit about this in the review text. Never overclaim visibility.

### 3. Draft

For each section, draft within your tool's character limit. Count to verify: use the `Write` tool to put the section in `.claude/state/count/<name>.txt`, then run `wc -m .claude/state/count/<name>.txt`.

**Project feedback** (per project):
- Lead with your relationship to the work ("worked alongside daily" vs "less direct visibility")
- Describe what they did and why it matters — behaviors and decisions, not just deliverables
- Include one specific moment you personally observed if possible

**Principles** (your company's defined principles):
- Lead with first-hand evidence, supplement with brag sheet
- Each principle should have distinct evidence — don't repeat the same example
- Reference specific behaviors, not generic praise

**Strengths**:
- Synthesize the defining theme across all projects — what makes this person distinctive?
- One or two specific moments that illustrate the theme
- Keep it genuine — a concise honest assessment beats padded praise

**Areas of Development**:
- Must be genuinely distinct per person — not "be more visible" for everyone
- Frame constructively: "the opportunity is X" not "the weakness is X"
- Base it on something you actually observed, not a generic suggestion

**Confidential Comment** (optional):
- Say something the manager specifically needs to know that wouldn't go in the public sections
- This is NOT a repeat of Areas of Development
- Examples: level trajectory, context the manager lacks, a specific flag worth watching

### 4. Quality Checks

Run these before presenting the draft:

- [ ] All sections within your tool's character limit (count with `wc -m` as in step 3)
- [ ] No PR numbers (e.g., #21579) — describe what was done instead
- [ ] No line counts (e.g., +4,743/-3,362) — these look like an audit
- [ ] No "weekend work visible in timestamps" — don't track when people work
- [ ] Honest about visibility level per project
- [ ] No repetition of the same example across project + principles + summary
- [ ] Areas of Development is specific to THIS person, not generic
- [ ] Confidential adds value the manager doesn't get from public sections
- [ ] Tone sounds like a colleague writing from experience, not a data analysis

### 5. Fact-Check

Enter plan mode and verify every factual claim against Notion sources:
- Dates, timelines, sequences
- Specific contributions attributed to the person
- Claims about "first," "only," or "every" — these are easy to get wrong
- Anything from their brag sheet that you present as your own observation — flag the source honestly

### 6. Save

Save the draft as a row of `Work` with `Work.Type = Thinking` and the title `<name>-peer-review`, for copy-pasting.
After submission, promote it: create a row of `Perf docs` with `Perf docs.Type = Review artifact`, the title `Peer Review - <Full Name>`, `Perf docs.Person` set to the `People` row, and `Perf docs.Cycle` set. Then set `Work.Status = completed` on the draft row.

## Tone Rules

- Write like a colleague talking about someone they work with
- Specific enough to be credible, casual enough to be human
- No emojis, no corporate buzzwords, no "synergy"
- If you wouldn't say it in a 1:1 conversation, don't write it
- It's OK for some sections to be 600 chars if that's all you need to say — don't pad
