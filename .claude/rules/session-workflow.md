## Session Workflow

### Starting a Substantial Session

The `SessionStart` hook injects the context of the workspace:

- the North Star goals
- the brain topics index
- the rows changed in the last 48 hours
- the open tasks of the loose active rows and of Home
- the active work
- the workspace listing
- the hygiene findings (act on them or run `/om-tidy`)

Most context is already loaded. You do not need to fetch pages by hand.

**Shortcut**: Run `/om-standup` for a structured morning kickoff that reads everything and presents a summary with suggested priorities.

If you do it by hand, fetch these pages with `notion-fetch` (IDs in `notion-map.json`):

1. Home: the workspace entry point, with its linked views
2. North Star: ground suggestions in current goals
3. The `Work > Active Work` view: see active projects
4. The `Knowledge > Brain index` view: then fetch the relevant topic rows

### Ending a Substantial Session

If `/om-wrap-up` is not invoked, at minimum do these before you wrap up:

1. **Close completed projects**: set `Work.Status` to `completed` (or use `/om-project-archive`)
2. Update the relevant brain topic row (Key Decisions, Patterns, Gotchas in `Knowledge`) with key learnings
3. Update the People & Context page if org knowledge changed
4. Update the brag quarter row of `Perf docs` if wins or impact were achieved
5. Offer to update North Star if goals shifted or new focus emerged
6. Verify that each new row has a relation or a mention to an existing row (orphans are bugs)
7. If work demonstrates competencies, set the `Competencies` relation of the work row
8. Run `/om-vault-audit` if the session created many rows

The views replace the hand-kept indexes, so no index needs an update. Skip steps that do not apply. The goal is to move durable knowledge from the conversation into the workspace.
