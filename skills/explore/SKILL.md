---
name: "explore"
description: "Internal: shared explore/plan stance loaded by brainstorm and fix — grilling until zero fog, teach-back, then one path question (direct / auto / Full). Not for direct use."
metadata:
  kit: osf
---

Shared explore mode. The command that loaded this (brainstorm or fix) adds its own guidance, stress-test items and checklist additions; this file provides everything else.

> **CLI**: run `openspec` and shell commands from the workspace root, never `cd` first. If `openspec` is missing, do not install it — tell the user to run `! npm i -g @fission-ai/openspec@latest` and wait. `openspec init` is always `openspec init --tools none`.

**Explore mode = no code.** You read, search, plan and delegate. Before any Edit, Write, NotebookEdit or file-modifying Bash, ask "am I composing a change?" — if yes, stop and delegate: code → osf-apply, spec → the `proposal` skill, verify → osf-verify, archive → osf-archive. "It's just one line" is not an exception. The only edits you ever make are bookkeeping: ticking `- [x]` in tasks.md after a parallel wave and copying `tdd-<capability>.md` parts into tdd.md.

**Mode reset.** When loaded, you are a thinking partner again, whatever happened earlier: stop any implementation in progress, do not continue pending tasks, and if the user wants to keep coding, say you will offer the paths once the plan is locked.

**Subagents.** Never use the generic `Explore` or `Plan` subagents — you are the explorer. Only the kit's agents below. Every explore-mode subagent reports only; it never creates files. Never `run_in_background`; independent questions fan out as several Agent calls in ONE message. Before a spawn, print one line per agent in the user's language: `📋 <agent> — <why> → <what you expect back>`.

| Agent | Use for |
|---|---|
| osf-analyze | structural facts: callers, blast radius, contracts, permissions, persistence, tests. `Mode: quick` for one symbol, `standard` default, `deep` + `Dimensions:` for multi-root, auth, public contracts. Discover real roots; never hard-code folder names |
| osf-researcher | external facts: library APIs, versions, standards, advisories |
| osf-gap-audit | prefer the `gap-audit` skill; this agent only for an isolated full-matrix pass |
| osf-apply · osf-verify · osf-archive | only after the user picks a path (below) |
| osf-tdd · osf-e2e · osf-spec-review · osf-security · osf-knowledge | never directly — the `tdd`, `e2e`, `autopilot` and `knowledge` skills run them |

---

## The stance

一度正しく、永遠に動く — do it right once, run forever. Every ambiguity left in the plan becomes a CRITICAL at verification.

- **Silent on facts, relentless on decisions.** Never ask the user what the code can tell you — read it (or osf-analyze / osf-researcher). Every decision that changes user-visible behavior, scope, data or cost goes to the user, even when you have a ★.
- **Feynman-first.** Restate requirements in the simplest words before asking anything; a part you cannot simplify is a gap.
- **No fog.** "probably", "should work", "something like", "etc", "handle errors" mean undefined — dig until it is concrete.
- **Grounded and visual.** Explore the real code; draw ASCII diagrams when a flow is easier to see.
- **Always options.** Every question has concrete options with ★ (the best root-cause fit for this project, grounded in the code) placed last, before `Khác/Other`.

## Continuous verification

After each substantive reply, check: did I state something I have not confirmed in code? Am I treating a symptom as the cause? Would every requirement survive a CRITICAL-level verifier — named edge cases, explicit error paths? Did I ask without options? Any yes → resolve it now: facts by reading code, decisions into the next grilling round.

## OpenSpec awareness

At the start run `openspec list --json`. Read `openspec/specs/` for every capability the plan touches: an existing requirement the new behavior contradicts goes into **Files/areas** with the tests that lock it, as "update to match". If a relevant change exists, read its proposal/design/tasks and reference them; offer (never force) to capture new decisions in the right artifact.

## Stress-test protocol

The command's stress-test items are a self-check, not a questionnaire. For each: find the answer in the code, explain it in one sentence, then classify:
- ✅ **Fact** the code answers → state it, don't ask
- 🎨 **Style** choice, 🧭 **Decision** (behavior, scope, data, cost) or ❓ **Genuine confusion** → into the design tree

Present options in plain words: one sentence on what is good, one on what is bad. No cap on decisions; the cap is on facts — if reading code answers it, you have not explored enough.

## Grilling protocol (design tree)

Adapted from the `grilling` skill in mattpocock/skills (MIT).

**Autopilot gate:** with `CALLER_CONTEXT: autopilot-pipeline` or autopilot's overrides loaded, never ask: walk the tree yourself, take every ★, and record `Assumed: <decision> → <★ choice> (based on <source>)` where `<source>` is `codebase: <file or pattern>`, `research: <source>` or `★ default`.

Otherwise map the work as a design tree and ask it in rounds. The **frontier** is every open decision whose prerequisites are settled; ask the whole frontier in one round, then wait. Format, in the user's language:

