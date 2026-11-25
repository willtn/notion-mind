# Self-Review Writer

Write your self-assessment for your company's review tool. Produces project impact descriptions, competency self-assessments (current level / next level), principles, and growth plan — all within character limits, fact-checked, strategically calibrated.

## Notion access

Read with `mcporter call notion.<tool> --args '<JSON>' --output json`. Use no pipe and no redirect. Put no single quote in the JSON. Read `notion-map.json` in the project root for the `data_source` URL and the view URLs of each database.

Write in two steps. First use the `Write` tool to make `.claude/state/outbox/<name>.json` with the JSON arguments. Then run `mcporter call notion.<tool> --args "$(cat .claude/state/outbox/<name>.json)"`. `notion-create-pages` needs `"allow_async": false`.

## Usage

```
/om-self-review [cycle]
```

Default cycle: current review period.

## Context: Review System

Adapt this to your company's review system. Common patterns:

- **Evaluation axes**: Impact (what was delivered), Competencies (skill demonstration at level), Principles (culture/values alignment). Customize the specific dimensions and terminology.
- **Rating scale**: Common scales include Below/Meet/Above or 1-5. Configure per your org.
- **Audience**: Typically your manager, possibly a calibration panel. Understand who reads this and tailor detail accordingly.
- **Your self-assessment sets the anchor** — especially when the manager is new or has limited context.

## Workflow

### 1. Load Context

Read in order. Query each view with `notion-query-data-sources` and read each row with `notion-fetch`:
1. `Page > North Star` — current goals and focus
2. The row of `Perf docs` with `Perf docs.Type = Review brief` for the cycle (`Perf docs.Cycle`) — the full private review brief
3. The row of `Perf docs` with `Perf docs.Type = Review artifact` for the manager brief — what the manager has seen
4. Previous cycle review — baselines
5. `Perf docs > Brag quarters` — the quarter rows covering the period
6. All rows of `Competencies > Competency Map`
7. The `Knowledge` row for the performance framework — evaluation structure (if it exists)
8. Key `Work` rows for submitted projects

### 2. Draft Projects

For each submitted project (within your tool's character limit, e.g. 1000 chars):
- Open with your role and scope
- Cover impact dimensions: what was delivered, quality of execution, process efficiency, complexity handled
- Include specific evidence: numbers should be factual (PR counts, team size, timeline)
- End with outcome or significance

Decide all ratings at the end together — calibrate the full picture before committing.

### 3. Draft Competencies

For each competency, decide current level (Yes/No) and next level (Yes/No):
- Read the level criteria from the competency row
- Check each sub-criterion: is there concrete evidence? The `Competencies.Evidence` property lists the `Work` rows that show the competency
- If saying Yes to next level, every sub-criterion should be defensible — missing the primary criterion undermines credibility

Draft text per YES answer (within your tool's character limit):
- **Competency texts are NOT project descriptions** — the project section already covers WHAT. Competency texts cover HOW you applied the skill.
- Lead with behaviors and decisions, not deliverables
- Reference the previous cycle baseline: "Previously Meet, this period X" shows trajectory
- Calibrate jargon per audience: technical for Architecture/Functional Expertise, behavioral for Communication/Planning
- No overlap between current level and next level texts for the same competency — use different evidence or different framing

### 4. Draft Principles

For each principle (within your tool's character limit):
- Reference the previous cycle baseline and any specific growth feedback
- Lead with the strongest evidence
- If the rating changed from last cycle, make the growth explicit

### 5. Strategic Calibration

Before finalizing, review the full picture:

**Impact**: Are the ratings defensible? Is there one genuine Meet to show calibration, or are all Above justified?

**Competencies**:
- Are next-level YES answers defensible on EVERY sub-criterion?
- Would you be comfortable if a calibration reviewer challenged any specific answer?
- Does claiming YES here protect or undermine the credibility of other next-level claims?

**Principles**: Does the pattern from last cycle to this cycle show growth?

**Audience check**: Will the manager (who may be new) have enough context to defend these ratings in calibration, or does the written evidence need to do the heavy lifting?

### 6. Quality Checks

- [ ] All sections within your tool's character limit (count: use the `Write` tool to put the section in `.claude/state/count/<name>.txt`, then run `wc -m .claude/state/count/<name>.txt`)
- [ ] Watch for special characters (em-dashes, en-dashes) — some review tools count these as multiple characters
- [ ] Every factual claim backed by Notion evidence
- [ ] No fabricated decisions ("chose X over Y" when Y was never considered)
- [ ] No self-undermining language in next-level YES texts ("not yet at yearly scope")
- [ ] Dates verified — check day of week before claiming "weekend work"
- [ ] No references to specific people's performance issues — don't volunteer information about others' struggles
- [ ] Growth baselines stated for competencies and principles
- [ ] Technical jargon calibrated per audience

### 7. Fact-Check Pass

Enter plan mode. For every claim:
- Is it in Notion? Which page?
- Is it first-hand or inferred?
- Could a reviewer challenge it with "what's your evidence?"
- If the claim names a file, function, or flag — does it still exist?

Flag and fix anything that doesn't pass.

### 8. Save

Save the draft as a row of `Work` with `Work.Type = Thinking` and the title `review-drafts`, for copy-pasting.
After submission, promote it: create a row of `Perf docs` with `Perf docs.Type = Review artifact`, the title `Self-Review`, and `Perf docs.Cycle` set. Then set `Work.Status = completed` on the draft row.

## Tips

1. **Your self-assessment anchors the conversation** — especially with a new manager who lacks independent context.
2. **Check character counts early and often.** Count after every draft, not after pasting.
3. **Watch special characters** — some review tools count em-dashes and en-dashes as multiple characters.
4. **Peer reviews feed into your ratings.** What peers write about you is visible. What you write about peers builds your reputation as a thoughtful evaluator.
5. **Fact-check before submitting.** Plan mode for verification catches fabricated claims, wrong dates, and references that shouldn't appear in a review.
