🌐 [English](README.md) | [日本語](README.ja.md) | **中文** | [한국어](README.ko.md)

<p align="center">
  <img src="obsidian-mind-logo.png" alt="Obsidian Mind" width="120">
</p>

<h1 align="center">Obsidian Mind</h1>

[![Claude Code](https://img.shields.io/badge/claude%20code-writes%20%2B%20hooks-D97706)](https://docs.anthropic.com/en/docs/claude-code)
[![Notion](https://img.shields.io/badge/notion-the%20only%20note%20store-000000)](https://www.notion.com)
[![mcporter](https://img.shields.io/badge/mcporter-notion%20mcp-4B5563)](https://github.com/openclaw/mcporter)
[![Node](https://img.shields.io/badge/node-22.6%2B-339933)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> **一个为 AI 编程智能体提供持久记忆的 Notion 工作区。** Claude Code 通过检查每次写入的钩子来写入。任何客户端都可以通过 Notion MCP 读取。开始一个会话，聊聊你的一天，智能体会处理其余的事：笔记、链接、视图、绩效记录。每次对话都建立在上一次之上。

这个仓库最初是一个 Obsidian vault 模板。名字保持不变。笔记已经迁移：现在一个 Notion 工作区是唯一的笔记存储，仓库只保存钩子、命令、子智能体和初始化脚本。

---

## 🔴 问题

AI 编程智能体很强大，但它们会遗忘。每个会话都从零开始：不知道你的目标、团队、模式和成果。你一次次重复解释同样的事，丢失三次对话之前做出的决定。知识无法积累。

## 🟢 解决方案

给你的智能体一个大脑。

```
You: "start session"
Agent: *reads North Star, checks active projects, scans recent changes*
Agent: "You're working on Project Alpha, blocked on the BE contract.
        Last session you decided to split the coordinator. Your 1:1
        with your manager is tomorrow. The review brief is ready."
```

大脑是一个 Notion 工作区。你可以在手机、Notion 应用，或任何支持 Notion MCP 的 AI 客户端中读取它。只有这个仓库中的 Claude Code 会话会写入，所以每条存入的笔记都经过同样的检查。

---

## ⚡ 实际效果

**早晨启动：**

```bash
/om-standup
# → loads North Star, active projects, open tasks, rows changed in the last 48 hours
# → "You have 2 active projects. The auth refactor is blocked on API contract.
#    Your 1:1 with Sarah is at 2pm. Last time she flagged observability."
```

**会后头脑倾倒：**

```bash
/om-dump Just had a 1:1 with Sarah. She's happy with the auth work but wants
us to add error monitoring before release. Also, Tom mentioned the cache
migration is deferred to Q2, and we decided to focus on the API contract first.
Decision: defer Redis migration. Win: Sarah praised the auth architecture.
```

```
→ Updated the People row "Sarah Chen" with meeting context
→ Created the Work row "Sarah 2026-03-26" (Type 1:1) with key takeaways
→ Created the Work row "Defer Redis migration to Q2" (Type Decision)
→ Added to the Q1 brag quarter in Perf docs: "Auth architecture praised by manager"
→ Updated the Work row "Auth Refactor" with an error monitoring task
```

**事故响应：**

```bash
/om-incident-capture https://slack.com/archives/C0INCIDENT/p123456
# → slack-archaeologist reads every message, thread, and profile
# → people-profiler creates People rows for new people involved
# → Full timeline, root cause analysis, brag entry
```

**一天结束：**

```
You: "wrap up"
# → verifies that every new row has a link
# → brag-spotter finds uncaptured wins
# → suggests improvements
```

---

## 🚀 快速开始

### 📋 环境要求

- **Claude Code**：唯一会写入的客户端。mod 需要 2.1.287 或更高版本。
- **Node.js 22.6 或更高版本**：钩子用 `--experimental-strip-types` 运行 TypeScript。没有构建步骤，运行时没有 npm 依赖。
- **[mcporter](https://github.com/openclaw/mcporter)**：钩子和智能体通过它连接 Notion。
- **一个 Notion 工作区**：可以通过 Notion MCP 登录。

### 📦 安装

1. 克隆仓库：

   ```bash
   git clone https://github.com/willtn/notion-mind.git obsidian-mind
   cd obsidian-mind
   ```

2. 把 Notion MCP 服务器加入 `mcporter` 并登录：

   ```bash
   mcporter config add notion https://mcp.notion.com/mcp
   mcporter auth notion
   ```

3. 构建工作区。初始化脚本会创建私有根页面「obsidian-mind」，建立数据库、视图、页面和模板，并写入 `notion-map.json`：

   ```bash
   node --experimental-strip-types .claude/scripts/notion-setup.ts
   ```

   初始化脚本按名称查找每个对象，只创建缺少的部分，所以第二次运行不会创建任何东西。`--check` 不创建任何东西，只获取映射文件中的每个对象。

4. 在仓库中打开 Claude Code 并接受信任提示。钩子和 mod 从 `.claude/` 加载。

5. 填写 North Star，添加你的同事和能力项，然后运行 `/om-standup`。

> [!NOTE]
> `notion-map.json` 保存你的工作区的 ID。它在 `.gitignore` 中。`notion-map.example.json` 用占位符展示它的结构。

---

## ⚙️ 工作原理

**过程式代码负责环境，智能体负责内容。** `.claude/scripts/` 中的钩子负责分类、校验、派生属性和生命周期注入。它们是确定性的，并且有测试。写笔记、归档、链接、起草简报属于判断，由智能体负责。

**数据库按用途分组，链接按含义分组。** 一条笔记位于一个数据库中，但链接到许多笔记。智能体维护这张图：用关系属性把工作行连到人、决策和能力项。到了绩效评估季，每个能力项的 `Evidence` 关系已经是证据链。没有链接的笔记就是 bug。

**工作区优先的记忆**让上下文跨越会话和机器。所有持久知识都在 `Knowledge` 的 brain topic 行中。`~/.claude/` 中 Claude Code 的 `MEMORY.md` 是指向 Notion 页面的索引，从不是存储本身。

**会话有设计好的生命周期。** `SessionStart` 钩子注入 North Star 目标、进行中的项目、最近的变更、未完成的任务和工作区清单，所以智能体每次都带着上下文开始。结束时说「wrap up」，智能体会运行 `/om-wrap-up`。中间的一切由 `AGENTS.md` 规定：放在哪里、如何链接、何时拆分笔记、如何处理决策和事故。

### 📖 读取路径

任何客户端都可以通过 Notion MCP 读取工作区：Claude Code、Claude 应用或其他 MCP 客户端。读取不需要钩子。远程客户端无法读取仓库文件，所以初始化脚本还会在根页面下写入「Reader map」页面。它列出 `notion-map.json` 中的每个数据库、视图和页面。

在启用了钩子的 Claude Code 会话中，读取是一条 `Bash` 命令：

```bash
mcporter call notion.notion-search --args '{"query":"auth refactor","query_type":"internal"}' --output json
```

### ✍️ 写入路径

只有加载了本仓库钩子的 Claude Code 会话会写入。写入分两步：

1. 智能体用 `Write` 工具把 JSON 参数写到 `.claude/state/outbox/<name>.json`。
2. 运行 `mcporter call notion.<tool> --args "$(cat .claude/state/outbox/<name>.json)"`。

三个钩子监视这次调用：

- **守卫**（`PreToolUse`）只放行写入、读取、schema 和登录形式的 Notion 命令，并带原因拒绝其他形式。钩子只能检查它能读到参数的写入，所以守卫让每次写入都可读。守卫无法运行时命令会被拒绝，所以守卫在失败时偏向安全。
- **写入检查**（`PostToolUse`）读取 outbox 文件。它对空的必填属性、没有链接的笔记和硬换行的正文发出警告。它标记超过 25 KB 的笔记（拆分，不要删减）和主题聚集。然后设置该行的派生属性（`Bytes`、`Open tasks`、`Open loops`、`Has content`、`Changed`、`Hook stamp`），并删除 outbox 文件。
- **修复**（`PostToolUseFailure`）在写入失败后把缺少的 select 选项加到数据库，并让智能体再次运行同一条命令。

派生属性让卫生扫描可以用视图查询完成，而不是逐页获取。`Changed` 是笔记的年龄：写属性会改变 Notion 自己的 `Last edited`，所以年龄规则不读取它。`Hook stamp` 标记经过钩子的写入。视图「Hygiene: edited outside hooks」列出之后被其他客户端修改的行，`/om-vault-audit` 会读取它。

完整的调用形式见 [`.claude/rules/notion-calls.md`](.claude/rules/notion-calls.md)。

### 🔗 钩子

| 钩子 | 时机 | 作用 |
|------|------|------|
| 🚀 SessionStart | 启动、恢复、`/clear` 和压缩时 | 读取工作区，并在适合 Claude Code 钩子输出上限的字节预算内注入 North Star、brain topics、最近变更、未完成任务、进行中的工作、清单和卫生发现。最后输出大小计 |
| 💬 UserPromptSubmit | 每条消息 | 对内容分类（决策、事故、成果、1:1、架构、人物、项目更新），注入指明正确数据库的路由提示。也把上一轮的 Stop 报告交给智能体 |
| 🛡️ PreToolUse | 每条 `Bash` 命令之前 | 守卫：只放行写入检查能读取的形式的 Notion 命令 |
| ✍️ PostToolUse | Notion 写入之后，以及 `Write` 或 `Edit` 之后 | 写入检查和派生属性。对 `Write` 或 `Edit`：标记放错位置的记忆文件 |
| 🩹 PostToolUseFailure | Notion 写入失败之后 | 添加缺少的 select 选项，然后要求再次运行同一条命令 |
| 💾 PreCompact | 上下文压缩之前 | 把会话记录备份到笔记存储之外的 `.claude/state/session-logs/` |
| 🏁 Stop | 每次回复之后 | 检查清单和来自已保存卫生视图的发现，每个会话显示一次，只在变化时再次显示。你看到简短摘要，智能体在你的下一条消息中收到完整报告 |

> [!TIP]
> 你只需要说话。路由由钩子处理。

### 🧩 Claude Code mod

在 Claude Code 2.1.287 或更高版本上，仓库还提供一个 mod：`.claude/skills/obsidian-mind/`，一个代码在 Claude Code 内部运行的插件。它运行同样的钩子脚本，只改变输出到达会话的方式：

- **会话上下文以指令文件的形式到达**，与 `AGENTS.md` 相同。压缩和 `/clear` 之后 Claude Code 会完整地重新读取它，它能到达通用子智能体，并且不受 10,000 字符钩子上限的截断。它的预算是 `vault-manifest.json` 中的 `eager_layer_instruction_budget_bytes`。`/memory` 将它列为 `.claude/session-context.md`。
- **Stop 报告变成回答下方的一行。** 发现变化时，你会在 Claude 的回复下方看到一行以 mod 名称开头的文字：`obsidian-mind: vault check: …`。其他插件也在 Stop 上应答时，Claude Code 用 `+` 连接名称。Claude 会在你的下一条消息中收到完整报告，你看不到。标记为紧急的发现会立即引起 Claude 的注意，你每发一条消息最多一次。

对它处理的每个事件，mod 会让对应的钩子待命。在 mod 不加载的地方，钩子照常运行：旧版 Claude Code、在子文件夹中启动的会话（从仓库根目录启动，或 `/cd` 到那里再 `/clear`），或你尚未信任的文件夹。

mod 是以你的权限运行、没有沙箱的代码，所以在信任文件夹之前先检查它做什么：`claude plugin validate .claude/skills/obsidian-mind` 会列出它挂接的每个事件和它进行的每个调用。要关闭它，在 `.claude/settings.local.json` 中加入 `"enabledPlugins": { "obsidian-mind@skills-dir": false }`。

<!-- mod-validate:start -->
对于这个版本的 mod，输出中重要的两行：

```text
  ❯ ./register.ts hooks: classic.SessionStart, prompt.context, classic.Stop, turn.complete, prompt.submit, turn.start
  ❯ ./register.ts calls: $.fs.write, $.process.run (via runScript), $.prompt.submit, $.session.root, $.state.get, $.state.set, $.store.get (via setShown, shownFor), $.store.set (via setShown), $.ui.invalidate
```
<!-- mod-validate:end -->

### ⚡ Token 效率

obsidian-mind **不会**把整个工作区塞进上下文：

| 层级 | 内容 | 时机 | 成本 |
|------|------|------|------|
| **始终** | `AGENTS.md`、`.claude/rules/` 和 SessionStart 上下文（North Star 摘录、最近变更、任务、清单） | 会话开始 | 受 `vault-manifest.json` 中预算的限制，低于 10,000 字符的钩子输出上限。大小计每次报告实际大小 |
| **按需** | `notion-search` 结果，然后是匹配的页面 | 智能体需要特定上下文时 | 有针对性 |
| **触发** | 分类路由提示 | 每条消息 | 约 100 token |
| **触发** | 写入检查的发现 | Notion 写入之后 | 约 200 token |

SessionStart 加载标题、计数和简短摘录，而不是完整页面。超过预算时，代价最低的部分会变成指针，大小计会逐一列出被丢弃的部分。清单中超过行数阈值的分组会折叠成一行计数。

---

## 🗂️ 工作区

初始化脚本创建一个带七个数据库的私有根页面「obsidian-mind」：

| 数据库 | 内容 |
|----------|-------|
| `Work` | 工作笔记、决策、事故、1:1 笔记、收件箱条目和思考笔记，用 `Type` 区分。`Status` 取代进行中和归档文件夹，`Project` 把一个工作流归为一组 |
| `People` | 每人一行，带 `Team` |
| `Teams` | 每个团队一行，带 `Members` |
| `Competencies` | 每个能力项一行，带来自工作行的 `Evidence` 和 `Evidence count` 汇总 |
| `Perf docs` | PR 证据、评估简报、评估产物和季度 brag |
| `Knowledge` | brain topics（Key Decisions、Patterns、Gotchas）、参考笔记、领域笔记、事件日志卫星和归档笔记 |
| `Templates` | 每个模板一行 |

还有这些页面：**Home**（仪表盘，带链接视图和 North Star 的 Current Focus）、**North Star**、**People & Context**、**Recently Touched**（按 `Changed` 排序的各数据库视图）和 **Reader map**。

**关系取代 wikilink**，用在视图、汇总或卫生检查会读取链接的地方：`Work.Decisions`、`Work.Competencies`、`Work.Person`、`Work.Team`、`Work.Feeds into`、`Perf docs.Work evidence` 和 `Parent`。其他链接都是正文中的页面提及。

**已保存的视图取代 Bases 和手工维护的索引。** 例如：Active Work、Stale Actives、Completed、Incidents、1:1 History、Competency Map、Review Evidence、Brain index。钩子以视图模式读取卫生视图（oversized、open loops、inbox pressure、loose active），视图模式没有套餐配额。

**模板**是 `Templates` 中的行：Work Note、Decision Record、Thinking Note、Competency Note 和 Review Template。

---

## 📅 日常工作流

**早晨**：运行 `/om-standup`。智能体加载 North Star、进行中的项目、未完成的任务和最近的变更。你会得到结构化的摘要和优先级建议。

**白天**：自然地说话。提到你做出的决定、发生的事故、刚开完的 1:1、想记住的成果。分类钩子会引导智能体把每条信息存入正确的数据库。较大的头脑倾倒用 `/om-dump`，一次说完。

**一天结束**：说「wrap up」，智能体会调用 `/om-wrap-up`。它核对行、检查链接、发现未记录的成果。

**每周**：运行 `/om-weekly` 做跨会话综合：North Star 对齐、模式、未记录的成果和下周优先级。运行 `/om-vault-audit` 找出孤立的行、空属性和在钩子之外编辑的行。

**评估季**：运行 `/om-review-brief manager`，得到一份证据已链接好的评估准备文档。

---

## 🛠️ 命令

定义在 `.claude/commands/` 中。在 Claude Code 中运行。

| 命令 | 作用 |
|---------|-------------|
| `/om-standup` | 早晨启动：加载上下文、回顾昨天、列出任务、建议优先级 |
| `/om-dump` | 自由记录：随意说任何事，它把每条信息分到正确的行 |
| `/om-wrap-up` | 完整的会话回顾：核对行、链接和属性，并提出改进建议 |
| `/om-humanize` | 按你的语气编辑：让 Claude 起草的文字听起来像你写的 |
| `/om-weekly` | 每周综合：跨会话模式、North Star 对齐、未记录的成果 |
| `/om-capture-1on1` | 把 1:1 会议记录存为结构化的 `Work` 行 |
| `/om-incident-capture` | 把 Slack 中的事故记录为结构化的行 |
| `/om-slack-scan` | 深度扫描 Slack 频道和私信以收集证据 |
| `/om-peer-scan` | 为评估准备深度扫描同事的 GitHub PR |
| `/om-review-brief` | 生成评估简报（经理版或同事版） |
| `/om-self-review` | 写评估季的自我评估：项目、能力项、原则 |
| `/om-review-peer` | 写同事评估：项目、原则、绩效总结 |
| `/om-tidy` | 自我维护：处理每个卫生标记。完成、分组、拆分。从不删除 |
| `/om-correct` | 清扫一条被更正的事实：在唯一来源处应用，把复述改为链接，保留带日期的记录 |
| `/om-vault-audit` | 审计属性、链接、孤立行、视图和在钩子之外编辑的行 |
| `/om-prep-1on1` | 准备即将到来的 1:1：人物上下文、未结事项、议程建议 |
| `/om-meeting` | 按主题准备任意会议：包含未结事项和考虑事项的简报 |
| `/om-intake` | 处理会议笔记收件箱：对收件箱条目分类并分到正确的行 |
| `/om-project-archive` | 把已完成的项目标记为完成，使它离开进行中的视图 |

---

## 🤖 子智能体

在独立上下文窗口中运行的专用智能体。它们处理繁重的操作，而不会塞满你的主对话。

| 智能体 | 用途 | 调用方 |
|-------|---------|------------|
| `brag-spotter` | 找出未记录的成果和能力差距 | `/om-wrap-up`、`/om-weekly` |
| `context-loader` | 加载关于某个人、项目或概念的全部 Notion 上下文 | 直接 |
| `correction-sweep` | 找出复述被更正事实的每个页面并分类。从不编辑 | `/om-correct` |
| `cross-linker` | 找出缺失的关系和提及、孤立行和单向链接 | `/om-vault-audit` |
| `people-profiler` | 根据 Slack 资料批量创建或更新 `People` 行 | `/om-incident-capture` |
| `review-prep` | 汇总评估周期内的全部绩效证据 | `/om-review-brief` |
| `slack-archaeologist` | 完整重建 Slack：每条消息、线程和资料 | `/om-incident-capture` |
| `vault-librarian` | 深度维护工作区：孤立行、失效链接、空属性、陈旧的行 | `/om-vault-audit` |
| `review-fact-checker` | 用 Notion 来源核对评估草稿中的每个说法 | `/om-self-review`、`/om-review-peer` |
| `vault-migrator` | 用 `notion-import.ts` 导入 Obsidian 模板的 Markdown vault：供你批准的试运行、导入、不应创建页面的第二次运行，以及对每个页面的检查 | 直接 |

> [!NOTE]
> 子智能体定义在 `.claude/agents/` 中。你可以为特定领域的工作流添加自己的子智能体。

---

## 📊 绩效图谱

工作区也是一个绩效记录系统：

1. **`Competencies` 行**定义组织的能力框架，每个能力项一行
2. **工作行**设置 `Competencies` 关系，并在正文写下展示了什么
3. **证据自动积累**：反向关系 `Evidence` 和 `Evidence count` 汇总会随之填充，Competency Map 视图按它们排序
4. **`Perf docs` 中的季度 brag** 收集每季度的成果，并设置 `Work evidence`
5. **`/om-peer-scan`** 深度扫描同事的 GitHub PR，并写入一条 `Type` 为 PR evidence 的 `Perf docs` 行
6. **`/om-review-brief`** 根据季度 brag、决策、事故、能力证据和 1:1 反馈生成完整的评估简报

> [!TIP]
> 入门方法：用模板创建能力项行，然后在工作中把工作行链接到它们。其余的交给图谱。

---

## 🧪 与 Obsidian 版本的一致性

提交 `fae7be4` 是最后一个 Obsidian 版本，也是每个钩子的基准。`.claude/scripts/parity/` 中的一致性测试框架在 Markdown 测试 vault 上运行该提交的钩子，在 Notion 中相同的笔记上运行移植后的钩子，然后比较发现、笔记和计数：

```bash
cd .claude/scripts
node --experimental-strip-types parity/run-parity.ts                       # the reference against itself
node --experimental-strip-types parity/run-parity.ts --notion --hook validate-write
node --experimental-strip-types parity/run-mutations.ts --notion --hook validate-write
```

`--notion` 需要第二个用于测试数据的根页面，用 `notion-setup.ts --root-title "obsidian-mind parity fixtures" --map notion-map.fixtures.json` 创建，并用 `parity/write-notion-fixture.ts` 填充。`npm test` 会在替身运行时上离线执行同样的比较。在线测试只在设置了 `NOTION_LIVE=1` 并有映射文件时运行，其他情况下跳过。每项检查和每个已知差异的记录见 [`NOTION-PORT-DESIGN.md`](NOTION-PORT-DESIGN.md) 的 (d) 部分。

---

## 📥 导入现有 vault

`notion-import.ts` 把 Obsidian 模板的 Markdown vault 迁移到工作区（[#14](https://github.com/willtn/notion-mind/pull/14)）。导入需要映射文件，所以请先运行设置。然后在仓库根目录运行以下命令：

```bash
node --experimental-strip-types .claude/scripts/notion-import.ts --vault ../my-vault --dry-run
node --experimental-strip-types .claude/scripts/notion-import.ts --vault ../my-vault
node --experimental-strip-types .claude/scripts/notion-import.ts --vault ../my-vault --verify
```

试运行不调用 Notion。它输出每条笔记的位置、导入排除的每个文件，以及会丢失格式的每种结构。导入只读取 vault，从不修改它。每条笔记成为一行，其路径保存在属性 `Source path` 中。因此第二次运行不创建页面，只写入有变更的笔记。`--verify` 获取每个页面并与计划比较。`vault-migrator` 子代理执行这些步骤，并在试运行之后请求你的批准。

---

## ⚠️ 已知限制

下面每条限制都来自所链接的拉取请求中的测量。

- **守卫假定智能体是配合的。** 故意隐藏 `notion` 或 `mcporter` 字样的命令，或包含调用的脚本文件，可以通过守卫。`Hook stamp` 审计会在事后标记这类写入。运行超过 5 秒超时的守卫会让调用继续执行。（[#6](https://github.com/willtn/notion-mind/pull/6)）
- **同时包含 `mcporter` 和 `notion` 的文本是会被拒绝的命令。** 把提交信息或 PR 正文写到文件中，再用 `git commit -F` 或 `gh pr create --body-file`。（[#6](https://github.com/willtn/notion-mind/pull/6)）
- **Notion 无法区分客户端。** 来自其他 MCP 客户端的写入看起来和经过钩子的写入一样，只有 `Hook stamp` 视图能显示它。（[#5](https://github.com/willtn/notion-mind/pull/5)、[#8](https://github.com/willtn/notion-mind/pull/8)）
- **select 在写入时不接受新选项。** `Quarter`、`Project`、`Cycle` 和级别 select 开始时是空的。第一次带新选项的写入会失败，修复钩子添加该选项，智能体再次运行命令。（[#5](https://github.com/willtn/notion-mind/pull/5)、[#8](https://github.com/willtn/notion-mind/pull/8)）
- **空属性和不存在的属性是同一种状态。** 缺失字段检查（VW-08）在属性为空时触发。（[#8](https://github.com/willtn/notion-mind/pull/8)）
- **页面提及按标题计算。** 大小和链接检查把带名称的提及读作 `[[Title]]`。没有标题的提及会多出约 60 字节。关系不增加文本。（[#8](https://github.com/willtn/notion-mind/pull/8)）
- **写入钩子不设置 `Quarter`。** 与基准一样，缺少 `Quarter` 仍然是一项发现。（[#8](https://github.com/willtn/notion-mind/pull/8)）
- **请求上限是每 60 秒 180 次。** 客户端会等待并重试。长时间等待可能让某行没有 `Hook stamp`，钩子会说明这一点。（[#8](https://github.com/willtn/notion-mind/pull/8)）
- **Stop 钩子每轮都会花时间。** 它并行读取卫生视图，超时为 15 秒。数据库之外的页面没有 `Bytes`，所以大小检查无法标记它。（[#11](https://github.com/willtn/notion-mind/pull/11)）
- **最近变更是页面标题，而不是提交标题。** SessionStart 读取 `Changed`，所以 Home 或 North Star 的变更不会出现在该部分。未完成任务部分最多获取 10 行。（[#12](https://github.com/willtn/notion-mind/pull/12)）
- **已完成的笔记不会留在进行中的文件夹。** `Status` 是状态的唯一位置，所以该卫生检查（HY-01）没有 Notion 形式。见设计记录 (f) 部分的选择 2。
- **没有别名，也没有每日笔记。** 内容模型没有别名属性和每日笔记类型，所以 `cross-linker`、`/om-standup` 和 `/om-weekly` 去掉了这些步骤。（[#9](https://github.com/willtn/notion-mind/pull/9)）
- **Notion 不返回公式文本。** 修改模型中的公式后，用 `--reapply-formulas` 运行初始化脚本。（[#5](https://github.com/willtn/notion-mind/pull/5)）
- **首次创建根页面时如果回复丢失，就不会留下它的台账行。** 初始化脚本仍然会收敛。（[#5](https://github.com/willtn/notion-mind/pull/5)）
- **会话记录备份保留在本地**，位于 `.claude/state/session-logs/`。（[#10](https://github.com/willtn/notion-mind/pull/10)）

---

## 📁 仓库结构

```
obsidian-mind/
├── AGENTS.md                      # The operating manual, read every session
├── vault-manifest.json            # Root marker of the hooks, and hook settings
├── notion-map.example.json        # Shape of notion-map.json (the real one is not committed)
├── NOTION-PORT-DESIGN.md          # The design record of the Notion port
├── brain/Skills.md                # The command catalog
└── .claude/
    ├── commands/                  # Slash commands
    ├── agents/                    # Subagents
    ├── rules/                     # Rules that Claude Code loads beside AGENTS.md
    ├── skills/                    # defuddle, mermaid-visualizer, and the obsidian-mind mod
    ├── settings.json              # Hook configuration
    └── scripts/
        ├── session-start.ts, classify-message.ts, guard-notion-write.ts,
        │   validate-write.ts, pre-compact.ts, stop-checklist.ts   # The hooks
        ├── notion-setup.ts        # Builds the workspace and writes notion-map.json
        ├── notion-import.ts       # Moves a Markdown vault of the Obsidian template into the workspace
        ├── scaffold/              # Source text of the scaffold pages and the templates
        ├── lib/                   # The Notion client, the model, the checks
        ├── parity/                # The parity harness
        └── tests/                 # npm test
```

---

## 🎨 自定义

这只是一个起点。按你的工作方式调整：

| 内容 | 位置 |
|------|-------|
| 你的目标 | North Star 页面：每个会话的基础 |
| 你的组织 | `People`、`Teams` 和 People & Context 页面 |
| 你的能力项 | `Competencies`：与你所在组织的框架对齐 |
| 你的工具 | `.claude/commands/`：按你的 GitHub 组织和 Slack 工作区编辑 |
| 你的约定 | `AGENTS.md`：操作手册，边用边完善（Claude Code 专用的补充放在 `.claude/rules/`） |
| 你的模型 | `.claude/scripts/lib/notion-model.ts`：数据库、属性、视图。修改后重新运行初始化脚本 |

> [!IMPORTANT]
> `AGENTS.md` 是操作手册。修改约定时请更新它。智能体每个会话都会读取它。

---

## 🔄 更新

```bash
git pull
node --experimental-strip-types .claude/scripts/notion-setup.ts
```

pull 会更新钩子、命令和规则。初始化脚本只添加新版模型需要的部分，不创建其他东西。你的笔记留在 Notion 中，不会被改动。

---

## 🩺 故障排除

**Claude Code 忽略了约定。** Claude Code 会读取 `CLAUDE.md` 来代替 `AGENTS.md`，并且不声不响地跳过 `AGENTS.md`。仓库根目录有 `CLAUDE.md` 时，卫生标记会显示 `CLAUDE.md present beside AGENTS.md`。把你添加的内容移到 `.claude/rules/local.md` 或 `AGENTS.md`，然后删除 `CLAUDE.md`。仓库上层文件夹中的 `CLAUDE.md` 有同样的效果，而这个标记看不到它。

**Notion 命令被拒绝。** 阅读原因，它会列出允许的形式。最常见的是读取命令里有管道或重定向，或提交信息同时包含 `mcporter` 和 `notion`。见 [`.claude/rules/notion-calls.md`](.claude/rules/notion-calls.md)。

**某个部分显示 `(not read: …)`。** SessionStart 或 Stop 无法读取工作区的那一部分。检查 `mcporter auth notion`，然后运行 `node --experimental-strip-types .claude/scripts/notion-setup.ts --check`。

**初始化脚本因工作区而停止。** `--workspace-id` 和映射文件都会指定一个工作区。登录的是另一个工作区时，初始化脚本会停止。登录正确的工作区，或把旧的 `notion-map.json` 移走。

---

## 🗺️ 路线图

**欢迎提交 issue 和 bug 报告。** 代码贡献采用指派制：在 issue 下评论申请，被指派后再开 PR。针对未指派给你的 issue 的 PR 会不经审查直接关闭。见 [CONTRIBUTING.md](CONTRIBUTING.md)。

---

## 🙏 设计灵感

- [kepano/obsidian-skills](https://github.com/kepano/obsidian-skills)：Obsidian 版本的智能体技能
- [James Bedford](https://x.com/jameesy)：vault 结构理念，分离 AI 生成的内容
- [arscontexta](https://github.com/agenticnotetaking/arscontexta)：通过 description 字段实现渐进式披露，会话钩子

---

## 👤 作者

由 **[Brenno Ferrari](https://brennoferrari.com)** 创建，柏林的高级 iOS 工程师，用 Claude Code 构建开发者工具。

---

## 📄 许可证

MIT