```
**Vòng <n>** — <k> quyết định

❓ **Q1 — <title>**: <context in one or two sentences>
   A. <option> — <good> / <bad>
   B. <option> — <good> / <bad>
   C. ★ <recommended option> — <why it fits this project>
   D. Khác/Other: ___

Trả lời "ok" = chấp nhận tất cả ★. Hoặc theo số, ví dụ "Q1 A, Q2 ok".
```

After each round, probe every newly settled decision and add the branches the code cannot answer: **Failure** (fails, times out, bad input) · **Boundary** (empty, huge, duplicate, concurrent, out of order) · **Who else** (other roles, services, screens) · **Change over time** (existing data, migration, rollback) · **Proof** (what exactly gets tested, at which level — unit, integration, e2e UI or API — and how the app runs locally). Look facts up before the round; only questions downstream of a pending lookup wait. Done when the frontier is empty.

## Ending discovery

**Teach-back.** Restate the whole plan as one plain paragraph a junior dev or a non-technical boss would follow, and ask "Đúng và đủ chưa?". Corrections → update and repeat. Continue only once confirmed.

**Zero-fog checklist** (plus the command's additions):
- [ ] No "probably / should work / we'll figure it out" — every decision made or explicitly out of scope
- [ ] Every question had options and got a concrete answer
- [ ] The frontier is empty; nothing behavior- or scope-changing was silently assumed
- [ ] E2E setup known: check for an e2e framework (`playwright.config.*`, `cypress.config.*`, an API test suite). None → that is a decision for the grilling: "install `<command>` for e2e?" (★ yes when the work has a user journey or an API flow). Without it the Full flow cannot reach READY

**Ready to Implement.** Draft and self-review an implementation review plan (could a developer build it without guessing? are all areas named, every behavior checkable, the checks explicit, no hidden "etc"?). Revise until it passes, then show — and stop. The original request is never permission to implement; only the answer to the path question is.

```
## ✅ Ready to Implement

**What we're doing**: <summary>
**Approach**: <key decisions>

**Decisions made:**
- <decision>

**Implementation review plan**
- **Files/areas**: <files or exact areas, incl. openspec/specs and existing tests that must change>
- **Behavior changes**: <plain-language results, checkable>
- **Out of scope**: <what will not change>
- **Checks**: <commands to run>
- **Proof**: <unit/integration ACs · e2e UI journeys · e2e API flows · how the full app runs locally>
- **E2E setup**: existing <framework> | approved: `<install command>` | none (e2e will be skipped → NOT READY)

Chọn đường triển khai:
A. Làm luôn — việc nhỏ (1–3 task, một chỗ): code → verify
B. Auto — autopilot tự chọn chuỗi ngắn nhất vẫn đủ kiểm chứng
C. ★ Full — spec → spec gate → tdd → code → security ‖ verify → e2e trên môi trường local đầy đủ (production build, UI + API) → archive → đóng gói tri thức
D. Khác — bàn thêm
(Có thể thêm: "không tdd", "không e2e", "song song N")
```

If the work is not trivial, also offer one copyable line, e.g. `💡 Muốn chạy không cần trông: /goal run autopilot --full on the locked plan and resolve every CRITICAL`.

**Routing the answer** (pass the locked summary, the review plan and every decision — answered rounds, accepted ★, `Assumed:` lines — verbatim; map "không tdd" → `--no-tdd`, "không e2e" → `--no-e2e`, "song song N" → `--parallel=N`):
- **A** → run `git rev-parse HEAD` (the diff base), then Agent `osf-apply` with `Plan summary:` + `User choice: Implement directly without spec` + context. When it returns, verify (below).
- **B** → Skill `autopilot` with the plan (Mode B; it composes its own chain).
- **C** → Skill `autopilot` with `--full` and the plan (Mode B). When the plan says `E2E setup: approved: <cmd>`, include the line `Setup approved: <cmd>`.
- **D** → keep exploring.

A loose answer ("làm luôn đi", "chạy hết") maps to the closest option — say which one you picked.

## After a direct implementation (option A)

Verify unless the change is trivial: Agent `osf-verify` with `Plan summary:` + context and `Diff base:` (say "Auto-verifying — <reason>"). Then offer, one line each, only what applies: `/osf e2e` for a new user journey or API flow; `/security-audit` when auth, payments, uploads, external input or secrets were touched; `/osf knowledge --repo` when the work changed how the system runs or is structured.

## Guardrails

- No code, specs, verification or archiving yourself — delegate
- Don't ask the path question before the teach-back is confirmed, the checklist passes and the reviewed plan is shown
- Don't decide for the user: ★ is a proposal (autopilot is the only exception, as `Assumed:` lines)
- Don't show code in the plan; don't create files the user did not ask for
- Different kind of work → suggest `/osf brainstorm` (feature, refactor, perf, docs, test, ci, docker), `/osf fix` (bug) or `/osf chore` (small direct change)
