🌐 [English](README.md) | **日本語** | [中文](README.zh-CN.md) | [한국어](README.ko.md)

<p align="center">
  <img src="obsidian-mind-logo.png" alt="Obsidian Mind" width="120">
</p>

<h1 align="center">Obsidian Mind</h1>

[![Claude Code](https://img.shields.io/badge/claude%20code-writes%20%2B%20hooks-D97706)](https://docs.anthropic.com/en/docs/claude-code)
[![Notion](https://img.shields.io/badge/notion-the%20only%20note%20store-000000)](https://www.notion.com)
[![mcporter](https://img.shields.io/badge/mcporter-notion%20mcp-4B5563)](https://github.com/openclaw/mcporter)
[![Node](https://img.shields.io/badge/node-22.6%2B-339933)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> **AI コーディングエージェントに永続的な記憶を与える Notion ワークスペース。** Claude Code は、すべての書き込みを検査するフックを通じて書き込みます。どのクライアントも Notion MCP を通じて読み取れます。セッションを始めて一日の出来事を話すだけで、ノート、リンク、ビュー、パフォーマンス記録はエージェントが処理します。会話のたびに知識が積み重なります。

このリポジトリは Obsidian ボールトのテンプレートとして始まりました。名前はそのままです。ノートは移動しました。現在、1 つの Notion ワークスペースが唯一のノートの保存先で、リポジトリにはフック、コマンド、サブエージェント、セットアップだけがあります。

---

## 🔴 課題

AI コーディングエージェントは強力ですが、忘れます。毎回のセッションはゼロから始まり、目標、チーム、パターン、成果の文脈がありません。同じことを何度も説明し、3 回前の会話で決めたことを失います。知識が積み重なりません。

## 🟢 解決策

エージェントに脳を与えましょう。

```
You: "start session"
Agent: *reads North Star, checks active projects, scans recent changes*
Agent: "You're working on Project Alpha, blocked on the BE contract.
        Last session you decided to split the coordinator. Your 1:1
        with your manager is tomorrow. The review brief is ready."
```

脳は Notion ワークスペースです。スマートフォン、Notion アプリ、または Notion MCP に対応した任意の AI クライアントから読めます。書き込むのはこのリポジトリの Claude Code セッションだけなので、保存されるすべてのノートが同じ検査を通ります。

---

## ⚡ 実際の動作

**朝のキックオフ:**

```bash
/om-standup
# → loads North Star, active projects, open tasks, rows changed in the last 48 hours
# → "You have 2 active projects. The auth refactor is blocked on API contract.
#    Your 1:1 with Sarah is at 2pm. Last time she flagged observability."
```

**ミーティング後のブレインダンプ:**

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

**インシデント対応:**

```bash
/om-incident-capture https://slack.com/archives/C0INCIDENT/p123456
# → slack-archaeologist reads every message, thread, and profile
# → people-profiler creates People rows for new people involved
# → Full timeline, root cause analysis, brag entry
```

**一日の終わり:**

```
You: "wrap up"
# → verifies that every new row has a link
# → brag-spotter finds uncaptured wins
# → suggests improvements
```

---

## 🚀 クイックスタート

### 📋 要件

- **Claude Code**: 書き込む唯一のクライアントです。mod には 2.1.287 以降が必要です。
- **Node.js 22.6 以降**: フックは `--experimental-strip-types` で TypeScript を実行します。ビルド手順も実行時の npm 依存もありません。
- **[mcporter](https://github.com/openclaw/mcporter)**: フックとエージェントはこれを通じて Notion に接続します。
- **Notion ワークスペース**: Notion MCP でログインできるもの。

### 📦 インストール

1. リポジトリをクローンします:

   ```bash
   git clone https://github.com/willtn/notion-mind.git obsidian-mind
   cd obsidian-mind
   ```

2. Notion MCP サーバーを `mcporter` に追加してログインします:

   ```bash
   mcporter config add notion https://mcp.notion.com/mcp
   mcporter auth notion
   ```

3. ワークスペースを構築します。セットアップはプライベートのルートページ「obsidian-mind」を作り、データベース、ビュー、ページ、テンプレートを作成して `notion-map.json` を書き出します:

   ```bash
   node --experimental-strip-types .claude/scripts/notion-setup.ts
   ```

   セットアップは各オブジェクトを名前で探し、足りないものだけを作ります。そのため 2 回目の実行では何も作りません。`--check` は何も作らず、マップファイルの各オブジェクトを取得します。

4. リポジトリで Claude Code を開き、信頼の確認を承認します。フックと mod は `.claude/` から読み込まれます。

5. North Star を記入し、人とコンピテンシーを追加して、`/om-standup` を実行します。

> [!NOTE]
> `notion-map.json` にはワークスペースの ID が入っています。このファイルは `.gitignore` にあります。`notion-map.example.json` はプレースホルダーでその形を示します。

---

## ⚙️ 仕組み

**手続き的なコードが環境を担当し、エージェントがコンテンツを担当します。** `.claude/scripts/` のフックは、分類、検証、派生プロパティ、ライフサイクルの注入を扱います。これらは決定的で、テストされています。ノートを書く、整理する、リンクする、ブリーフを下書きする、といった判断はエージェントに残ります。

**データベースは目的でまとめ、リンクは意味でまとめます。** ノートは 1 つのデータベースにありますが、多くのノートにリンクします。エージェントはこのグラフを維持し、リレーションプロパティで作業行を人、決定、コンピテンシーに結びます。評価の時期には、各コンピテンシーの `Evidence` リレーションがすでに証拠の記録になっています。リンクのないノートはバグです。

**ワークスペースファーストの記憶**は、セッションとマシンをまたいで文脈を保ちます。永続的な知識はすべて `Knowledge` の brain topic 行にあります。`~/.claude/` にある Claude Code の `MEMORY.md` は Notion ページを指す索引で、保存先ではありません。

**セッションには設計されたライフサイクルがあります。** `SessionStart` フックが North Star の目標、アクティブなプロジェクト、最近の変更、未完了のタスク、ワークスペースの一覧を注入するので、エージェントは毎回文脈を持って始めます。最後に「wrap up」と言うと、エージェントが `/om-wrap-up` を実行します。その間のすべては `AGENTS.md` が決めます。どこに保存するか、どうリンクするか、いつノートを分割するか、決定やインシデントをどう扱うか、です。

### 📖 読み取りの経路

どのクライアントも Notion MCP でワークスペースを読めます。Claude Code、Claude アプリ、その他の MCP クライアントです。読み取りにフックは不要です。リモートのクライアントはリポジトリのファイルを読めないので、セットアップはルートの下に「Reader map」ページも書き出します。このページは `notion-map.json` にある各データベース、ビュー、ページを一覧にします。

フックが有効な Claude Code セッションでは、読み取りは `Bash` コマンドです:

```bash
mcporter call notion.notion-search --args '{"query":"auth refactor","query_type":"internal"}' --output json
```

### ✍️ 書き込みの経路

書き込むのは、このリポジトリのフックを読み込んだ Claude Code セッションだけです。書き込みは 2 段階です:

1. エージェントが `Write` ツールで JSON 引数を `.claude/state/outbox/<name>.json` に書きます。
2. `mcporter call notion.<tool> --args "$(cat .claude/state/outbox/<name>.json)"` を実行します。

この呼び出しを 3 つのフックが見ます:

- **ガード** (`PreToolUse`) は、Notion コマンドを書き込み、読み取り、スキーマ、ログインの形式だけで通し、それ以外の形式は理由を付けて拒否します。フックは引数を読める書き込みしか検査できないので、ガードはすべての書き込みを読める形にします。ガードが実行できないときはコマンドが拒否されるので、ガードは安全側に失敗します。
- **書き込み検査** (`PostToolUse`) は outbox ファイルを読みます。空の必須プロパティ、リンクのないノート、ハードラップされた文章を警告します。25 KB を超えたノート (削るのではなく分割) とトピックのクラスターを指摘します。その後、行の派生プロパティ (`Bytes`、`Open tasks`、`Open loops`、`Has content`、`Changed`、`Hook stamp`) を設定し、outbox ファイルを削除します。
- **修復** (`PostToolUseFailure`) は、書き込みが失敗した後に足りない select の選択肢をデータベースに追加し、同じコマンドをもう一度実行するようエージェントに伝えます。

派生プロパティにより、ハイジーンスキャンはページごとの取得ではなくビューのクエリで実行できます。`Changed` はノートの経過時間です。プロパティを書くと Notion 自身の `Last edited` が動くので、経過時間のルールはそれを読みません。`Hook stamp` はフック経由の書き込みを示します。ビュー「Hygiene: edited outside hooks」は、後で他のクライアントが変更した行を一覧にし、`/om-vault-audit` がそれを読みます。

呼び出しの全形式は [`.claude/rules/notion-calls.md`](.claude/rules/notion-calls.md) にあります。

### 🔗 フック

| フック | タイミング | 内容 |
|------|------|------|
| 🚀 SessionStart | 起動、再開、`/clear`、コンパクション時 | ワークスペースを読み、North Star、brain topics、最近の変更、未完了のタスク、アクティブな作業、一覧、ハイジーンの指摘を、Claude Code のフック出力上限に収まるバイト予算内で注入します。最後にサイズメーターを出します |
| 💬 UserPromptSubmit | 毎メッセージ | 内容 (決定、インシデント、成果、1:1、アーキテクチャ、人物、プロジェクト更新) を分類し、正しいデータベースを示すルーティングヒントを注入します。前のターンの Stop レポートもエージェントに渡します |
| 🛡️ PreToolUse | 各 `Bash` コマンドの前 | ガード: 書き込み検査が読める形式の Notion コマンドだけを通します |
| ✍️ PostToolUse | Notion への書き込みの後、`Write` または `Edit` の後 | 書き込み検査と派生プロパティ。`Write` または `Edit` では、置き場所の誤ったメモリファイルを指摘します |
| 🩹 PostToolUseFailure | Notion への書き込みが失敗した後 | 足りない select の選択肢を追加し、同じコマンドの再実行を求めます |
| 💾 PreCompact | コンテキストのコンパクション前 | セッションのトランスクリプトを、ノートの保存先の外にある `.claude/state/session-logs/` にバックアップします |
| 🏁 Stop | 毎回の応答の後 | チェックリストと、保存済みハイジーンビューからの指摘を、セッションごとに 1 回、変化したときにだけ再表示します。あなたには短い要約が見え、エージェントは次のメッセージで完全なレポートを受け取ります |

> [!TIP]
> 話すだけで大丈夫です。ルーティングはフックが処理します。

### 🧩 Claude Code の mod

Claude Code 2.1.287 以降では、リポジトリは mod も提供します。`.claude/skills/obsidian-mind/` は、コードが Claude Code の中で動くプラグインです。同じフックスクリプトを実行し、出力がセッションに届く方法だけを変えます:

- **セッションの文脈は指示ファイルとして届きます**。`AGENTS.md` と同じ扱いです。コンパクションや `/clear` の後に Claude Code が全体を読み直し、汎用サブエージェントにも届き、10,000 文字のフック上限で切られません。予算は `vault-manifest.json` の `eager_layer_instruction_budget_bytes` です。`/memory` では `.claude/session-context.md` として表示されます。
- **Stop レポートは回答の下の 1 行になります。** 指摘が変わると、Claude の返答の下に mod の名前で始まる行が出ます: `obsidian-mind: vault check: …`。別のプラグインも Stop で応答すると、Claude Code は名前を `+` でつなぎます。Claude は次のメッセージで完全なレポートを、あなたには見えない形で受け取ります。緊急の指摘は、送ったメッセージごとに 1 回、すぐに Claude の注意を引きます。

mod は扱う各イベントについて、対応するフックに待機を指示します。mod が読み込まれない環境では、フックは従来どおり動きます。古い Claude Code、サブフォルダで始めたセッション (リポジトリのルートから起動するか、`/cd` で移動して `/clear`)、信頼していないフォルダです。

mod はあなたの権限で動くサンドボックスなしのコードなので、フォルダを信頼する前に内容を確認してください。`claude plugin validate .claude/skills/obsidian-mind` は、フックするすべてのイベントと、行うすべての呼び出しを一覧にします。無効にするには、`.claude/settings.local.json` に `"enabledPlugins": { "obsidian-mind@skills-dir": false }` を追加します。

<!-- mod-validate:start -->
このバージョンの mod について、出力で重要な 2 行:

```text
  ❯ ./register.ts hooks: classic.SessionStart, prompt.context, classic.Stop, turn.complete, prompt.submit, turn.start
  ❯ ./register.ts calls: $.fs.write, $.process.run (via runScript), $.prompt.submit, $.session.root, $.state.get, $.state.set, $.store.get (via setShown, shownFor), $.store.set (via setShown), $.ui.invalidate
```
<!-- mod-validate:end -->

### ⚡ トークン効率

obsidian-mind はワークスペースを丸ごとコンテキストに入れ**ません**:

| 階層 | 内容 | タイミング | コスト |
|------|------|------|------|
| **常時** | `AGENTS.md`、`.claude/rules/`、SessionStart の文脈 (North Star の抜粋、最近の変更、タスク、一覧) | セッション開始 | `vault-manifest.json` の予算で上限があり、10,000 文字のフック出力上限の内側です。メーターが毎回実際のサイズを報告します |
| **必要時** | `notion-search` の結果と、一致したページ | エージェントが特定の文脈を必要とするとき | 対象を絞る |
| **トリガー** | 分類のルーティングヒント | 毎メッセージ | 約 100 トークン |
| **トリガー** | 書き込み検査の指摘 | Notion への書き込みの後 | 約 200 トークン |

SessionStart はページ全体ではなく、タイトル、件数、短い抜粋を読み込みます。予算を超えると、最も安価なセクションがポインターになり、メーターが落としたものを 1 つずつ示します。行数のしきい値を超えた一覧のグループは、件数 1 行にたたまれます。

---

## 🗂️ ワークスペース

セットアップは、7 つのデータベースを持つプライベートのルートページ「obsidian-mind」を 1 つ作ります:

| データベース | 内容 |
|----------|-------|
| `Work` | 作業ノート、決定、インシデント、1:1 ノート、受信箱の項目、思考ノート。`Type` で区別します。`Status` がアクティブとアーカイブのフォルダを置き換え、`Project` が作業の流れをまとめます |
| `People` | 人ごとに 1 行。`Team` 付き |
| `Teams` | チームごとに 1 行。`Members` 付き |
| `Competencies` | コンピテンシーごとに 1 行。作業行からの `Evidence` と `Evidence count` ロールアップ付き |
| `Perf docs` | PR の証拠、評価ブリーフ、評価の成果物、四半期ごとの brag |
| `Knowledge` | brain topics (Key Decisions、Patterns、Gotchas)、リファレンスノート、ドメインノート、イベントログのサテライト、アーカイブノート |
| `Templates` | テンプレートごとに 1 行 |

ページ: **Home** (リンクされたビューと North Star の Current Focus を持つダッシュボード)、**North Star**、**People & Context**、**Recently Touched** (`Changed` で並べた各データベースのビュー)、**Reader map**。

**リレーションがウィキリンクを置き換えます。** ビュー、ロールアップ、ハイジーン検査がリンクを読む場所で使います: `Work.Decisions`、`Work.Competencies`、`Work.Person`、`Work.Team`、`Work.Feeds into`、`Perf docs.Work evidence`、`Parent`。それ以外のリンクは本文のページメンションです。

**保存済みビューが Bases と手作業の索引を置き換えます。** 例: Active Work、Stale Actives、Completed、Incidents、1:1 History、Competency Map、Review Evidence、Brain index。フックはハイジーンビュー (oversized、open loops、inbox pressure、loose active) をビューモードで読みます。ビューモードにはプランの上限がありません。

**テンプレート**は `Templates` の行です: Work Note、Decision Record、Thinking Note、Competency Note、Review Template。

---

## 📅 日常ワークフロー

**朝**: `/om-standup` を実行します。エージェントが North Star、アクティブなプロジェクト、未完了のタスク、最近の変更を読み込みます。構造化された要約と優先順位の提案が得られます。

**日中**: 自然に話します。下した決定、起きたインシデント、終えた 1:1、記録したい成果に触れてください。分類フックが、各情報を正しいデータベースに保存するようエージェントを促します。大きなブレインダンプには `/om-dump` を使い、すべてを一度に話します。

**一日の終わり**: 「wrap up」と言うと、エージェントが `/om-wrap-up` を呼び出します。行を確認し、リンクを検査し、記録されていない成果を見つけます。

**毎週**: `/om-weekly` でセッション横断の統合を行います。North Star との整合、パターン、記録されていない成果、来週の優先順位です。`/om-vault-audit` で、孤立した行、空のプロパティ、フックの外で編集された行を見つけます。

**評価の時期**: `/om-review-brief manager` を実行すると、証拠がすでにリンクされた評価準備ドキュメントが得られます。

---

## 🛠️ コマンド

`.claude/commands/` で定義されています。Claude Code で実行します。

| コマンド | 内容 |
|---------|-------------|
| `/om-standup` | 朝のキックオフ: 文脈を読み込み、昨日を振り返り、タスクを示し、優先順位を提案します |
| `/om-dump` | 自由形式の記録: 何でも自然に話すと、各情報を正しい行に振り分けます |
| `/om-wrap-up` | セッションの総括: 行、リンク、プロパティを確認し、改善を提案します |
| `/om-humanize` | 声に合わせた編集: Claude が下書きした文章をあなたが書いたように整えます |
| `/om-weekly` | 週次の統合: セッション横断のパターン、North Star との整合、記録されていない成果 |
| `/om-capture-1on1` | 1:1 の書き起こしを構造化された `Work` 行に記録します |
| `/om-incident-capture` | Slack のインシデントを構造化された行に記録します |
| `/om-slack-scan` | Slack のチャンネルと DM から証拠を深くスキャンします |
| `/om-peer-scan` | 評価準備のために同僚の GitHub PR を深くスキャンします |
| `/om-review-brief` | 評価ブリーフ (マネージャー版または同僚版) を生成します |
| `/om-self-review` | 評価期の自己評価を書きます: プロジェクト、コンピテンシー、原則 |
| `/om-review-peer` | 同僚評価を書きます: プロジェクト、原則、パフォーマンスの要約 |
| `/om-tidy` | 自己メンテナンス: すべてのハイジーン指摘に対応します。完了、グループ化、分割。削除はしません |
| `/om-correct` | 訂正された事実を一掃します: 単一の出典に適用し、言い換えをリンクにし、日付付きの記録は残します |
| `/om-vault-audit` | プロパティ、リンク、孤立、ビュー、フックの外で編集された行を監査します |
| `/om-prep-1on1` | 1:1 の準備: 人物の文脈、未解決の項目、議題の提案 |
| `/om-meeting` | トピック別の会議準備: 未解決の項目と検討事項を含むブリーフィング |
| `/om-intake` | 会議メモの受信箱を処理します: 受信箱の項目を分類し、正しい行に振り分けます |
| `/om-project-archive` | 完了したプロジェクトを完了にし、アクティブなビューから外します |

---

## 🤖 サブエージェント

独立したコンテキストウィンドウで動く専門エージェントです。重い処理を、メインの会話を埋めずに扱います。

| エージェント | 目的 | 呼び出し元 |
|-------|---------|------------|
| `brag-spotter` | 記録されていない成果とコンピテンシーのギャップを見つけます | `/om-wrap-up`、`/om-weekly` |
| `context-loader` | 人、プロジェクト、概念についての Notion の文脈をすべて読み込みます | 直接 |
| `correction-sweep` | 訂正された事実を言い直しているページをすべて見つけて分類します。編集はしません | `/om-correct` |
| `cross-linker` | 足りないリレーションとメンション、孤立、一方向のリンクを見つけます | `/om-vault-audit` |
| `people-profiler` | Slack のプロフィールから `People` 行をまとめて作成・更新します | `/om-incident-capture` |
| `review-prep` | 評価期間のパフォーマンスの証拠をすべて集めます | `/om-review-brief` |
| `slack-archaeologist` | Slack の完全な再構成: すべてのメッセージ、スレッド、プロフィール | `/om-incident-capture` |
| `vault-librarian` | ワークスペースの深いメンテナンス: 孤立、壊れたリンク、空のプロパティ、古い行 | `/om-vault-audit` |
| `review-fact-checker` | 評価の下書きのすべての主張を Notion の出典と照合します | `/om-self-review`、`/om-review-peer` |
| `vault-migrator` | `notion-import.ts` で Obsidian テンプレートの Markdown ボールトをインポートします。承認用のドライラン、インポート、ページを作らないはずの 2 回目の実行、各ページの検査を行います | 直接 |

> [!NOTE]
> サブエージェントは `.claude/agents/` で定義されています。分野ごとのワークフロー用に自分のものを追加できます。

---

## 📊 パフォーマンスグラフ

ワークスペースはパフォーマンス記録のシステムも兼ねます:

1. **`Competencies` の行**が組織のコンピテンシーの枠組みを定義します。コンピテンシーごとに 1 行です
2. **作業行**は `Competencies` リレーションを設定し、示したことを本文に書きます
3. **証拠は自動的に積み重なります**: 逆リレーション `Evidence` と `Evidence count` ロールアップが埋まり、Competency Map ビューがそれで並べます
4. **`Perf docs` の brag quarter** が四半期ごとの成果を `Work evidence` 付きで集めます
5. **`/om-peer-scan`** は同僚の GitHub PR を深くスキャンし、`Type` が PR evidence の `Perf docs` 行を書きます
6. **`/om-review-brief`** は brag quarter、決定、インシデント、コンピテンシーの証拠、1:1 のフィードバックから評価ブリーフを生成します

> [!TIP]
> 始め方: テンプレートからコンピテンシーの行を作り、作業行をそれにリンクしていきます。残りはグラフが行います。

---

## 🧪 Obsidian 版とのパリティ

コミット `fae7be4` は最後の Obsidian 版で、各フックの基準です。`.claude/scripts/parity/` のパリティハーネスは、そのコミットのフックを Markdown のフィクスチャボールトで、移植したフックを Notion の同じノートで実行し、指摘、ノート、件数を比較します:

```bash
cd .claude/scripts
node --experimental-strip-types parity/run-parity.ts                       # the reference against itself
node --experimental-strip-types parity/run-parity.ts --notion --hook validate-write
node --experimental-strip-types parity/run-mutations.ts --notion --hook validate-write
```

`--notion` にはフィクスチャ用の 2 つ目のルートが必要です。`notion-setup.ts --root-title "obsidian-mind parity fixtures" --map notion-map.fixtures.json` で作り、`parity/write-notion-fixture.ts` で埋めます。`npm test` は同じ比較を代替ランタイムでオフライン実行します。ライブのテストは `NOTION_LIVE=1` とマップファイルがあるときだけ実行され、それ以外はスキップされます。各検査と既知の差分の記録は [`NOTION-PORT-DESIGN.md`](NOTION-PORT-DESIGN.md) のパート (d) です。

---

## 📥 既存のボールトのインポート

`notion-import.ts` は、Obsidian テンプレートの Markdown ボールトをワークスペースに移します ([#14](https://github.com/willtn/notion-mind/pull/14))。インポートにはマップファイルが必要なので、先にセットアップを実行してください。次に、リポジトリのルートで以下のコマンドを実行します。

```bash
node --experimental-strip-types .claude/scripts/notion-import.ts --vault ../my-vault --dry-run
node --experimental-strip-types .claude/scripts/notion-import.ts --vault ../my-vault
node --experimental-strip-types .claude/scripts/notion-import.ts --vault ../my-vault --verify
```

ドライランは Notion を呼び出しません。各ノートの行き先、インポートが除外する各ファイル、形式が失われる各構文を出力します。インポートはボールトを読むだけで、変更しません。各ノートは、そのパスをプロパティ `Source path` に持つ行になります。そのため、2 回目の実行はページを作らず、変更されたノートだけを書き込みます。`--verify` は各ページを取得して計画と比較します。`vault-migrator` サブエージェントがこれらの手順を実行し、ドライランの後にあなたの承認を求めます。

---

## ⚠️ 既知の制限

以下の各制限は、リンク先のプルリクエストでの測定に基づきます。

- **ガードは協力的なエージェントを前提にします。** `notion` や `mcporter` という語を意図的に隠したコマンドや、呼び出しを持つスクリプトファイルはガードを通ります。そのような書き込みは `Hook stamp` の監査が後から指摘します。5 秒のタイムアウトを超えたガードは呼び出しを通します。([#6](https://github.com/willtn/notion-mind/pull/6))
- **`mcporter` と `notion` の両方を含むテキストは拒否されるコマンドです。** コミットメッセージや PR の本文はファイルに書き、`git commit -F` か `gh pr create --body-file` を使います。([#6](https://github.com/willtn/notion-mind/pull/6))
- **Notion はクライアントを区別できません。** 他の MCP クライアントからの書き込みは、フック経由の書き込みと同じに見えます。`Hook stamp` のビューだけがそれを示します。([#5](https://github.com/willtn/notion-mind/pull/5)、[#8](https://github.com/willtn/notion-mind/pull/8))
- **select は書き込み時に新しい選択肢を受け付けません。** `Quarter`、`Project`、`Cycle`、レベルの select は空で始まります。新しい選択肢を含む最初の書き込みは失敗し、修復フックがそれを追加し、エージェントがコマンドを再実行します。([#5](https://github.com/willtn/notion-mind/pull/5)、[#8](https://github.com/willtn/notion-mind/pull/8))
- **空のプロパティと存在しないプロパティは同じ状態です。** 欠けたフィールドの検査 (VW-08) は空のプロパティで発火します。([#8](https://github.com/willtn/notion-mind/pull/8))
- **ページメンションはタイトルとして数えます。** サイズとリンクの検査は、名前付きのメンションを `[[Title]]` として読みます。タイトルのないメンションは約 60 バイト増えます。リレーションはテキストを増やしません。([#8](https://github.com/willtn/notion-mind/pull/8))
- **書き込みフックは `Quarter` を設定しません。** 基準と同じく、`Quarter` の欠落は指摘のままです。([#8](https://github.com/willtn/notion-mind/pull/8))
- **リクエスト上限は 60 秒あたり 180 回です。** クライアントは待って再試行します。長い待ちでは行に `Hook stamp` が付かないことがあり、フックがそれを伝えます。([#8](https://github.com/willtn/notion-mind/pull/8))
- **Stop フックは毎ターン時間がかかります。** ハイジーンビューを並行して読み、タイムアウトは 15 秒です。データベースの外のページには `Bytes` がないので、サイズ検査はそれを指摘できません。([#11](https://github.com/willtn/notion-mind/pull/11))
- **最近の変更はコミットの件名ではなくページのタイトルです。** SessionStart は `Changed` を読むので、Home や North Star の変更はそのセクションに出ません。未完了のタスクのセクションは最大 10 行を取得します。([#12](https://github.com/willtn/notion-mind/pull/12))
- **完了したノートがアクティブなフォルダに残ることはありません。** 状態の置き場所は `Status` だけなので、そのハイジーン検査 (HY-01) には Notion の形がありません。設計記録のパート (f) の選択 2 を参照してください。
- **エイリアスとデイリーノートはありません。** コンテンツモデルにエイリアスのプロパティとデイリーノートの型がないので、`cross-linker`、`/om-standup`、`/om-weekly` からその手順がなくなりました。([#9](https://github.com/willtn/notion-mind/pull/9))
- **Notion は数式のテキストを返しません。** モデルの数式を変えた後は、`--reapply-formulas` を付けてセットアップを実行します。([#5](https://github.com/willtn/notion-mind/pull/5))
- **ルートの最初の作成で応答が失われると、そのレジャー行が残りません。** セットアップはそれでも収束します。([#5](https://github.com/willtn/notion-mind/pull/5))
- **トランスクリプトのバックアップはローカルに残ります**。場所は `.claude/state/session-logs/` です。([#10](https://github.com/willtn/notion-mind/pull/10))

---

## 📁 リポジトリの構成

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

## 🎨 カスタマイズ

これは出発点です。あなたの働き方に合わせてください:

| 対象 | 場所 |
|------|-------|
| 目標 | North Star ページ: すべてのセッションの土台です |
| 組織 | `People`、`Teams`、People & Context ページ |
| コンピテンシー | `Competencies`: 組織の枠組みに合わせます |
| ツール | `.claude/commands/`: GitHub の組織と Slack のワークスペースに合わせて編集します |
| 規約 | `AGENTS.md`: 運用マニュアル。使いながら育てます (Claude Code 向けの追加は `.claude/rules/`) |
| モデル | `.claude/scripts/lib/notion-model.ts`: データベース、プロパティ、ビュー。変更後はセットアップを再実行します |

> [!IMPORTANT]
> `AGENTS.md` は運用マニュアルです。規約を変えたら更新してください。エージェントは毎セッションそれを読みます。

---

## 🔄 更新

```bash
git pull
node --experimental-strip-types .claude/scripts/notion-setup.ts
```

pull でフック、コマンド、ルールが更新されます。セットアップは新しいバージョンのモデルに必要なものだけを追加し、それ以外は作りません。ノートは Notion に残り、変更されません。

---

## 🩺 トラブルシューティング

**Claude Code が規約を無視する。** Claude Code は `AGENTS.md` の代わりに `CLAUDE.md` を読み、`AGENTS.md` を黙って飛ばします。リポジトリのルートに `CLAUDE.md` があると、ハイジーンの指摘に `CLAUDE.md present beside AGENTS.md` と出ます。追加した内容を `.claude/rules/local.md` か `AGENTS.md` に移し、`CLAUDE.md` を削除してください。リポジトリより上のフォルダにある `CLAUDE.md` も同じ結果になり、この指摘では見えません。

**Notion コマンドが拒否される。** 理由を読んでください。許可された形式が示されます。多くの場合、読み取りにパイプやリダイレクトがあるか、コミットメッセージが `mcporter` と `notion` の両方を含んでいます。[`.claude/rules/notion-calls.md`](.claude/rules/notion-calls.md) を参照してください。

**セクションに `(not read: …)` と出る。** SessionStart か Stop がワークスペースのその部分を読めませんでした。`mcporter auth notion` を確認し、次に `node --experimental-strip-types .claude/scripts/notion-setup.ts --check` を実行してください。

**セットアップがワークスペースで止まる。** `--workspace-id` とマップファイルはどちらもワークスペースを指定します。ログインが別のワークスペースだと、セットアップは止まります。正しいワークスペースにログインするか、古い `notion-map.json` を移動してください。

---

## 🗺️ ロードマップ

**Issue とバグ報告を歓迎します。** コードの貢献は割り当て制です。Issue にコメントして担当を依頼し、割り当てられてから PR を開いてください。割り当てられていない Issue の PR はレビューなしで閉じられます。[CONTRIBUTING.md](CONTRIBUTING.md) を参照してください。

---

## 🙏 影響を受けた設計

- [kepano/obsidian-skills](https://github.com/kepano/obsidian-skills): Obsidian 版のエージェントスキル
- [James Bedford](https://x.com/jameesy): ボールト構造の考え方、AI が生成したコンテンツの分離
- [arscontexta](https://github.com/agenticnotetaking/arscontexta): description フィールドによる段階的な開示、セッションフック

---

## 👤 作者

**[Brenno Ferrari](https://brennoferrari.com)** が作成しました。ベルリンのシニア iOS エンジニアで、Claude Code で開発者ツールを作っています。

---

## 📄 ライセンス

MIT
