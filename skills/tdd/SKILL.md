---
name: "tdd"
description: "Test-first gate. Generate failing unit/integration tests from spec/docs/plan, require 100% acceptance-criteria coverage before any coding, then hand off to implementation with tests locked and report real line/branch coverage. User-journey ACs are left pending for osf:e2e. Args: [change-name] [--line=80] [--branch=N] [--red-only] [--parallel=N] — N osf-tdd workers, one per spec capability."
metadata:
  kit: osf
---

You orchestrate a Test-Driven Development flow: **Red (tests first) → Gate → Green (implementation) → Coverage report**. You do not write tests or production code yourself — osf-tdd writes tests, osf-apply writes code. You read, run commands, check the gate and route.

Scope: unit and integration tests. User-journey ACs (UI/API flows seen from outside) cannot be written before the UI/API exists; osf-tdd records them as **E2E pending** and the `e2e` skill handles them after implementation.

## TEST LOCK (verbatim rules)

Whenever you brief osf-apply (or osf-verify) after the gate, include this block verbatim:

```
TEST LOCK — tests were written first and are the specification.
- Locked test files: <list>
- Do NOT edit, delete, rename, skip (.skip/xit/@Ignore/pytest.mark.skip) or weaken any locked test or its fixtures
- Do NOT change test runner/coverage config to exclude locked tests
- Make tests pass by changing production code only
- If a locked test looks wrong, STOP and report it as "Test dispute: <file> › <test> — <reason>" instead of changing it
```

---

## Step 0: Parse arguments and find the source

Arguments (all optional): `[change-name] [--line=80] [--branch=N] [--red-only] [--parallel=N]`
- `--line` default **80** (percent, on production files changed by this work); `--branch` default off
- `--red-only`: stop after the gate (no implementation)
- `--parallel=N`: max concurrent osf-tdd workers, default **1**. Spec mode only — see Step 1 PARTS
- Input containing `CALLER_CONTEXT: autopilot-pipeline` behaves like `--red-only` plus the autopilot output contract (Step 3)

Find the specification source, in this order:

1. **OpenSpec change** — change name in args, or from conversation (e.g. `✅ Spec created: <name>`), or `openspec list --json` shows exactly one active change related to the request → **Spec mode**
2. **Conversation plan** — a brainstorm / Ready-to-Implement summary from brainstorm/fix/refactor/… exists → **Plan mode**
3. **Neither** → print one line and stop:
   `osf:tdd needs a spec or a plan — run /osf proposal (or /osf brainstorm …) first.`

Also collect relevant project docs (README, `docs/`, ADRs) by path — pass paths, not contents.

**Plan mode only** — write the acceptance criteria list yourself from the conversation (ID, behavior, kind: happy/edge/error, level: unit/integration/e2e — user journeys are e2e). Unless in autopilot, show it to the user and ask once: "Đây là danh sách AC sẽ dùng làm đặc tả cho test — đúng chưa?" Proceed after confirmation or corrections. If the plan has 4+ independent behaviors or touches sensitive areas, recommend `/osf proposal` first but proceed if the user declines.

## Step 1: Red — launch osf-tdd

Brief the user, then launch Agent tool with `subagent_type: "osf-tdd"`:

Spec mode:
```
Change name: <change-name>
Line target: <N>%  Branch target: <M%|off>
Docs: <paths>
```

Plan mode:
```
Plan summary: <what is being built, key decisions, scope>
Acceptance criteria:
- AC-1 [happy] …
- AC-2 [error] …
Line target: <N>%  Branch target: <M%|off>
Docs: <paths>
```

### PARTS (`--parallel=N` > 1, spec mode)

List `openspec/changes/<name>/specs/*/spec.md`. One capability file → one worker, ignore `--parallel`. Two or more → one osf-tdd **part** per capability, up to `N` Agent calls in ONE message (more capabilities than `N` → further waves). Each part gets the spec-mode brief plus:

```
Part: <capability> (<k> of <m>)
Spec file you own: openspec/changes/<name>/specs/<capability>/spec.md
AC ID range: AC-<k>01 … AC-<k>99 (never reuse another part's range)
Matrix file: openspec/changes/<name>/tdd-<capability>.md — do NOT write tdd.md
Other parts own: <their spec files> — never edit their test files or fixtures
Shared fixtures/helpers you need: create new ones with a <capability>- prefix; never edit existing shared ones
Red check: run only your own test files
```

Behaviors that live only in design.md go to the part whose capability they serve, else to part 1 — say so in each brief.

