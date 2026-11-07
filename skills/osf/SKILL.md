---
name: "osf"
description: "Launch any kit skill by name. Usage: /osf [skill] [args] · /osf list"
metadata:
  kit: osf
---

Available skills: agents, analyze, apply, archive, autopilot, brainstorm, browser, chore, ci, clean-room, docker, docs, e2e, enhance, explain, explore, fix, gap-audit, git, indexing, osf, perf, proposal, refactor, research, review, security, setup, tdd, team, test, uiux-design, verify

RUNTIME GUARD:
This prompt is already the `osf` dispatcher. Do NOT invoke `osf` again. Resolve the target skill from ARGUMENTS and dispatch directly. Only invoke the resolved target skill, and invoke `explore` too when the resolved target is a planning skill.

Invoke kit skills with the Skill tool: `osf:<name>` (plugin install); if that fails, retry the bare `<name>`. Spawn supporting agents with the Agent tool, `subagent_type: "<name>"`.

Supporting subagents (used internally by skills):
- osf-analyze — Structural codebase analysis (dependencies, blast radius, call chains) via codebase-retrieval; modes quick|standard|deep
- osf-apply — Implement tasks from spec or conversation plan
- osf-archive — Archive completed change to openspec/changes/archive/
- osf-clean-room — Port a feature from an external repo: analyze temp clone and draft OpenSpec change
- osf-gap-audit — Requirements checklist vs system → Gap Matrix (present/partial/missing); read-only
- osf-tdd — Test-first Red phase: AC → failing unit/integration tests with traceability + lock
- osf-e2e — End-to-end tests for user journeys (UI/API) against a local app, after implementation
- osf-researcher — Web research (technical docs, best practices, comparisons, security advisories)
- osf-uiux-designer — UI/UX design analysis and reports
- osf-verify — Verify implementation matches spec
- osf-spec-review — Adversarial spec gate before tests/code (used by autopilot Full)
- osf-security — Security review of one change before verify (used by autopilot Full); `Mode: threat-model` before code (used by team)
- osf-pm — Team kickoff: goals, stories, walked decision tree, draft AC (used by team)
- osf-ba — Team kickoff: capabilities + Requirement/Scenario WHEN/THEN draft (used by team)
- osf-qa — Team kickoff: test stack, AC by level, e2e journeys (used by team)

Aliases:
- auto → autopilot

KIT_CATALOG (presentation source of truth — group order and blurbs are fixed):

| group | skill | blurb |
|---|---|---|
| planning | brainstorm | Brainstorm tính năng mới |
| planning | fix | Sửa bug, tìm root cause |
| planning | chore | Bảo trì, thay đổi trực tiếp |
| planning | refactor | Dọn code, không đổi behavior |
| planning | perf | Tối ưu hiệu năng |
| planning | docs | Tài liệu, README |
| planning | test | Thêm/cải thiện test |
| planning | ci | CI/CD pipeline |
| planning | docker | Container, image, compose |
| planning | setup | Scaffold project từ boilerplate |
| spec | proposal | Tạo spec (proposal/design/tasks) |
| spec | tdd | Sinh test trước, gate 100% AC rồi mới code |
| spec | apply | Implement theo spec/plan (--parallel=N) |
| spec | e2e | Test e2e cho user journey sau khi code |
| spec | verify | Đối chiếu implementation vs spec |
| spec | archive | Archive change đã xong |
| investigate | analyze | Blast radius, dependency (quick\|standard\|deep) |
| investigate | gap-audit | Checklist vs hệ thống → Gap Matrix |
| investigate | explain | Giải thích code (Feynman) |
| investigate | review | Review code quality |
| investigate | security | Audit bảo mật đầy đủ (repo hoặc change), có report |
| investigate | research | Tra web: docs, best practice, advisory |
| investigate | browser | Reproduce bug qua dev-browser |
| automation | autopilot | Pipeline tự động end-to-end (--parallel=N) |
| automation | team | Đội PM/BA/DEV/QA/SEC chạy song song, rồi pipeline |
| automation | agents | Xem trực quan agent đang làm gì |
| automation | git | commit/pull/push/merge/rebase/log |
| automation | clean-room | Port feature từ repo ngoài |
| automation | uiux-design | Phân tích & đề xuất UI/UX |
| automation | enhance | Viết lại prompt cho rõ, không thực thi |
| automation | indexing | Index/re-index workspace qua Context Engine, hiện % |
| internal | explore | Shared explore stance, auto-load |
| internal | osf | Dispatcher này |

Group headings for list output:
- planning → **Planning** (explore → implement, có thể tạo spec)
- spec → **Spec workflow** (OpenSpec)
- investigate → **Investigate** (read-only)
- automation → **Automation**
- internal → **Internal** (không gọi trực tiếp)

LIST RULES (higher priority than dispatch — evaluate first):

1. If "$0" is exactly one of: `list`, `ls`, `--list`, `-l`, run the list flow and STOP. Do not dispatch. Do not infer a skill.
2. Print the catalog **exactly** in this structure (use KIT_CATALOG for skill order and blurbs; do **not** invent blurbs from frontmatter `description`). Header count is always the KIT_CATALOG size (33). Do not scan `~/.claude/skills` or any other disk path — KIT_CATALOG is the source of truth.

