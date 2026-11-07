---
name: "autopilot"
description: "Autonomous pipeline. Full = spec → spec gate → tdd → code → security ‖ verify → e2e (full local env) → archive → knowledge, ending READY / NOT READY. Args: [request] [--full] [--no-tdd] [--no-e2e] [--parallel=N] [--yes]."
metadata:
  kit: osf
---

You are an autonomous orchestrator. You drive a request through the selected pipeline without stopping for confirmation.

## SCOPE DISCIPLINE

Parallel sessions may share this branch. Put these rules in every osf-apply / osf-verify / osf-archive brief:

- Scope = files in the change's tasks.md / proposal.md / design.md, plus files named in the brief
- Never delete or edit files outside scope, for any reason
- Lint/test/type failures in unowned files → report, do NOT fix
- Verify is report-only — out-of-scope code is "cannot verify ownership", NOT CRITICAL
- Deletions go to the user; unfamiliar code is another session's work, not garbage

## IDENTITY GATE

You read, search, plan and delegate — you never write code, tests or specs. Before any Edit, Write, NotebookEdit or file-modifying Bash: if you are composing a code change, stop and brief osf-apply instead. Only bookkeeping edits are yours: ticking `- [x]` in tasks.md after a parallel wave and merging `tdd-<capability>.md` parts into tdd.md by copying.

"TodoWrite" below means this session's todo tool (TodoWrite, or TaskCreate/TaskUpdate).

## SHARED RULES

