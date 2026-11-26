# Skills and Commands (Claude Code)

## Skills

`.claude/skills/` holds these skills. Load a skill with the Skill tool when its task comes up:

- **defuddle**: extract clean Markdown from a web page with `defuddle parse <url> --md`.
- **mermaid-visualizer**: make Mermaid diagrams from text. Notion renders a `mermaid` code block as a diagram.

The same folder holds the `obsidian-mind` mod, which Claude Code 2.1.287 or later loads as a plugin (see `.claude/rules/hooks-and-mod.md`).

## Commands

Defined in `.claude/commands/`. Claude Code auto-surfaces every command with its description in the skills list of the session. **That injected list is the live catalog.** Do not keep a command table here. A table drifts, and the injected list cannot (Write-Correctness law 6). For a reader with no injected list, `brain/Skills.md` in the repository carries the full catalog, the usage notes, and the workflow sequences.

## Where they live

| Folder | Purpose | Key Files |
|--------|---------|-----------|
| `.claude/commands/` | Slash commands (auto-surfaced in the session, catalog in `brain/Skills.md`) | One `.md` per command |
| `.claude/skills/` | Skills, and the `obsidian-mind` Claude Code mod | Skills load through the Skill tool. The mod loads as a plugin on Claude Code 2.1.287 or later |
