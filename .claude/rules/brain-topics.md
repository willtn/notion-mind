## When to Consult Brain Topics

The SessionStart hook injects a **Brain Topics (read on demand)** index. The index lists each row of the `Knowledge > Brain index` view with its description. A row with no bullet in its body has the marker `(empty)`. Use the index as a menu:

- When the message of the user touches a topic of the index (debugging → Gotchas, "how do we usually…" → Patterns, "why did we decide" → Key Decisions), search Notion **first**, before you answer. Call `notion-search` with the `data_source_url` of `Knowledge` from `notion-map.json`, in the read form of `.claude/rules/notion-calls.md`.
- Then fetch only the rows that match the topic with `notion-fetch`. Do not fetch all of `Knowledge`.
- Skip a row with the marker `(empty)`. It is a stub with no content.
- For "which command" questions, read `brain/Skills.md` in the repository.
- After you answer, if the conversation made durable knowledge, update the brain topic row (see the "remember" workflow in `AGENTS.md` → **Memory System**).
