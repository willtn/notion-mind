# Auto Memory

All project memories live in the Notion workspace of obsidian-mind. This file is a small index.

## Rule: Workspace-First Memories

**All new memories for this project MUST go to Notion rows, NOT to files in this directory.**

- Durable knowledge → the brain topic rows of `Knowledge` (searchable, linked, with page history)
- This `MEMORY.md` → index only, with links to Notion pages
- Never create new `.md` files in this `~/.claude/` memory directory. They are outside the note store, so no view, search, or hook sees them

## Where to Find Things

| Topic | Notion location |
|-------|-----------------|
| Technical gotchas | The Gotchas row of `Knowledge` |
| Patterns and conventions | The Patterns row of `Knowledge` |
| Key decisions | The Key Decisions row of `Knowledge` |
| Goals and focus | The North Star page |
| Slash commands and skills | `brain/Skills.md` in the repository |
| People and org context | The People & Context page |
| Active work and projects | The Active Work view of `Work` |
| Performance evidence | The Brag quarters view of `Perf docs` |

## Setup

1. Find your project memory path: `~/.claude/projects/<encoded-path>/memory/`
2. Copy this file there as `MEMORY.md`
3. Replace each Notion location with the link of the page or view from your workspace
4. Claude Code auto-loads it at the start of every conversation
5. When Claude makes memories, they go to Notion rows, not to this directory
