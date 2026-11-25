# Project Archive

Mark a completed project as done, so it leaves the active views and joins the completed views. Notion has no folders, so a property change replaces the file move.

## Notion access

Read with `mcporter call notion.<tool> --args '<JSON>' --output json`. Use no pipe and no redirect. Put no single quote in the JSON. Read `notion-map.json` in the project root for the `data_source` URL and the view URLs of each database.

Write in two steps. First use the `Write` tool to make `.claude/state/outbox/<name>.json` with the JSON arguments. Then run `mcporter call notion.<tool> --args "$(cat .claude/state/outbox/<name>.json)"`.

## Usage

```
/om-project-archive <project name>
```

## Workflow

### 1. Find the Row

Query `Work > Active Work` and look for the project name. If the view does not show it, run `notion-search`. Confirm with the user before proceeding.

### 2. Update Properties

Use `notion-update-page` with `update_properties`. For example, the outbox file holds:

```json
{"page_id":"<page URL>","command":"update_properties","properties":{"Status":"completed"}}
```

- Set `Work.Status = completed`
- Verify `Work.Quarter` is set correctly
- Verify `Description` reflects the final state

### 3. Archive the Row

The `Work.Status` change is the move. The row leaves `Work > Active Work` and joins `Work > Completed`. Do not move the page.

**Clustered workstreams**: when the project is a group of rows that share one `Work.Project` value, set `Work.Status = completed` on EVERY row of the group. Every row keeps its `Work.Project` value, so the grouping stays.

### 4. Update Related Pages

- **`Page > North Star`**: Mark as completed in Current Focus if listed there. Use `notion-update-page` with `update_content`
- **`Perf docs > Brag quarters`**: Verify the project is captured in the highlights of the relevant quarter
- **`Page > North Star`, Recent Context section**: Update it if the project is mentioned as "in progress"
- The hand-kept index of projects is gone. `Work > Active Work` and `Work > Completed` replace it, so there is nothing to move

### 5. Verify

- Run `notion-list-page-backlinks` on the row and check that its relations (`Work.Related`, `Work.Decisions`, `Work.Competencies`) still hold their pages
- Query `Work > Completed` and confirm the row is there, and that `Work > Active Work` no longer has it

## Important

- Archive by a property change. Never copy the row and delete the old one
- Don't archive without user confirmation
- If the project has sub-rows (like incidents have RCA + deep dive), ask if those should be set to completed too
