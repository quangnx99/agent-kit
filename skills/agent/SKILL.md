---
name: "agent"
description: "Launch any kit skill by name or by intent. Usage: /agent [skill] [args] · /agent list"
metadata:
  kit: agent
---

Available skills: agent, agents, analyze, apply, archive, autopilot, brainstorm, browser, chore, e2e, enhance, explore, fix, gap-audit, git, indexing, knowledge, proposal, review, tdd, verify

You are the dispatcher. Never invoke `agent` again. Resolve the target from ARGUMENTS and invoke it with the Skill tool as `agent:<name>` (retry the bare `<name>` if that fails), passing the remaining arguments. Agents are spawned by the skills, never by you.

Supporting agents: agent-analyze (structural analysis), agent-apply (writes code), agent-archive (archives a change), agent-e2e (full-env e2e tests), agent-gap-audit (checklist vs system), agent-knowledge (repo knowledge docs), agent-researcher (web research), agent-security (security review of a change), agent-spec-review (spec gate), agent-tdd (failing tests first), agent-verify (code vs spec).

## KIT_CATALOG

| group | skill | blurb |
|---|---|---|
| daily | brainstorm | Nhận yêu cầu → brainstorm kỹ → chọn flow (feature, refactor, perf, docs, test, ci, docker) |
| daily | fix | Sửa bug: reproduce, root cause, rồi chọn flow |
| daily | chore | Việc nhỏ đã rõ, làm trực tiếp (không explore) |
| flow | autopilot | Chạy cả chuỗi tự động; --full = flow chuẩn |
| flow | proposal | Tạo spec (proposal/design/tasks) |
| flow | tdd | Test đỏ từ spec, gate 100% AC rồi mới code |
| flow | apply | Code theo spec/plan (--parallel=N) |
| flow | verify | Đối chiếu code với spec và test tdd |
| flow | e2e | E2E trên môi trường local đầy đủ, UI + API |
| flow | archive | Archive change đã xong |
| flow | knowledge | Đóng gói tri thức repo cho người sau |
| investigate | analyze | Blast radius, dependency (quick\|standard\|deep) |
| investigate | review | Review code (impact, hardcode, rule project) |
| investigate | gap-audit | Tài liệu yêu cầu vs hệ thống → Gap Matrix |
| investigate | browser | Reproduce bug / QA flow trên trình duyệt |
| tools | git | commit/pull/push/merge/rebase/log |
| tools | indexing | Index lại workspace cho codebase-retrieval |
| tools | agents | Xem trực quan agent đang làm gì |
| tools | enhance | Viết lại prompt cho rõ, không thực thi |
| internal | explore | Stance dùng chung, tự nạp |
| internal | agent | Dispatcher này |

Group headings: daily → **Hằng ngày** · flow → **Flow chuẩn** (brainstorm → spec → tdd → code → verify → e2e → archive → knowledge) · investigate → **Điều tra** (chỉ đọc) · tools → **Công cụ** · internal → **Nội bộ** (không gọi trực tiếp)

## List

If the first argument is `list`, `ls`, `--list` or `-l`: print `**Agent kit — <number of catalog rows> skills**`, then each group heading followed by its rows as `  <skill padded to 11>  <blurb>`, then `**Alias:** auto → autopilot` and the supporting agents line. Use only KIT_CATALOG (never frontmatter, never the disk). Stop.

## Dispatch

1. First argument is a skill name or the alias `auto` → that skill.
2. Otherwise infer from the request (never `explore` or `agent`):
   - new feature, enhancement, a request from the boss, "thêm tính năng", "lên ý tưởng"; also refactor, performance, docs, tests, CI/CD, Docker work → `brainstorm` (pass the work type)
   - bug, error, regression, broken behavior, "sửa lỗi" → `fix`
   - small, already-decided change done directly (bump a dependency, rename a config key, update a script), "bảo trì nhỏ", "làm luôn" → `chore`
   - run everything automatically, "chạy hết", end-to-end autonomous → `autopilot`
   - spec creation → `proposal` · tests first from a spec → `tdd` · implement a spec/plan → `apply` · check code against spec → `verify` · e2e / user journey / "test luồng" / Playwright / Cypress → `e2e` · archive a change → `archive` · update repo knowledge / handover docs / "đóng gói tri thức" → `knowledge`
   - impact, blast radius, dependencies → `analyze` · code review, hardcoded values, missed impacts → `review` · requirements document vs system, "còn thiếu gì" → `gap-audit` · reproduce in a browser, visual bug → `browser`
   - git operations → `git` · index / re-index, "đánh index" → `indexing` · what agents are doing → `agents` · rewrite a prompt → `enhance`
   - full security audit, pen test → not in this kit: tell the user to run `/security-audit`
3. Ambiguous between several skills → ask which one; do not guess.
4. `brainstorm` and `fix` need `explore`: invoke both in one message — the skill with the request plus `CALLER_CONTEXT: shared explore mode has already been loaded for this request. Do not invoke the explore skill again.`, and `explore` with the request. Every other skill (including `chore`) is invoked alone.

ARGUMENTS: $ARGUMENTS
