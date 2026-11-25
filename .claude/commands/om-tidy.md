---
description: "Self-maintenance pass — acts on every hygiene flag: completes finished work, groups loose clusters, splits oversized rows, reports stale open loops, fixes links. Safe by construction: never deletes, zero content loss."
---

# /om-tidy

The acting half of the hygiene system. The SessionStart and Stop hooks and the write-time flags of the write hook DETECT drift. This command ACTS on it. Run on demand, during wrap-up when flags are present, or when the flag list has visibly piled up. Stop fires after every response, so it shows its findings once per session and again only when they change, rather than repeating them every turn.

## Notion access

Read with `mcporter call notion.<tool> --args '<JSON>' --output json`. Use no pipe and no redirect. Put no single quote in the JSON. Read `notion-map.json` in the project root for the `data_source` URL and the view URLs of each database. Each hygiene flag is a saved view, so `notion-query-data-sources` reads it in view mode:

`mcporter call notion.notion-query-data-sources --args '{"data":{"mode":"view","view_url":"<view URL from notion-map.json>","page_size":100}}' --output json`

Write in two steps. First use the `Write` tool to make `.claude/state/outbox/<name>.json` with the JSON arguments. Then run `mcporter call notion.<tool> --args "$(cat .claude/state/outbox/<name>.json)"`. `notion-create-pages` needs `"allow_async": false`.

## Hard rails (safe by construction)

- **Never delete.** Reorganization is a property change, or a split with verbatim content moves. Zero content loss.
- **Every Notion edit is live at once.** Make one write for each change, so the page history shows each change. List the page URL of each row that you changed.
- **Judgment calls get flagged, not executed.** Anything ambiguous (does this cluster share real context? is this row's status actually done?) is listed for the user instead of acted on.

## The mechanical tier (act on these)

Work through the current hygiene flags in order:

1. **Done but still active**: read `Work > Stale Actives`. For each row whose work is finished, set `Work.Status = completed` with `notion-update-page` and `update_properties`. Clusters keep their `Work.Project` value, so set the status on every row of the cluster. Same semantics as `/om-project-archive`. Use it for anything with ceremony.
2. **Ungrouped clusters**: read `Work > Hygiene: loose active`. When the loose rows genuinely share context (judge, don't trust keyword overlap), set the same `Work.Project` value on each member.
3. **Oversized rows (25KB+)**: read `Work > Hygiene: oversized`, and the view `Hygiene: oversized` of each other database. SPLIT, never trim. Move whole sections verbatim into new rows (domain rows, event-log satellites, or an archive row). Set `Work.Parent` (or `Knowledge.Parent` for a `Knowledge` row) on each new row to the core row. Leave a one-liner index behind in the original. Retarget the links that pointed at the moved sections: find them with `notion-list-page-backlinks` and fix each with `update_content`. `Archive` titles are exempt by design. A split is complete only when the new rows are wired into the graph. Search each new row's concepts with `notion-search` and link what shows up.
4. **Orphans and broken links**: a new row must be linked from at least one row. Check with `notion-list-page-backlinks`:
   `mcporter call notion.notion-list-page-backlinks --args '{"page_id":"<page URL or ID>"}' --output json`
   Fix each mention that a move in this pass broke. The hand-kept indexes are views, so there is no index to update.
5. **Linking pass**: for rows created or split in this pass, run `notion-search` on their core concepts, with more than one phrasing because the search matches keywords. Add the links that the graph is missing: the relation property when a view reads it (`Work.Related`, `Work.Decisions`, `Work.Competencies`), a page mention for the rest.

## The report tier (list, never act)

- **Open loops**: the stale follow-up flags from `Work > Hygiene: open loops`. Chasing, closing, or parking a follow-up is the user's judgment. List them with page URLs and counts and move on.
- **Competency evidence freshness**: for each row of `Competencies > Competency Map`, read `Competencies.Evidence` and count the evidence rows whose `Work.Changed` is in this half (use `Work > Recently changed`). Competencies with ZERO fresh evidence this half get listed. Months of lead time to generate the missing evidence beats discovering thinness at review season. Report only. What counts as evidence is review judgment.
- Any judgment calls deferred from the mechanical tier.

## Report

Create a row of `Work` titled `YYYY-MM-DD tidy report` with `Work.Type = Thinking` and `Work.Status = draft`. List the actions taken (property changes, splits, links), flags cleared, judgment calls deferred, and open loops. Keep it compact. The report is a receipt, not an essay. Once its findings are resolved, ask the user whether to move it to the trash with `notion-delete-pages`. Thinking rows are a scratchpad by contract.

## Related

- `/om-weekly` § hygiene sweep: the scheduled home of this pass
- `/om-project-archive` · `/om-vault-audit` (deep audit, agent-backed)
