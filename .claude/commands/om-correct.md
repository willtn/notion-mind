---
description: "Sweep a corrected fact through Notion — finds every page restating it, applies the correction at the single source, replaces restatements with links, and preserves pages that correctly record what was believed at the time."
---

# /om-correct

```
/om-correct "<the corrected fact, stated as it is now true>"
```

The acting half of Write-Correctness Law 2. Laws 1 and 2 already say a corrected fact must be swept out of every page restating it. This is the thing that does it.

Run it **at the moment of correction**, not on a schedule. `/om-vault-audit` is periodic, covers all of Notion, is structural, and takes no argument. A sweep needs the corrected fact as input, because nothing in Notion can resolve two contradicting pages. Nothing in it says which is true. Only the person making the correction knows, which is why the fact is an argument and not a discovery.

## Notion access

Read with `mcporter call notion.<tool> --args '<JSON>' --output json`. Use no pipe and no redirect. Put no single quote in the JSON. Read `notion-map.json` in the project root for the `data_source` URL and the view URLs of each database.

Write in two steps. First use the `Write` tool to make `.claude/state/outbox/<name>.json` with the JSON arguments. Then run `mcporter call notion.<tool> --args "$(cat .claude/state/outbox/<name>.json)"`.

## Hard rails

- **A historical page is never edited.** Not carefully, not with a callout. It is reported and preserved. See the asymmetry below.
- **Never delete.** Restatements are replaced with a link to the source, not removed.
- **Notion saves each edit at once.** Make one `update_content` call for each page, so the page history shows one version for each correction. Give the user the page URL of each edit, so the user can review it in the page history (`notion-get-version-changes`).
- **No authoritative page, no edits.** If the single source cannot be identified, the pass reports and stops rather than guessing.

## 1. Find

Both arms, always. Neither alone is sufficient.

- **Paraphrase**: run `notion-search` with each different way to say the fact. The Notion search matches keywords, not meaning, so YOU supply the paraphrases: the same claim in someone else's words, with none of the same strings. That half is invisible to a literal search and indistinguishable from correct prose to every structural check. It is the half most likely to survive a manual sweep, because the sweeper stops when the literal search goes quiet.
  `mcporter call notion.notion-search --args '{"query":"<keywords of the fact>","query_type":"internal","page_size":25}' --output json`
- **Literal**: search the distinctive strings from the fact: version numbers, tool names, counts, identifiers. This is the arm that finds a bare `v8.3.2` that means nothing to a reader of meaning.

Read each hit with `notion-fetch` before you classify it.

## 2. Classify

This is the design. The search is the easy part.

| class | what it is | what happens |
|---|---|---|
| **AUTHORITATIVE** | the single-source page Law 1 designates | the correction is **applied** here, and only here |
| **RESTATEMENT** | a living page asserting the fact, which per Law 1 should be linking to the source instead | the assertion is **replaced with a link** (a page mention). This fixes today's stain and prevents the next |
| **HISTORICAL** | a page that correctly records what was believed *at the time* | **preserved**, and reported so the omission is visible |

A page is historical if **any one** holds:

- its `Work.Type` is `1:1`, `Inbox item`, `Thinking`, or `Incident`
- its `Knowledge.Type` is `Event-log satellite` or `Archive note`
- its title carries a date, prefix **or** suffix. The 1:1 convention is `<Person> YYYY-MM-DD`
- its `Work.Status` is `archived`, `completed`, or `deprecated`

The `Date` property is deliberately **not** a signal. Every row has one.

**Ask before assuming a page is a restatement.** Keyword overlap is blind. A page that mentions the same subject while making a different claim is not restating anything, and rewriting it is a silent content loss.

## 3. Apply, in one pass

Report what changed and what was deliberately preserved. Name each page by its URL and quote the line:

```
/om-correct "the search tool exposes no keyword search"

  AUTHORITATIVE   <page URL> "Search"        ← correction applied here
  RESTATEMENT     <page URL> "Gotchas"       → replaced with link
  RESTATEMENT     <page URL> "Search Quality" → replaced with link
  HISTORICAL      <page URL> "Intake"        ✋ preserved: records what
                                                was believed 2026-03-02

  2 fixed, 1 applied, 1 preserved.
```

A correction callout on top of a page whose body still says the wrong thing is **not** a correction. Law 2 rules that out in as many words: the body is what future sessions absorb again.

To edit a page, use `notion-update-page` with `update_content`. The outbox file holds one search-and-replace for each passage:

```json
{"page_id":"<page URL>","command":"update_content","content_updates":[{"old_str":"<old passage>","new_str":"<new passage with a mention>"}]}
```

## Why historical pages are untouchable

The two failure modes are not symmetric, and the whole design follows from that.

A **missed restatement** leaves a stale claim somewhere. Someone reads it, notices, and fixes it. Recoverable, and visible.

A **rewritten record** destroys a true thing. The page said what was believed on a date. Afterwards it says something else, reads perfectly fine, and carries no trace that it ever said otherwise. Nothing detects it, and nothing recovers it.

Law 5 warns about this class directly: an attribution quarter differing from a creation date "is legitimate, not a bug to fix". A sweep enthusiastic about consistency is how that law gets violated at scale.

So when the classification is uncertain, the page is preserved and reported. Always.

## Delegation

For a sweep touching more than a handful of pages, invoke the `correction-sweep` agent so the many-page read runs in its own context window. This is the same pattern that `/om-vault-audit` uses for `vault-librarian`. The agent returns a classified plan. The edits happen here, after you have read it.

## Related

- `/om-vault-audit`: structural health, periodic, covers all of Notion. Complementary: it checks shape, this checks truth.
- `/om-tidy`: acts on hygiene flags. Also structural.
- `AGENTS.md` § Write-Correctness Laws: Laws 1, 2 and 5, which this implements.