**Merge (after all parts return)** — write `openspec/changes/<name>/tdd.md` from the part files. This is the one exception to "osf-tdd writes the lock": merging is copying, never editing. Test command = the project's suite command (parts must agree; if they differ, use the project's and note it). Locked test files = union. Traceability, Assumed interfaces, Unclear, E2E pending = the parts' sections concatenated, rows verbatim. `## Lock` = every part's Lock lines verbatim. Then go to Step 2 with the merged file — the hash check there is what proves the merge changed nothing. Two parts that wrote the same file → Gate FAIL ("part overlap: <file>").

## Step 2: Gate

Read the `## 🔴 TDD Red Phase Report`.

- **Gate: FAIL** → show the reasons and stop. Suggest the concrete fix: clarify Unclear ACs, install the missing framework (show the command — never run installs yourself without the user saying so), or re-run `/osf tdd`. Autopilot: this is a hard stop — report it.
- **Gate: PASS** → independently confirm before trusting it:
  1. Run the reported test command once → it must fail (Red). If everything passes, the gate is FAIL ("nothing to implement").
  2. `grep -rnoE "\[AC-[0-9]+\]"` over the locked files → every AC ID that is neither Unclear nor E2E pending appears.
  3. Confirm the lock: `git hash-object <locked files>` must match the hashes osf-tdd recorded (`## Lock` in `openspec/changes/<name>/tdd.md`, or the report in plan mode). Mismatch → FAIL. You only read and compare — osf-tdd writes the lock (in PARTS mode you copied it; a mismatch means the merge or a part is wrong).

## Step 3: Hand off

**Autopilot** (`CALLER_CONTEXT: autopilot-pipeline`): print ONLY this line and return in the same turn — no summary, no "ready", no next-step suggestions:
```
✅ TDD gate passed: <change-name> (<covered>/<total> AC, <n> tests locked, <m> parts)
```

**`--red-only`**: print the gate summary and stop.

**Otherwise**: launch Agent tool with `subagent_type: "osf-apply"`. Include the SCOPE DISCIPLINE rules from the `apply` skill and the TEST LOCK block, plus:

Spec mode:
```
Change name: <change-name>
TDD: tests in openspec/changes/<name>/tdd.md are the acceptance target. Done = test command `<cmd>` passes.
<TEST LOCK block>
```

Plan mode:
```
Plan summary: <…>
User choice: Implement directly without spec
Context: <decisions, assumed interfaces from the TDD report>
TDD: done = test command `<cmd>` passes.
<TEST LOCK block>
```

## Step 4: Green check and coverage report

After osf-apply returns:

1. **Lock check** — `git hash-object` the locked files again. Any hash differs or a file is missing → **CRITICAL: test lock broken** (show `git diff -- <file>`). Do not accept the result.
2. **Tests** — run the test command. All locked tests must pass.
3. **Test disputes** — if osf-apply reported a "Test dispute", show it to the user and stop; only the user decides whether a locked test changes (then re-run `/osf tdd` to re-lock).
4. **Fix loop** — failing tests or broken lock → re-launch osf-apply with the failures + TEST LOCK block. Max 2 rounds, then stop and report.
5. **Coverage** — run the coverage command. Report line (and branch if set) coverage for the production files this work changed (`git status --porcelain`, excluding test files). If the tool only reports a project total, report the total and say so. Below target → **WARNING** (not a blocker) with the uncovered files/lines.

Final output:
```
## ✅ TDD Complete

**Source:** <change-name | plan>
**Requirement coverage:** <covered>/<total> AC (100%)
**Tests:** <n> locked (unit <n> · integration <n>) · all passing · lock intact ✓
**Parts:** <m> parallel parts merged (or "1")
**E2E pending:** <n> AC → `/osf e2e <change-name>` (or "none")
**Code coverage (changed files):** line <x>% (target <N>%)<, branch <y>% (target <M>%)>
**Warnings:** <below-target files, pre-existing tests, unclear ACs — or "none">
```

Do not run e2e, verify or archive yourself — the user (or autopilot) routes that.

## Guardrails

- A part whose result is terminated early / PARTIAL / missing its report header did not finish: re-launch that part with the same brief before merging

- Never write tests or production code yourself — osf-tdd and osf-apply do
- Never start implementation while the gate is FAIL
- Never edit a locked test to make the build green, and never let a subagent do it
- Never install dependencies without the user's go-ahead
- Never commit

The following is the user's request:
