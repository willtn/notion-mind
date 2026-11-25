# Generate Review Brief

Generate a performance review context transfer document from Notion data. Supports manager version (PO-friendly) and peer version (project-focused).

## Notion access

Read with `mcporter call notion.<tool> --args '<JSON>' --output json`. Use no pipe and no redirect. Put no single quote in the JSON. Read `notion-map.json` in the project root for the `data_source` URL and the view URLs of each database.

Write in two steps. First use the `Write` tool to make `.claude/state/outbox/<name>.json` with the JSON arguments. Then run `mcporter call notion.<tool> --args "$(cat .claude/state/outbox/<name>.json)"`. `notion-create-pages` needs `"allow_async": false`.

## Usage

```
/om-review-brief <audience> [period]
```

Examples:
- `/om-review-brief manager "Q3 2024 + Q4 2024"`
- `/om-review-brief peers "Q3 2024 + Q4 2024"`

## Subagent

- **`review-prep`** — aggregates all evidence (brag quarters, decisions, incidents, competencies, 1:1 feedback, PR scans) for the period

Launch the subagent first to gather raw material, then use its output to write the brief.

## Workflow

### 1. Gather Data

Read these sources from Notion. Query each view with `notion-query-data-sources` and read each row with `notion-fetch`:
- The row of `Perf docs` with `Perf docs.Type = Review brief` for the cycle (or the current private brief) — full context
- `Perf docs > Brag quarters` — quarterly highlights and detail for the period
- `Perf docs > Review Evidence: By Cycle` — PR data (`Perf docs.Type = PR evidence`)
- `Work > All by Quarter` — project rows for the period (`Work.Quarter`)
- `Competencies > Competency Map` — competency definitions
- Previous review rows for baseline comparison

### 2. Generate Content

**For manager audience:**
- Frame for a non-technical audience — outcome language, not technical jargon
- Include: The Arc (narrative), Impact at a Glance (table), Impact Details (per project), Competency Highlights (with baselines), Documentation Trail
- Simplify technical terms for your audience's background
- No page mentions — use plain text or markdown links to external resources
- Include all documentation, task tracker, repository, error tracking, and communication references

**For peer audience:**
- Can be more technical but still accessible (peers write reviews that go to manager)
- Organize by project (a common review tool structure)
- Include "Other things worth mentioning" for non-project work
- Casual tone — "jog your memory", "no pressure to cover everything"
- No competency section — that's for the manager

### 3. Create Files

- Save the Markdown version as a row of `Perf docs` with `Perf docs.Type = Review artifact`. Set `Perf docs.Cycle`, `Perf docs.Period`, and `Perf docs.Status = draft`
- HTML version with professional styling (blue theme, tables, responsive). Write it to `.claude/state/review/` on this machine. The HTML and PDF files stay local, and nothing uploads them
- PDF via Chrome headless: `--headless --no-pdf-header-footer --print-to-pdf`

### 4. Verify

- Check page breaks in PDF (render pages with pdftoppm)
- Ensure no content is cut mid-section
- Verify all links work
- Cross-check PR counts and dates against the `Perf docs` rows with `Perf docs.Type = PR evidence`, and the `Knowledge` rows with `Knowledge.Type = Reference`

## Important

- NEVER include: sensitive interpersonal details, 1:1 talking points, peer selection strategy, personal strategic notes in shared versions
- Always maintain a private version with full context
- When updating, update BOTH private + shared versions
- Manager version: no page mentions, non-technical language, professional formatting
- Peer version: project-focused, accessible language
