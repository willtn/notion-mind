# Auto-Memory Index (Claude Code)

**All project memories live in the Notion workspace.** `~/.claude/projects/.../memory/MEMORY.md` is an auto-loaded index that points to Notion pages. It is the only file in that folder. Never make another memory file there. The `PostToolUse` hook warns when one appears.

| System | Location | Purpose |
|--------|----------|---------|
| **MEMORY.md** | `~/.claude/projects/.../memory/MEMORY.md` | Auto-loaded index only. Links to Notion pages. |

When asked to "remember" something (steps 1 to 3 are in `AGENTS.md` → **Memory System**):

4. Do NOT make other files in `~/.claude/projects/.../memory/` beyond MEMORY.md. They are outside the note store, so no view, search, or hook sees them.