```
**OSF kit — 33 skills**

**Planning** (explore → implement, có thể tạo spec)
  brainstorm  Brainstorm tính năng mới
  fix         Sửa bug, tìm root cause
  chore       Bảo trì, thay đổi trực tiếp
  refactor    Dọn code, không đổi behavior
  perf        Tối ưu hiệu năng
  docs        Tài liệu, README
  test        Thêm/cải thiện test
  ci          CI/CD pipeline
  docker      Container, image, compose
  setup       Scaffold project từ boilerplate

**Spec workflow** (OpenSpec)
  proposal    Tạo spec (proposal/design/tasks)
  tdd         Sinh test trước, gate 100% AC rồi mới code
  apply       Implement theo spec/plan (--parallel=N)
  e2e         Test e2e cho user journey sau khi code
  verify      Đối chiếu implementation vs spec
  archive     Archive change đã xong

**Investigate** (read-only)
  analyze     Blast radius, dependency (quick|standard|deep)
  gap-audit   Checklist vs hệ thống → Gap Matrix
  explain     Giải thích code (Feynman)
  review      Review code quality
  security    Audit bảo mật đầy đủ (repo hoặc change), có report
  research    Tra web: docs, best practice, advisory
  browser     Reproduce bug qua dev-browser

**Automation**
  autopilot   Pipeline tự động end-to-end (--parallel=N)
  team        Đội PM/BA/DEV/QA/SEC chạy song song, rồi pipeline
  agents      Xem trực quan agent đang làm gì
  git         commit/pull/push/merge/rebase/log
  clean-room  Port feature từ repo ngoài
  uiux-design Phân tích & đề xuất UI/UX
  enhance     Viết lại prompt cho rõ, không thực thi
  indexing    Index/re-index workspace qua Context Engine, hiện %

**Internal** (không gọi trực tiếp)
  explore     Shared explore stance, auto-load
  osf         Dispatcher này

**Aliases:** auto → autopilot

**Supporting subagents:**
  osf-analyze, osf-apply, osf-archive, osf-ba, osf-clean-room,
  osf-e2e, osf-gap-audit, osf-pm, osf-qa, osf-researcher, osf-security, osf-spec-review, osf-tdd, osf-uiux-designer, osf-verify
```

3. STOP. No Skill tool. No further dispatch.

Dispatch rules:

1. Resolve the target skill:
   - If "$0" is present and matches a supported skill or alias, resolve the alias first.
   - If "$0" is empty or not in the supported skill list, infer the best matching skill from the user's request.
2. Self-dispatch guard: if the resolved target is `osf`, do NOT invoke `osf` again. Print one line: `osf is the dispatcher — use /osf list or /osf <skill> [args]` and stop. (`explore` may still be invoked by exact name.)
3. Intent inference (only when "$0" is empty or not an exact skill/alias match) must never resolve to `explore` or `osf`. Those names are listable/internal only for exact "$0" match (`explore`) or blocked (`osf`).
4. Use the most specific match:
   - bug fix, broken behavior, error, regression, "sửa lỗi" → `fix`
   - new feature, enhancement, "thêm tính năng", brainstorm, idea, "lên ý tưởng" → `brainstorm`
   - refactor, cleanup without behavior change → `refactor`
   - performance, speed, latency, optimization → `perf`
   - docs, README, guide, comments → `docs`
   - TDD, test-first, "viết test trước", generate tests from spec before coding → `tdd`
   - e2e, end-to-end, Playwright/Cypress, user journey test, "test luồng", automated flow test to keep in repo → `e2e`
   - tests, coverage, unit/integration tests (not e2e — that is `e2e` above) → `test`
   - CI/CD, workflow automation, pipelines → `ci`
   - Docker, containers, images, compose → `docker`
   - git status/commit/pull/push/merge/rebase/log/changelog → `git`
   - browser reproduction, visual bug investigation, navigation → `browser`
   - explain how code works, teach-back, understanding flow → `explain`
   - impact analysis, dependency tracing, feasibility, blast radius, deep/quick analyze → `analyze`
   - requirements gap, checklist vs system, coverage audit, "còn thiếu gì", PM/spec function groups vs implementation, feature matrix, traceability → `gap-audit`
   - review code, code quality, missed impacts, hardcoded values → `review`
   - security audit, pen test, vulnerability review, "check bảo mật", "soi security" → `security`
   - research docs, best practices, comparisons, advisories → `research`
   - project scaffolding, boilerplate, initial setup → `setup`
   - proposal/spec creation → `proposal`
   - implementation from plan/spec → `apply`
   - verification/review against spec → `verify`
   - archive completed change → `archive`
   - UI/UX review or design direction → `uiux-design`
   - clean-room, port feature from external repo, clean-room reimplementation → `clean-room`
   - enhance/rewrite/clarify a prompt, "làm rõ prompt", "viết lại prompt" → `enhance`
   - index/re-index workspace, Context Engine, codebase-retrieval index, "đánh index", "index lại" → `indexing`
   - fully autonomous end-to-end workflow → `autopilot`
   - a squad/team of roles working at once, "spawn nhiều agent", "đội PM BA DEV", max parallel, burn spare tokens for speed → `team`
   - visualize/monitor agents, "agent đang làm gì", dashboard agent, which agents ran in parallel → `agents`
5. If the request could reasonably map to multiple skills and no best match is clear, ask the user which skill to run. Do not guess when intent is ambiguous.
6. Planning skills are: brainstorm, fix, chore, refactor, perf, docs, test, ci, docker, setup.
7. Invoke the resolved skill:
   - Skill tool. Prefer `osf:<name>` when this kit is a plugin; fall back to `<name>`.
8. If the resolved target is a planning skill, invoke the resolved skill and `explore` in parallel:
   - Invoke the resolved skill with the user's remaining arguments plus this context: `CALLER_CONTEXT: shared explore mode has already been loaded for this request. Do not invoke the explore skill again.`
   - Invoke `explore` with the same user request as context.
9. If the resolved target is not a planning skill, invoke only the resolved skill.

If the user provided additional arguments beyond the skill name, include them as context for the invoked skill.

ARGUMENTS: $ARGUMENTS
