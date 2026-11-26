# Notion Calls (Claude Code)

Claude Code reaches Notion through `mcporter`, so each Notion call is a `Bash` command. The `PreToolUse` guard (`.claude/scripts/guard-notion-write.ts`) reads each command that names `mcporter` and Notion. It passes the command only in one of these forms, and it denies each other form with a reason.

## Write

1. Use the `Write` tool to make `.claude/state/outbox/<name>.json`. The file holds the JSON arguments of the call.
2. Run the call with the file as its arguments:

```sh
mcporter call notion.<tool> --args "$(cat .claude/state/outbox/<name>.json)"
```

- `notion-create-pages` needs `"allow_async": false`.
- After a write, the `PostToolUse` hook checks the note, sets the derived properties of the row, and deletes the outbox file.
- Do not set the derived properties `Changed`, `Bytes`, `Open tasks`, `Open loops`, `Has content`, and `Hook stamp`. The write hook sets them.
- Put the page title inside each mention: `<mention url="<page URL>">Title</mention>`.
- A select takes only an option that its database has. When a write fails for a new option, the `PostToolUseFailure` hook adds the option to the database. Run the same command again. The outbox file stays until a write succeeds.

## Read

```sh
mcporter call notion.<read tool> --args '<JSON object>' --output json
```

- Use no pipe, no redirect, and no here-document.
- Put no single quote in the JSON.
- Put `--args` before `--output`. Both are optional. The output formats are `json`, `text`, `markdown`, and `raw`.
- A read can also take its arguments from an outbox file, in the form of the write.

## Schema and login

```sh
mcporter list notion --schema --output json
mcporter auth notion
```

## Text that names both words

The guard denies each command that names both `mcporter` and `notion` in another form. A commit message or a pull request body that names both words is such a command. Write the text to a file first, then use one of these commands:

```sh
git commit -F <file>
gh pr create --body-file <file>
```

## The map file

`notion-map.json` in the project root holds each Notion ID that a call needs:

- the root page
- each database, with its `data_source` URL and the URL of each saved view
- each scaffold page, such as Home and North Star
- each template row

Read the IDs from that file. Do not copy an ID into a committed file, because `origin` can be public.