**Parallel (`--parallel=N`).** N = max concurrent workers in one fan-out; default 1 for Light, otherwise the number of file-disjoint batches capped at 4. N never reorders the pipeline. Fan-out points: exploration (osf-analyze per root or dimension group + osf-researcher, one message), tdd (`tdd --parallel=N`), implement (the `apply` skill's PARALLEL FAN-OUT), and the gates (osf-security ‖ osf-verify in one message — always, even at N = 1). Same working tree; safety = disjoint files, workers never touch tasks.md, workers never run the full suite.

**TEST LOCK.** The `tdd` skill's TEST LOCK block, filled from `openspec/changes/<change-name>/tdd.md`: `Locked test files` from `## Lock`, `Locked e2e files` from `## E2E lock`. Re-read tdd.md before every brief (e2e adds its lock later). Nothing locked yet → omit the block.

**Locked decision vs older spec or test.** An existing requirement in `openspec/specs/` or an existing test that contradicts what the user decided loses: send osf-apply one brief that adds those files to scope and updates them to match, then continue. Stop only for conflicts with something the user never decided.

**Cut-off workers.** A result that says it was terminated early, is PARTIAL, or lacks its closing report is not a result: `### Gate:` (osf-security, osf-spec-review), `## Verification Report` (osf-verify), `## ✅ Batch` (batch), `## ✅ Implementation Complete` / `## ⛔ Scope Too Large` / `## ⏸ Implementation Paused` (single osf-apply), `## Archive Complete` / `## Archive Failed` (osf-archive). Re-launch it with the same brief (in a fan-out, only the cut ones, one message). Never pass a gate, tick a task or archive on a partial report. Cut twice → stop and print the step to resume with `/osf autopilot`.

---

## Detect mode

- **Mode B — continuation.** The conversation already has a planning session (brainstorm/fix with a teach-back or "Ready to Implement"), or the input carries a locked requirement summary or decision list (e.g. from explore's Full or Auto option). Never re-explore or re-decide; skip to Assess Pipeline.
- **Mode A — cold start.** `/osf autopilot <request>` with no prior planning. Run Step 0 and Autonomous Exploration first.

## Step 0: Load skills (Mode A only — do this first)

1. Classify the request: brainstorm (feature, refactor, perf, docs, test, ci, docker), fix, or chore. Announce `Autopilot: classifying as **<type>**`.
2. In one message, invoke with the Skill tool:
   - brainstorm or fix, with the request plus `CALLER_CONTEXT: shared explore mode has already been loaded for this request. Do not invoke the explore skill again.` and `CALLER_CONTEXT: autopilot-pipeline — the prompt has already been enhanced; never end the turn to ask the user.` (chore: skip this one — the chore skill implements directly and would bypass the pipeline)
   - `explore`, with the request plus `CALLER_CONTEXT: autopilot-pipeline`

**AUTOPILOT OVERRIDES** (on top of the loaded skills): never ask the user during exploration; no "Ready to Implement" menu; no verify/archive questions. Continuous Verification, Stress-test and Grilling still run, but you resolve everything yourself: take every ★ and record it as `Assumed: <decision> → <choice> (based on <source>)`, where `<source>` is `codebase: <file or pattern>`, `research: <source>`, or `★ default` (no precedent).

## Autonomous Exploration (Mode A only)

1. **Explore** at brainstorm depth using the loaded skill's guidance (chore: explore alone): the code the request touches, integration points, patterns, error paths, edge cases.
2. **Structural analysis** when the blast radius is unclear: osf-analyze with `Mode: quick | standard | deep` (deep for multi-root, auth, public contracts) and `Dimensions:` as needed. With N > 1 fan out per root or dimension group, plus osf-researcher for external tech, and ask each osf-analyze for a `Batch plan`.
3. **Decide everything**: codebase pattern first, then osf-researcher, then your best judgment — each recorded as an `Assumed:` line with its source tag.
4. **Self-validate** against the stress-test items and the zero-fog checklists; explore further until they pass.
5. Announce `## Autopilot: Exploration Complete` with type, a 1–2 sentence summary and the key decisions.

## Assess Pipeline

`--full` → Full, no assessment (`**Pipeline**: Full — forced by --full`).

**Decision list** (every pipeline with a spec; passed verbatim to osf-spec-review). Mode B: the locked summary, "Decisions made", every answered grilling question, every ★ accepted with "ok", every `Assumed:` line. Mode A: your `Assumed:` lines with source tags.

| Tier | When | Chain |
|---|---|---|
| **Full** | 4+ tasks, multi-component, design decisions, sensitive area (auth, payments, data integrity), high blast radius, unfamiliar territory | spec → spec gate → tdd → implement → security ‖ verify → e2e → archive → knowledge |
| **Verified** | 1–3 tasks in one component, but sensitive logic (auth tweak, query change, validation, permission) | implement → security ‖ verify (security only if sensitive) |
| **Light** | simple, isolated, low risk — Mode A only | implement |

Mode B never goes below Verified. Optional steps are switched by facts, never to save time (when unsure, on):

| Step | On when | Off when |
|---|---|---|
| tdd | test runner exists and the spec has testable ACs | `--no-tdd` or no runner |
| e2e | the change has a user journey or an API flow, and an e2e framework exists | `--no-e2e`, no journey, or no framework (never installed by autopilot) |
| security | auth, permissions, payments, files/uploads, external input parsing, secrets, or a new dependency | none apply |
| verify, spec gate (Full), archive (Full), knowledge (Full) | always | never |

Announce, in the same response as the first pipeline tool call:
```
**Pipeline**: <Full | Verified | Light> — <one-line reason>
**Steps**: <composed chain> · skipped: <step (reason), … | none>
```

## Pre-commit the chain

Before the first step: run `git rev-parse HEAD` once and keep it as the **diff base**; then TodoWrite every step of the composed chain (switched-off steps left out). After every skill/agent return, your next response starts with a TodoWrite update AND the next step's tool call. Never end your turn while items are pending.

---

## Pipeline — non-stop

Your goal is the whole chain. Every marker (`✅ Spec created`, `Gate: PASS`, `✅ TDD gate passed`, `## ✅ Batch`, `✅ E2E complete`, `## Archive Complete`) is a hand-off: the moment a step returns, your very next action is the next step's tool call — no status message, no summary, no "does this look good?". If you catch yourself drafting text that would end the turn while steps remain, make the tool call instead.

**Legitimate stops only:**
1. Spec gate returned DECISION items in Mode B without `--yes` — one grilling round, then end the turn (Step 2).
2. Spec gate still FAIL after 2 update rounds.
3. TDD gate FAIL.
4. A gate-fix loop reached its round limit with a CRITICAL left (never call a change with an open security CRITICAL done).
5. A hard error you cannot route around: `## ⏸ Implementation Paused` whose **Needs** is a user decision (if it is a fact, look it up and re-launch osf-apply once), `⛔ E2E stopped`, `## Archive Failed`, a worker cut twice.
6. The final step succeeded → Done.

### Full

`--no-tdd` / `--no-e2e` or a switched-off step: skip that step and its todo. The spec gate is never skipped.

**Step 1 — Spec.** Skill `proposal` with `CALLER_CONTEXT: autopilot-pipeline`. On `✅ Spec created: <change-name>` → TodoWrite + Agent `osf-spec-review`, zero text before them.

**Step 2 — Spec gate.** Brief: `Change name:`, `Decisions:` (the decision list verbatim), `Previous review:` (on a re-review).
- `Gate: PASS` → TodoWrite + Skill `tdd` with `<change-name> --parallel=<N>` and `CALLER_CONTEXT: autopilot-pipeline` (or Step 4 with `--no-tdd`).
- CRITICAL items → Skill `proposal` with `Change name:`, `Spec review findings:` (verbatim) and the caller context; re-run osf-spec-review with `Previous review:`. Max 2 update rounds.
- DECISION items → Mode A or `--yes`: take ★, add `Assumed: … (based on ★ default)` lines, update the spec as for CRITICALs. Mode B: print a short spec digest and the items as one grilling round (A/B/★/Khác, `"ok" = chấp nhận tất cả ★`), end the turn. On the user's answer: re-create the todo list if gone, add the answers to the decision list, update the spec, re-review, and on PASS continue non-stop.

**Step 3 — TDD gate.** On `✅ TDD gate passed: <change-name>` → TodoWrite + implement launch. `Gate: FAIL` → stop.

**Step 4 — Implement.** N = 1: one osf-apply with the change name, the test command from tdd.md, `Done = test command passes`, SCOPE DISCIPLINE and TEST LOCK. N > 1: the `apply` skill's PARALLEL FAN-OUT (use the exploration `Batch plan` when one exists): waves of up to N osf-apply, tick tasks.md after each wave, then run the full test command once and route failures to one sequential osf-apply fix brief (max 2 rounds). A `## ⛔ Scope Too Large` is re-dispatched the same way.

**Step 5 — Gates: security ‖ verify.** In one message: osf-security (`Change name:`, `Diff base:`) and osf-verify (`Change name:`, TEST LOCK). osf-verify checks code against the spec and runs the locked tdd tests. Then the **gate-fix loop**:
- Both green (security `Gate: PASS`, verify 0 CRITICAL) → Step 6.
- Any CRITICAL → one osf-apply fix brief with every security CRITICAL (fix the root cause server-side) and every verify CRITICAL, SCOPE DISCIPLINE, TEST LOCK (fan out per the `apply` skill when the fixes are file-disjoint and N > 1); then re-run BOTH gates in one message (`Previous review:` for security). Max 3 rounds.
- Carry every WARNING to Done.

**Step 6 — E2E.** Skill `e2e` with `<change-name>`, `CALLER_CONTEXT: autopilot-pipeline`, and `Setup approved: <cmd>` when the input carries one (the user approved an e2e framework install during brainstorm). It brings up the full local environment in production mode, writes UI and API journeys for every spec scenario, runs the stability gate and fixes app defects through osf-apply itself.
- `✅ E2E complete: … code changed no` → Step 7.
- `✅ E2E complete: … code changed yes` → the fixes may have broken something the gates checked: re-run Step 5's gates once (same loop rules, counting toward its 3 rounds), then Step 7.
- `⚠️ E2E skipped` → Step 7; the verdict becomes NOT READY.
- `⛔ E2E stopped` → stop.

**Step 7 — Archive.** Agent osf-archive with the change name and SCOPE DISCIPLINE. `## Archive Complete` → Step 8. `## Archive Failed` → stop: the code and gates are done, the change is not archived; print its Reason and `/osf archive <change-name>`.

**Step 8 — Knowledge.** Skill `knowledge` with `<change-name>`, `Diff base: <diff base>` and `CALLER_CONTEXT: autopilot-pipeline`. On `✅ Knowledge updated` → TodoWrite + Done. If it fails, report it as a warning — the change itself is complete.

### Verified

1. **Implement** — osf-apply with the plan context, no spec (N > 1 with file-disjoint batches: the `apply` skill's fan-out in plan mode, no tasks.md).
2. **Gates** — in one message: osf-verify with `Plan summary:` + the plan context and `Diff base:`; with security on, osf-security with the plan context and `Diff base:`.
3. **Fix loop** — as Full Step 5, max 3 rounds. 0 CRITICAL → Done. No archive or knowledge (no spec); mention `/osf knowledge --repo` in Done if the work changed how the system runs.

### Light

osf-apply with the plan context → Done, carrying osf-apply's `**Checks:**` line (its Self-check ran the tests covering its files).

---

## Done

**Full:**
```
## ✅ Autopilot Complete

**Change**: <change-name>
**Pipeline**: spec ✓ → spec gate ✓ → tdd ✓ → implement ✓ → security ‖ verify ✓ → e2e ✓ → archive ✓ → knowledge ✓
**Skipped**: <step (reason) | none>
**Rounds**: spec gate <n> · gates <n> · e2e fixes <n>
**Parallel**: max workers <N> · tdd <m> parts · implement <b> batches in <w> waves
**E2E**: spec coverage <c>/<t> · UI <n> · API <n> · production build yes|no · stability <N>/<N>

**Production verdict**: READY | NOT READY
<NOT READY when any applies — list each:>
- e2e skipped (`--no-e2e` or no framework while a journey exists), stability not reached, spec coverage below 100%, not a production build, or any journey env-blocked
- unspecified behaviors or test disputes from e2e
- a security WARNING the user has not accepted
- a verify WARNING about failing/unstable tests or env blockers
- an `Assumed:` decision tagged `★ default` that changes behavior, scope, data or cost and the user never confirmed (Mode A); `codebase:` assumptions never block; `research:` ones block only without clear consensus

**Assumed decisions** (blocking ones first, marked ⛔):
- <Assumed line with source tag | none>

**Knowledge**: <files updated>
**Evidence**: <e2e trace/screenshot paths, one per journey>
**Warnings**: <security, verify, e2e, knowledge warnings | none>
```
READY means every gate actually ran and passed — never report it to be agreeable.

**Verified:** `## ✅ Autopilot Complete` · `**Pipeline**: implement ✓ → [security ‖] verify ✓` · `**Skipped**:` · `**Verify rounds**:`

**Light:** `## ✅ Autopilot Complete` · `**Pipeline**: implement ✓` · `**Checks**: <osf-apply's Checks line>`

**Fix loop exhausted:**
```
## ⚠️ Autopilot: Persistent Issues

<n> rounds done; these CRITICALs remain:
- <issue>

→ Fix manually and run `/osf verify` again, or `/osf apply <name>` with guidance
```

## Guardrails

- IDENTITY GATE always — osf-apply writes code; every fix is followed by a re-run of the gate that found it
- Non-stop: the only stops are the six listed above
- Cold-start exploration at brainstorm depth; every autonomous decision grounded in the codebase or research and tagged
- Round limits: spec gate 2 · gates 3 · implement fixes 2 · e2e fixes 2 (inside the e2e skill)
- Announce each step so the user can follow progress
- Never commit

The following is the user's request:
