🌐 [English](README.md) | [日本語](README.ja.md) | [中文](README.zh-CN.md) | **한국어**

<p align="center">
  <img src="obsidian-mind-logo.png" alt="Obsidian Mind" width="120">
</p>

<h1 align="center">Obsidian Mind</h1>

[![Claude Code](https://img.shields.io/badge/claude%20code-writes%20%2B%20hooks-D97706)](https://docs.anthropic.com/en/docs/claude-code)
[![Notion](https://img.shields.io/badge/notion-the%20only%20note%20store-000000)](https://www.notion.com)
[![mcporter](https://img.shields.io/badge/mcporter-notion%20mcp-4B5563)](https://github.com/openclaw/mcporter)
[![Node](https://img.shields.io/badge/node-22.6%2B-339933)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> **AI 코딩 에이전트에게 지속적인 기억을 주는 Notion 워크스페이스.** Claude Code는 모든 쓰기를 검사하는 훅을 통해 씁니다. 어떤 클라이언트든 Notion MCP로 읽습니다. 세션을 시작하고 하루 일을 이야기하면 노트, 링크, 뷰, 성과 기록은 에이전트가 처리합니다. 대화할수록 지식이 쌓입니다.

이 저장소는 Obsidian 볼트 템플릿으로 시작했습니다. 이름은 그대로입니다. 노트는 옮겨졌습니다. 이제 하나의 Notion 워크스페이스가 유일한 노트 저장소이고, 저장소에는 훅, 명령, 서브에이전트, 설정만 있습니다.

---

## 🔴 문제

AI 코딩 에이전트는 강력하지만 잊어버립니다. 매 세션이 0에서 시작합니다. 목표, 팀, 패턴, 성과에 대한 맥락이 없습니다. 같은 설명을 반복하고, 세 번 전 대화에서 내린 결정을 잃습니다. 지식이 쌓이지 않습니다.

## 🟢 해결책

에이전트에게 두뇌를 주세요.

```
You: "start session"
Agent: *reads North Star, checks active projects, scans recent changes*
Agent: "You're working on Project Alpha, blocked on the BE contract.
        Last session you decided to split the coordinator. Your 1:1
        with your manager is tomorrow. The review brief is ready."
```

두뇌는 Notion 워크스페이스입니다. 휴대폰, Notion 앱, 또는 Notion MCP를 지원하는 어떤 AI 클라이언트에서도 읽을 수 있습니다. 쓰는 것은 이 저장소의 Claude Code 세션뿐이므로, 저장되는 모든 노트가 같은 검사를 거칩니다.

---

## ⚡ 실제 동작 예시

**아침 킥오프:**

```bash
/om-standup
# → loads North Star, active projects, open tasks, rows changed in the last 48 hours
# → "You have 2 active projects. The auth refactor is blocked on API contract.
#    Your 1:1 with Sarah is at 2pm. Last time she flagged observability."
```

**회의 후 브레인 덤프:**

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

**인시던트 대응:**

```bash
/om-incident-capture https://slack.com/archives/C0INCIDENT/p123456
# → slack-archaeologist reads every message, thread, and profile
# → people-profiler creates People rows for new people involved
# → Full timeline, root cause analysis, brag entry
```

**하루의 끝:**

```
You: "wrap up"
# → verifies that every new row has a link
# → brag-spotter finds uncaptured wins
# → suggests improvements
```

---

## 🚀 빠른 시작

### 📋 요구 사항

- **Claude Code**: 쓰기를 하는 유일한 클라이언트입니다. mod에는 2.1.287 이상이 필요합니다.
- **Node.js 22.6 이상**: 훅은 `--experimental-strip-types`로 TypeScript를 실행합니다. 빌드 단계도, 실행 시 npm 의존성도 없습니다.
- **[mcporter](https://github.com/openclaw/mcporter)**: 훅과 에이전트는 이것을 통해 Notion에 연결합니다.
- **Notion 워크스페이스**: Notion MCP로 로그인할 수 있는 것.

### 📦 설치

1. 저장소를 클론합니다:

   ```bash
   git clone https://github.com/willtn/notion-mind.git obsidian-mind
   cd obsidian-mind
   ```

2. Notion MCP 서버를 `mcporter`에 추가하고 로그인합니다:

   ```bash
   mcporter config add notion https://mcp.notion.com/mcp
   mcporter auth notion
   ```

3. 워크스페이스를 만듭니다. 설정은 비공개 루트 페이지 "obsidian-mind"를 만들고, 데이터베이스, 뷰, 페이지, 템플릿을 만든 뒤 `notion-map.json`을 씁니다:

   ```bash
   node --experimental-strip-types .claude/scripts/notion-setup.ts
   ```

   설정은 각 객체를 이름으로 찾고 없는 것만 만듭니다. 그래서 두 번째 실행은 아무것도 만들지 않습니다. `--check`는 아무것도 만들지 않고 맵 파일의 각 객체를 가져옵니다.

4. 저장소에서 Claude Code를 열고 신뢰 확인을 수락합니다. 훅과 mod는 `.claude/`에서 로드됩니다.

5. North Star를 채우고, 사람과 역량을 추가한 뒤 `/om-standup`을 실행합니다.

> [!NOTE]
> `notion-map.json`에는 워크스페이스의 ID가 들어 있습니다. 이 파일은 `.gitignore`에 있습니다. `notion-map.example.json`은 자리표시자로 그 형태를 보여 줍니다.

---

## ⚙️ 작동 원리

**절차적 코드가 환경을 맡고, 에이전트가 콘텐츠를 맡습니다.** `.claude/scripts/`의 훅은 분류, 검증, 파생 속성, 라이프사이클 주입을 처리합니다. 결정적이고 테스트되어 있습니다. 노트를 쓰고, 정리하고, 연결하고, 브리프를 작성하는 판단은 에이전트에게 남습니다.

**데이터베이스는 목적으로 묶고, 링크는 의미로 묶습니다.** 노트는 하나의 데이터베이스에 있지만 여러 노트에 연결됩니다. 에이전트는 이 그래프를 유지하며, 관계 속성으로 작업 행을 사람, 결정, 역량에 연결합니다. 평가 시즌이 오면 각 역량의 `Evidence` 관계가 이미 증거 기록입니다. 링크 없는 노트는 버그입니다.

**워크스페이스 우선 기억**은 세션과 기기를 넘어 맥락을 유지합니다. 지속적인 지식은 모두 `Knowledge`의 brain topic 행에 있습니다. `~/.claude/`의 Claude Code `MEMORY.md`는 Notion 페이지를 가리키는 색인이며, 저장소가 아닙니다.

**세션에는 설계된 라이프사이클이 있습니다.** `SessionStart` 훅이 North Star 목표, 활성 프로젝트, 최근 변경, 미완료 작업, 워크스페이스 목록을 주입하므로, 에이전트는 매번 맥락을 갖고 시작합니다. 마지막에 "wrap up"이라고 말하면 에이전트가 `/om-wrap-up`을 실행합니다. 그 사이의 모든 것은 `AGENTS.md`가 정합니다. 어디에 저장할지, 어떻게 연결할지, 언제 노트를 나눌지, 결정과 인시던트를 어떻게 다룰지입니다.

### 📖 읽기 경로

어떤 클라이언트든 Notion MCP로 워크스페이스를 읽습니다. Claude Code, Claude 앱, 다른 MCP 클라이언트입니다. 읽기에는 훅이 필요 없습니다. 원격 클라이언트는 저장소 파일을 읽을 수 없으므로, 설정은 루트 아래에 "Reader map" 페이지도 씁니다. 이 페이지는 `notion-map.json`에 있는 각 데이터베이스, 뷰, 페이지를 나열합니다.

훅이 켜진 Claude Code 세션에서 읽기는 `Bash` 명령입니다:

```bash
mcporter call notion.notion-search --args '{"query":"auth refactor","query_type":"internal"}' --output json
```

### ✍️ 쓰기 경로

쓰기는 이 저장소의 훅을 로드한 Claude Code 세션만 합니다. 쓰기는 두 단계입니다:

1. 에이전트가 `Write` 도구로 JSON 인수를 `.claude/state/outbox/<name>.json`에 씁니다.
2. `mcporter call notion.<tool> --args "$(cat .claude/state/outbox/<name>.json)"`을 실행합니다.

세 개의 훅이 이 호출을 봅니다:

- **가드** (`PreToolUse`)는 Notion 명령을 쓰기, 읽기, 스키마, 로그인 형식으로만 통과시키고, 다른 형식은 이유와 함께 거부합니다. 훅은 인수를 읽을 수 있는 쓰기만 검사할 수 있으므로, 가드는 모든 쓰기를 읽을 수 있게 만듭니다. 가드가 실행되지 못하면 명령이 거부되므로, 가드는 안전한 쪽으로 실패합니다.
- **쓰기 검사** (`PostToolUse`)는 outbox 파일을 읽습니다. 비어 있는 필수 속성, 링크 없는 노트, 하드 랩된 문장을 경고합니다. 25 KB를 넘는 노트(자르지 말고 나누기)와 주제 클러스터를 지적합니다. 그런 다음 행의 파생 속성(`Bytes`, `Open tasks`, `Open loops`, `Has content`, `Changed`, `Hook stamp`)을 설정하고 outbox 파일을 삭제합니다.
- **복구** (`PostToolUseFailure`)는 쓰기가 실패한 뒤 없는 select 옵션을 데이터베이스에 추가하고, 같은 명령을 다시 실행하라고 에이전트에게 알립니다.

파생 속성 덕분에 위생 스캔은 페이지마다 가져오는 대신 뷰 쿼리로 실행됩니다. `Changed`는 노트의 나이입니다. 속성을 쓰면 Notion 자체의 `Last edited`가 움직이므로, 나이 규칙은 그것을 읽지 않습니다. `Hook stamp`는 훅을 거친 쓰기를 표시합니다. "Hygiene: edited outside hooks" 뷰는 나중에 다른 클라이언트가 바꾼 행을 나열하고, `/om-vault-audit`이 그것을 읽습니다.

호출의 전체 형식은 [`.claude/rules/notion-calls.md`](.claude/rules/notion-calls.md)에 있습니다.

### 🔗 훅

| 훅 | 시점 | 내용 |
|------|------|------|
| 🚀 SessionStart | 시작, 재개, `/clear`, 압축 시 | 워크스페이스를 읽고 North Star, brain topics, 최근 변경, 미완료 작업, 활성 작업, 목록, 위생 지적을 Claude Code 훅 출력 한도에 맞는 바이트 예산 안에서 주입합니다. 마지막에 크기 미터를 냅니다 |
| 💬 UserPromptSubmit | 매 메시지 | 내용(결정, 인시던트, 성과, 1:1, 아키텍처, 사람, 프로젝트 업데이트)을 분류하고 올바른 데이터베이스를 알려 주는 라우팅 힌트를 주입합니다. 이전 턴의 Stop 보고서도 에이전트에게 넘깁니다 |
| 🛡️ PreToolUse | 각 `Bash` 명령 전 | 가드: 쓰기 검사가 읽을 수 있는 형식의 Notion 명령만 통과시킵니다 |
| ✍️ PostToolUse | Notion 쓰기 후, `Write` 또는 `Edit` 후 | 쓰기 검사와 파생 속성. `Write` 또는 `Edit`에서는 잘못 놓인 메모리 파일을 지적합니다 |
| 🩹 PostToolUseFailure | Notion 쓰기가 실패한 후 | 없는 select 옵션을 추가하고 같은 명령의 재실행을 요청합니다 |
| 💾 PreCompact | 컨텍스트 압축 전 | 세션 기록을 노트 저장소 밖의 `.claude/state/session-logs/`에 백업합니다 |
| 🏁 Stop | 매 응답 후 | 체크리스트와 저장된 위생 뷰의 지적을 세션당 한 번, 바뀔 때만 다시 보여 줍니다. 사용자는 짧은 요약을 보고, 에이전트는 다음 메시지와 함께 전체 보고서를 받습니다 |

> [!TIP]
> 그냥 말하세요. 라우팅은 훅이 처리합니다.

### 🧩 Claude Code mod

Claude Code 2.1.287 이상에서는 저장소가 mod도 제공합니다. `.claude/skills/obsidian-mind/`는 코드가 Claude Code 안에서 실행되는 플러그인입니다. 같은 훅 스크립트를 실행하고, 출력이 세션에 도달하는 방식만 바꿉니다:

- **세션 맥락이 지시 파일로 도착합니다**. `AGENTS.md`와 같은 방식입니다. 압축과 `/clear` 뒤에 Claude Code가 전체를 다시 읽고, 범용 서브에이전트에게도 도달하며, 10,000자 훅 한도에 잘리지 않습니다. 예산은 `vault-manifest.json`의 `eager_layer_instruction_budget_bytes`입니다. `/memory`에서는 `.claude/session-context.md`로 보입니다.
- **Stop 보고서는 답변 아래 한 줄이 됩니다.** 지적이 바뀌면 Claude의 답변 아래에 mod 이름으로 시작하는 줄이 보입니다: `obsidian-mind: vault check: …`. 다른 플러그인도 Stop에서 응답하면 Claude Code는 이름을 `+`로 잇습니다. Claude는 다음 메시지와 함께 전체 보고서를 사용자에게 보이지 않게 받습니다. 긴급으로 표시된 지적은 보낸 메시지마다 한 번씩 즉시 Claude의 주의를 끕니다.

mod는 처리하는 각 이벤트에 대해 해당 훅에게 대기하라고 알립니다. mod가 로드되지 않는 곳에서는 훅이 이전처럼 실행됩니다. 오래된 Claude Code, 하위 폴더에서 시작한 세션(저장소 루트에서 실행하거나 `/cd`로 이동한 뒤 `/clear`), 신뢰하지 않은 폴더입니다.

mod는 사용자의 권한으로 실행되는 샌드박스 없는 코드이므로, 폴더를 신뢰하기 전에 하는 일을 확인하세요. `claude plugin validate .claude/skills/obsidian-mind`는 mod가 훅하는 모든 이벤트와 하는 모든 호출을 나열합니다. 끄려면 `.claude/settings.local.json`에 `"enabledPlugins": { "obsidian-mind@skills-dir": false }`를 추가합니다.

<!-- mod-validate:start -->
이 버전의 mod에서 출력 중 중요한 두 줄:

```text
  ❯ ./register.ts hooks: classic.SessionStart, prompt.context, classic.Stop, turn.complete, prompt.submit, turn.start
  ❯ ./register.ts calls: $.fs.write, $.process.run (via runScript), $.prompt.submit, $.session.root, $.state.get, $.state.set, $.store.get (via setShown, shownFor), $.store.set (via setShown), $.ui.invalidate
```
<!-- mod-validate:end -->

### ⚡ 토큰 효율

obsidian-mind는 워크스페이스 전체를 컨텍스트에 넣지 **않습니다**:

| 계층 | 내용 | 시점 | 비용 |
|------|------|------|------|
| **항상** | `AGENTS.md`, `.claude/rules/`, SessionStart 맥락(North Star 발췌, 최근 변경, 작업, 목록) | 세션 시작 | `vault-manifest.json`의 예산으로 제한되며 10,000자 훅 출력 한도 안입니다. 미터가 매 세션 실제 크기를 보고합니다 |
| **필요 시** | `notion-search` 결과와 일치하는 페이지 | 에이전트에게 특정 맥락이 필요할 때 | 표적 |
| **트리거** | 분류 라우팅 힌트 | 매 메시지 | 약 100 토큰 |
| **트리거** | 쓰기 검사 지적 | Notion 쓰기 후 | 약 200 토큰 |

SessionStart는 페이지 전체가 아니라 제목, 개수, 짧은 발췌를 로드합니다. 예산을 넘으면 가장 값싼 섹션이 포인터가 되고, 미터가 뺀 섹션을 하나씩 알려 줍니다. 행 개수 기준을 넘는 목록 그룹은 개수 한 줄로 접힙니다.

---

## 🗂️ 워크스페이스

설정은 일곱 개의 데이터베이스를 가진 비공개 루트 페이지 "obsidian-mind"를 하나 만듭니다:

| 데이터베이스 | 내용 |
|----------|-------|
| `Work` | 작업 노트, 결정, 인시던트, 1:1 노트, 받은편지함 항목, 생각 노트. `Type`으로 구분합니다. `Status`가 활성 폴더와 보관 폴더를 대신하고, `Project`가 작업 흐름을 묶습니다 |
| `People` | 사람마다 한 행. `Team` 포함 |
| `Teams` | 팀마다 한 행. `Members` 포함 |
| `Competencies` | 역량마다 한 행. 작업 행에서 오는 `Evidence`와 `Evidence count` 롤업 포함 |
| `Perf docs` | PR 증거, 평가 브리프, 평가 산출물, 분기별 brag |
| `Knowledge` | brain topics(Key Decisions, Patterns, Gotchas), 참고 노트, 도메인 노트, 이벤트 로그 위성, 보관 노트 |
| `Templates` | 템플릿마다 한 행 |

페이지: **Home**(링크된 뷰와 North Star의 Current Focus가 있는 대시보드), **North Star**, **People & Context**, **Recently Touched**(`Changed`로 정렬한 각 데이터베이스의 뷰), **Reader map**.

**관계가 위키링크를 대신합니다.** 뷰, 롤업, 위생 검사가 링크를 읽는 곳에서 씁니다: `Work.Decisions`, `Work.Competencies`, `Work.Person`, `Work.Team`, `Work.Feeds into`, `Perf docs.Work evidence`, `Parent`. 그 밖의 링크는 본문의 페이지 멘션입니다.

**저장된 뷰가 Bases와 손으로 관리하던 색인을 대신합니다.** 예: Active Work, Stale Actives, Completed, Incidents, 1:1 History, Competency Map, Review Evidence, Brain index. 훅은 위생 뷰(oversized, open loops, inbox pressure, loose active)를 뷰 모드로 읽습니다. 뷰 모드에는 요금제 한도가 없습니다.

**템플릿**은 `Templates`의 행입니다: Work Note, Decision Record, Thinking Note, Competency Note, Review Template.

---

## 📅 일일 워크플로우

**아침**: `/om-standup`을 실행합니다. 에이전트가 North Star, 활성 프로젝트, 미완료 작업, 최근 변경을 로드합니다. 구조화된 요약과 우선순위 제안을 받습니다.

**하루 동안**: 자연스럽게 말하세요. 내린 결정, 일어난 인시던트, 방금 한 1:1, 기억하고 싶은 성과를 언급하세요. 분류 훅이 각 내용을 올바른 데이터베이스에 저장하도록 에이전트를 이끕니다. 큰 브레인 덤프에는 `/om-dump`를 쓰고 모든 것을 한 번에 말하세요.

**하루의 끝**: "wrap up"이라고 말하면 에이전트가 `/om-wrap-up`을 호출합니다. 행을 확인하고, 링크를 검사하고, 기록되지 않은 성과를 찾습니다.

**매주**: `/om-weekly`로 세션 전반을 종합합니다. North Star와의 정렬, 패턴, 기록되지 않은 성과, 다음 주 우선순위입니다. `/om-vault-audit`으로 고아 행, 빈 속성, 훅 밖에서 편집된 행을 찾습니다.

**평가 시즌**: `/om-review-brief manager`를 실행하면 증거가 이미 연결된 평가 준비 문서를 받습니다.

---

## 🛠️ 명령

`.claude/commands/`에 정의되어 있습니다. Claude Code에서 실행합니다.

| 명령 | 하는 일 |
|---------|-------------|
| `/om-standup` | 아침 킥오프: 맥락을 로드하고, 어제를 돌아보고, 작업을 보여 주고, 우선순위를 제안합니다 |
| `/om-dump` | 자유 형식 기록: 무엇이든 자연스럽게 말하면 각 내용을 올바른 행으로 보냅니다 |
| `/om-wrap-up` | 세션 전체 검토: 행, 링크, 속성을 확인하고 개선을 제안합니다 |
| `/om-humanize` | 목소리 맞춤 편집: Claude가 쓴 초안을 사용자가 쓴 것처럼 다듬습니다 |
| `/om-weekly` | 주간 종합: 세션 전반의 패턴, North Star 정렬, 기록되지 않은 성과 |
| `/om-capture-1on1` | 1:1 회의 기록을 구조화된 `Work` 행으로 저장합니다 |
| `/om-incident-capture` | Slack의 인시던트를 구조화된 행으로 기록합니다 |
| `/om-slack-scan` | Slack 채널과 DM에서 증거를 깊이 스캔합니다 |
| `/om-peer-scan` | 평가 준비를 위해 동료의 GitHub PR을 깊이 스캔합니다 |
| `/om-review-brief` | 평가 브리프(매니저용 또는 동료용)를 생성합니다 |
| `/om-self-review` | 평가 시즌의 자기 평가를 씁니다: 프로젝트, 역량, 원칙 |
| `/om-review-peer` | 동료 평가를 씁니다: 프로젝트, 원칙, 성과 요약 |
| `/om-tidy` | 자체 유지보수: 모든 위생 지적에 대응합니다. 완료, 묶기, 나누기. 삭제하지 않습니다 |
| `/om-correct` | 정정된 사실을 일괄 반영합니다: 단일 출처에 적용하고, 반복된 서술은 링크로 바꾸고, 날짜가 있는 기록은 보존합니다 |
| `/om-vault-audit` | 속성, 링크, 고아, 뷰, 훅 밖에서 편집된 행을 감사합니다 |
| `/om-prep-1on1` | 1:1 준비: 사람의 맥락, 미해결 항목, 안건 제안 |
| `/om-meeting` | 주제별 회의 준비: 미해결 항목과 고려 사항이 있는 브리핑 |
| `/om-intake` | 회의 노트 받은편지함 처리: 받은편지함 항목을 분류하고 올바른 행으로 보냅니다 |
| `/om-project-archive` | 완료된 프로젝트를 완료로 표시해 활성 뷰에서 뺍니다 |

---

## 🤖 서브에이전트

격리된 컨텍스트 창에서 실행되는 전문 에이전트입니다. 무거운 작업을 메인 대화를 채우지 않고 처리합니다.

| 에이전트 | 목적 | 호출 위치 |
|-------|---------|------------|
| `brag-spotter` | 기록되지 않은 성과와 역량 격차를 찾습니다 | `/om-wrap-up`, `/om-weekly` |
| `context-loader` | 사람, 프로젝트, 개념에 대한 Notion 맥락을 모두 로드합니다 | 직접 |
| `correction-sweep` | 정정된 사실을 다시 서술한 모든 페이지를 찾아 분류합니다. 편집하지 않습니다 | `/om-correct` |
| `cross-linker` | 없는 관계와 멘션, 고아, 한쪽 방향 링크를 찾습니다 | `/om-vault-audit` |
| `people-profiler` | Slack 프로필에서 `People` 행을 일괄 생성하거나 갱신합니다 | `/om-incident-capture` |
| `review-prep` | 평가 기간의 모든 성과 증거를 모읍니다 | `/om-review-brief` |
| `slack-archaeologist` | Slack 전체 재구성: 모든 메시지, 스레드, 프로필 | `/om-incident-capture` |
| `vault-librarian` | 워크스페이스 심층 유지보수: 고아, 깨진 링크, 빈 속성, 오래된 행 | `/om-vault-audit` |
| `review-fact-checker` | 평가 초안의 모든 주장을 Notion 출처와 대조합니다 | `/om-self-review`, `/om-review-peer` |
| `vault-migrator` | `notion-import.ts`로 Obsidian 템플릿의 Markdown 볼트를 가져옵니다. 승인을 위한 드라이 런, 가져오기, 페이지를 만들지 않아야 하는 두 번째 실행, 각 페이지 검사를 수행합니다 | 직접 |

> [!NOTE]
> 서브에이전트는 `.claude/agents/`에 정의되어 있습니다. 분야별 워크플로우를 위해 직접 추가할 수 있습니다.

---

## 📊 성과 그래프

워크스페이스는 성과 기록 시스템도 겸합니다:

1. **`Competencies` 행**이 조직의 역량 체계를 정의합니다. 역량마다 한 행입니다
2. **작업 행**은 `Competencies` 관계를 설정하고, 보여 준 것을 본문에 씁니다
3. **증거가 자동으로 쌓입니다**: 역관계 `Evidence`와 `Evidence count` 롤업이 채워지고, Competency Map 뷰가 그것으로 정렬합니다
4. **`Perf docs`의 brag quarter**가 분기별 성과를 `Work evidence`와 함께 모읍니다
5. **`/om-peer-scan`**은 동료의 GitHub PR을 깊이 스캔하고 `Type`이 PR evidence인 `Perf docs` 행을 씁니다
6. **`/om-review-brief`**는 brag quarter, 결정, 인시던트, 역량 증거, 1:1 피드백으로 평가 브리프를 만듭니다

> [!TIP]
> 시작 방법: 템플릿으로 역량 행을 만들고, 작업 행을 그것에 연결해 나가세요. 나머지는 그래프가 합니다.

---

## 🧪 Obsidian 버전과의 동등성

커밋 `fae7be4`는 마지막 Obsidian 버전이며 각 훅의 기준입니다. `.claude/scripts/parity/`의 동등성 하네스는 그 커밋의 훅을 Markdown 픽스처 볼트에서, 포팅한 훅을 Notion의 같은 노트에서 실행하고 지적, 노트, 개수를 비교합니다:

```bash
cd .claude/scripts
node --experimental-strip-types parity/run-parity.ts                       # the reference against itself
node --experimental-strip-types parity/run-parity.ts --notion --hook validate-write
node --experimental-strip-types parity/run-mutations.ts --notion --hook validate-write
```

`--notion`에는 픽스처용 두 번째 루트가 필요합니다. `notion-setup.ts --root-title "obsidian-mind parity fixtures" --map notion-map.fixtures.json`으로 만들고 `parity/write-notion-fixture.ts`로 채웁니다. `npm test`는 같은 비교를 대체 런타임으로 오프라인 실행합니다. 라이브 테스트는 `NOTION_LIVE=1`과 맵 파일이 있을 때만 실행되고, 그 밖에는 건너뜁니다. 각 검사와 알려진 차이의 기록은 [`NOTION-PORT-DESIGN.md`](NOTION-PORT-DESIGN.md)의 파트 (d)입니다.

---

## 📥 기존 볼트 가져오기

`notion-import.ts`는 Obsidian 템플릿의 Markdown 볼트를 워크스페이스로 옮깁니다 ([#14](https://github.com/willtn/notion-mind/pull/14)). 가져오기에는 맵 파일이 필요하므로 먼저 설정을 실행하세요. 그다음 저장소 루트에서 다음 명령을 실행합니다.

```bash
node --experimental-strip-types .claude/scripts/notion-import.ts --vault ../my-vault --dry-run
node --experimental-strip-types .claude/scripts/notion-import.ts --vault ../my-vault
node --experimental-strip-types .claude/scripts/notion-import.ts --vault ../my-vault --verify
```

드라이 런은 Notion을 호출하지 않습니다. 각 노트의 위치, 가져오기가 제외하는 각 파일, 형식을 잃는 각 구문을 출력합니다. 가져오기는 볼트를 읽기만 하고 변경하지 않습니다. 각 노트는 자신의 경로를 `Source path` 속성에 가진 행이 됩니다. 그래서 두 번째 실행은 페이지를 만들지 않고, 변경된 노트만 씁니다. `--verify`는 각 페이지를 가져와 계획과 비교합니다. `vault-migrator` 서브에이전트가 이 단계들을 실행하고, 드라이 런 뒤에 승인을 요청합니다.

---

## ⚠️ 알려진 제한

아래 각 제한은 링크된 풀 리퀘스트의 측정에서 나왔습니다.

- **가드는 협조적인 에이전트를 전제로 합니다.** `notion`이나 `mcporter`라는 단어를 일부러 숨긴 명령, 또는 호출을 담은 스크립트 파일은 가드를 통과합니다. 그런 쓰기는 `Hook stamp` 감사가 나중에 지적합니다. 5초 제한 시간을 넘긴 가드는 호출을 실행되게 둡니다. ([#6](https://github.com/willtn/notion-mind/pull/6))
- **`mcporter`와 `notion`을 모두 담은 텍스트는 거부되는 명령입니다.** 커밋 메시지나 PR 본문은 파일에 쓰고 `git commit -F`나 `gh pr create --body-file`을 사용하세요. ([#6](https://github.com/willtn/notion-mind/pull/6))
- **Notion은 클라이언트를 구별하지 못합니다.** 다른 MCP 클라이언트의 쓰기는 훅을 거친 쓰기와 똑같이 보입니다. `Hook stamp` 뷰만 그것을 보여 줍니다. ([#5](https://github.com/willtn/notion-mind/pull/5), [#8](https://github.com/willtn/notion-mind/pull/8))
- **select는 쓰기에서 새 옵션을 받지 않습니다.** `Quarter`, `Project`, `Cycle`, 레벨 select는 비어 있는 상태로 시작합니다. 새 옵션이 있는 첫 쓰기는 실패하고, 복구 훅이 옵션을 추가하며, 에이전트가 명령을 다시 실행합니다. ([#5](https://github.com/willtn/notion-mind/pull/5), [#8](https://github.com/willtn/notion-mind/pull/8))
- **빈 속성과 없는 속성은 같은 상태입니다.** 빠진 필드 검사(VW-08)는 빈 속성에서 발동합니다. ([#8](https://github.com/willtn/notion-mind/pull/8))
- **페이지 멘션은 제목으로 셉니다.** 크기와 링크 검사는 이름 있는 멘션을 `[[Title]]`로 읽습니다. 제목 없는 멘션은 약 60바이트를 더합니다. 관계는 텍스트를 더하지 않습니다. ([#8](https://github.com/willtn/notion-mind/pull/8))
- **쓰기 훅은 `Quarter`를 설정하지 않습니다.** 기준과 같이, 빠진 `Quarter`는 지적으로 남습니다. ([#8](https://github.com/willtn/notion-mind/pull/8))
- **요청 한도는 60초에 180회입니다.** 클라이언트는 기다렸다가 다시 시도합니다. 긴 대기는 행에 `Hook stamp`가 없게 만들 수 있고, 훅이 그것을 알립니다. ([#8](https://github.com/willtn/notion-mind/pull/8))
- **Stop 훅은 매 턴 시간이 듭니다.** 위생 뷰를 병렬로 읽고, 제한 시간은 15초입니다. 데이터베이스 밖의 페이지에는 `Bytes`가 없어서 크기 검사가 지적하지 못합니다. ([#11](https://github.com/willtn/notion-mind/pull/11))
- **최근 변경은 커밋 제목이 아니라 페이지 제목입니다.** SessionStart는 `Changed`를 읽으므로 Home이나 North Star의 변경은 그 섹션에 나오지 않습니다. 미완료 작업 섹션은 최대 10개 행을 가져옵니다. ([#12](https://github.com/willtn/notion-mind/pull/12))
- **완료된 노트가 활성 폴더에 남을 수 없습니다.** 상태의 유일한 자리는 `Status`이므로 그 위생 검사(HY-01)에는 Notion 형태가 없습니다. 설계 기록 파트 (f)의 선택 2를 참고하세요.
- **별칭과 데일리 노트가 없습니다.** 콘텐츠 모델에 별칭 속성과 데일리 노트 유형이 없어서 `cross-linker`, `/om-standup`, `/om-weekly`에서 그 단계가 빠졌습니다. ([#9](https://github.com/willtn/notion-mind/pull/9))
- **Notion은 수식 텍스트를 돌려주지 않습니다.** 모델의 수식을 바꾼 뒤에는 `--reapply-formulas`로 설정을 실행하세요. ([#5](https://github.com/willtn/notion-mind/pull/5))
- **루트를 처음 만들 때 응답이 사라지면 그 원장 줄이 남지 않습니다.** 설정은 그래도 수렴합니다. ([#5](https://github.com/willtn/notion-mind/pull/5))
- **기록 백업은 로컬에 남습니다**. 위치는 `.claude/state/session-logs/`입니다. ([#10](https://github.com/willtn/notion-mind/pull/10))

---

## 📁 저장소 구조

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

## 🎨 사용자 지정

이것은 출발점입니다. 일하는 방식에 맞게 바꾸세요:

| 대상 | 위치 |
|------|-------|
| 목표 | North Star 페이지: 모든 세션의 기반입니다 |
| 조직 | `People`, `Teams`, People & Context 페이지 |
| 역량 | `Competencies`: 조직의 체계에 맞춥니다 |
| 도구 | `.claude/commands/`: GitHub 조직과 Slack 워크스페이스에 맞게 편집합니다 |
| 규칙 | `AGENTS.md`: 운영 매뉴얼. 사용하면서 발전시킵니다(Claude Code 전용 추가는 `.claude/rules/`) |
| 모델 | `.claude/scripts/lib/notion-model.ts`: 데이터베이스, 속성, 뷰. 바꾼 뒤 설정을 다시 실행합니다 |

> [!IMPORTANT]
> `AGENTS.md`는 운영 매뉴얼입니다. 규칙을 바꾸면 업데이트하세요. 에이전트는 매 세션 그것을 읽습니다.

---

## 🔄 업데이트

```bash
git pull
node --experimental-strip-types .claude/scripts/notion-setup.ts
```

pull은 훅, 명령, 규칙을 업데이트합니다. 설정은 새 버전의 모델에 필요한 것만 추가하고 다른 것은 만들지 않습니다. 노트는 Notion에 남고 변경되지 않습니다.

---

## 🩺 문제 해결

**Claude Code가 규칙을 무시합니다.** Claude Code는 `AGENTS.md` 대신 `CLAUDE.md`를 읽고 `AGENTS.md`를 말없이 건너뜁니다. 저장소 루트에 `CLAUDE.md`가 있으면 위생 지적에 `CLAUDE.md present beside AGENTS.md`가 나옵니다. 추가한 내용을 `.claude/rules/local.md`나 `AGENTS.md`로 옮기고 `CLAUDE.md`를 삭제하세요. 저장소보다 위 폴더의 `CLAUDE.md`도 같은 결과를 내며, 이 지적으로는 보이지 않습니다.

**Notion 명령이 거부됩니다.** 이유를 읽으세요. 허용된 형식이 나와 있습니다. 대부분 읽기에 파이프나 리다이렉트가 있거나, 커밋 메시지에 `mcporter`와 `notion`이 모두 있습니다. [`.claude/rules/notion-calls.md`](.claude/rules/notion-calls.md)를 참고하세요.

**섹션에 `(not read: …)`가 나옵니다.** SessionStart나 Stop이 워크스페이스의 그 부분을 읽지 못했습니다. `mcporter auth notion`을 확인한 뒤 `node --experimental-strip-types .claude/scripts/notion-setup.ts --check`를 실행하세요.

**설정이 워크스페이스에서 멈춥니다.** `--workspace-id`와 맵 파일은 둘 다 워크스페이스를 지정합니다. 로그인이 다른 워크스페이스이면 설정이 멈춥니다. 올바른 워크스페이스에 로그인하거나 이전 `notion-map.json`을 옮기세요.

---

## 🗺️ 로드맵

**이슈와 버그 보고를 환영합니다.** 코드 기여는 배정 방식입니다. 이슈에 댓글로 요청하고, 배정된 뒤 PR을 여세요. 배정되지 않은 이슈의 PR은 리뷰 없이 닫힙니다. [CONTRIBUTING.md](CONTRIBUTING.md)를 참고하세요.

---

## 🙏 설계에 영향을 준 것

- [kepano/obsidian-skills](https://github.com/kepano/obsidian-skills): Obsidian 버전의 에이전트 스킬
- [James Bedford](https://x.com/jameesy): 볼트 구조 철학, AI 생성 콘텐츠의 분리
- [arscontexta](https://github.com/agenticnotetaking/arscontexta): description 필드를 통한 점진적 공개, 세션 훅

---

## 👤 만든 사람

**[Brenno Ferrari](https://brennoferrari.com)**가 만들었습니다. 베를린의 시니어 iOS 엔지니어로, Claude Code로 개발자 도구를 만듭니다.

---

## 📄 라이선스

MIT
