---
name: "fix"
description: "Fix a bug: reproduce it with a red-capable command, find the root cause, lock the plan, then run the chosen flow (direct, auto or Full with tdd, verify, e2e)."
metadata:
  kit: osf
---

You are investigating and fixing a bug. This command helps you trace the root cause, assess the fix scope, and decide on the best implementation path.

BEFORE PROCEEDING: You MUST use the Skill tool to invoke "explore" unless the caller context explicitly says shared explore mode has already been loaded for this request. This loads the shared explore mode behavior (stance, verification, workflow, subagent protocols, OpenSpec awareness, guardrails) that this command depends on. Do not proceed until explore is loaded exactly once.

---

## Reproduce First (feedback loop)

Adapted from the `diagnosing-bugs` skill in mattpocock/skills (MIT).

Before theorizing about the cause, get a **red-capable command**: one command that drives the real bug path and checks the user's exact symptom, so it fails now and will pass once fixed. With it, every hypothesis can be tested by running instead of guessing.

Try, roughly in this order, using only commands that do not modify files (explore mode):
1. An existing test, or the existing suite filtered to the affected area
2. `curl` / HTTP call against a running dev server
3. CLI invocation with a fixture input, compared against expected output
4. Browser reproduction via the `browser` skill
5. Replaying a captured request, payload or log

If the bug is a regression between two known states, do NOT run `git bisect` in explore mode (it moves HEAD and touches the working tree). Make a bisect harness (`git bisect run <cmd>`, clean tree, `git bisect reset` afterwards) step 1 of the plan instead.

The command must be **red-capable** (asserts the user's symptom, not "didn't crash"), **deterministic** (for flaky bugs: a pinned, high reproduction rate — loop it, add stress), and **fast** (seconds, not minutes). Run it at least once and show the invocation and its output.

**Redact secrets** in everything you show: write `<REDACTED>` in place of tokens, keys, cookies and auth headers.

If a red-capable command needs a new test or script, you cannot write it in explore mode. Make it **step 1 of the implementation plan**: "write a failing repro test at <seam>, run it, confirm it fails with the user's symptom, only then fix". Name the repro test's file path under **Files/areas** — osf-apply only touches files the plan names. Mark the root cause as `unconfirmed by runtime` until that step has run.

If no loop is possible at all (needs production data, a device, a third-party account), say so explicitly, list what you tried, and ask the user for access, a redacted artifact (log, HAR, screenshot with timestamps), or permission to add temporary instrumentation. In autopilot, do not ask — proceed with code tracing and mark the root cause `unconfirmed by runtime`.

**Hypotheses:** before testing any, write **3–5 ranked, falsifiable hypotheses** ("if X is the cause, then changing Y makes the bug disappear"). Show the ranked list to the user — they often know which one was just deployed or already ruled out (in autopilot, show it without waiting for an answer). Then test them against the loop, one variable at a time.

---

## Debugging Toolkit

You have methods, not steps. Pick what fits the bug. The goal is always: reach the exact line that causes the failure, not just the right file or function.

### Tool Priority Chain

Use the right tool at the right scope:

1. **codebase-retrieval** (semantic search) — FIRST CHOICE. Use when you need to understand where something is handled, find related code, or locate unfamiliar areas. Examples: "where is authentication handled?", "what validates user input before save?", "how does the payment flow work?"
2. **grep** (pattern search) — SECOND. Use for exact matches: variable writes, function calls, error strings, config keys, imports. Examples: `grep for "userId ="` to find all writes, `grep for "throw.*NotFound"` to find error origins.
3. **read** (file inspection) — THIRD. Use once you know WHERE to look. Read the suspect function, trace its logic line by line.

Wide → narrow → precise. Don't read files blindly — search first, then read what matters.

### Methods

**Backward Reasoning** — Start from the error, trace back to the source.
When to use: You have an error message, stack trace, or wrong output.
How: Identify the exact line and variable involved in the failure → grep for all assignments to that variable → read each write site → determine which could produce the bad value → trace its inputs backward the same way. Stop when you find a write that receives bad input from an external source or a logic error that produces the wrong value.

**Wolf Fence (Binary Search)** — Bisect the call chain to narrow scope fast.
When to use: Long call chains, bug symptom is far from cause, or you don't know where to start.
How: Define the full scope (entry point → failure point) → identify the midpoint of the call chain → read that code and check whether the data is already corrupted there → recurse into the broken half. Each read cuts the search space in half.

**Five Whys** — Each answer becomes the next search query.
When to use: Cascading failures, bugs that manifest far from their origin.
How: State the symptom precisely → ask "why does this happen?" → search for the immediate cause → treat that cause as the new symptom → repeat. Each "why" is a targeted codebase-retrieval or grep, building a causal chain through the codebase. Stop when you reach something that cannot be explained by another code path (missing guard, wrong default, misunderstood API contract). Fix at the root, not at the symptom.

**Rubber Duck Narration** — Narrate suspect code line-by-line, flag where narration diverges from code.
When to use: You've located the suspect function but the bug isn't obvious.
How: State the function's contract (what it receives, what it must return) → walk each line and narrate what it does in plain language → at each step ask "does this match the contract?" → the first line where narration and code diverge is the bug. This exposes assumption mismatches that scanning misses.

**Scientific Method** — Form a falsifiable hypothesis, then try to DISPROVE it.
When to use: Multiple plausible causes, or you suspect confirmation bias.
How: Observe the failure precisely → form a specific hypothesis ("the bug is caused by X because Y") → derive a prediction ("if true, the code at Z will contain/lack P") → read that code and check → if prediction fails, falsify and form a new hypothesis → if prediction holds, narrow further. The discipline is: you must attempt falsification before accepting any explanation.

**Mental Mutation** — "What if this `>` were `>=`?"
When to use: You've found the suspect expression but aren't sure what's wrong.
How: Enumerate plausible mutations of the suspect code (flip comparisons, change return values, remove guards, swap arguments) → for each, reason: "would this mutation produce the observed failure?" → the mutation that best explains all symptoms points to the bug.

**Delta Debugging** — Bisect changes between known-good and current-failing state.
When to use: Regressions where a set of commits introduced the bug.
How: Identify the full diff between last-known-good and current state → split the change set in half → reason about whether each half could cause the failure → recurse into the failure-inducing half → repeat until a minimal set of changes is identified. Use `git log` and `git diff` to navigate.

**Suspiciousness Ranking** — When multiple stack traces exist, rank by failure frequency.
When to use: Multiple failing tests or error reports with stack traces.
How: Collect all stack traces → identify functions that appear in every failing case → cross-reference with passing cases to filter out shared functions → rank remaining by frequency in failing traces → read the top-ranked functions first. Functions in ALL failures but NO successes are the prime suspects.

### Anti-patterns

- Don't theorize without reading code — every hypothesis must be checked against actual source
- Don't stop at the first plausible explanation — attempt falsification at least once
- Don't read files blindly — search semantically first, then read what the search points to
- Don't fix the symptom — if you haven't traced a causal chain from root to symptom, you haven't found the root cause
- Don't accept file-level localization — drive to the exact line. The right file but wrong function produces wrong patches

---

## What You Might Do

**Explore the problem space**
- Feynman Echo — restate the bug in the simplest possible language, then ask user to confirm or correct
- Ask clarifying questions that emerge from what they said
- Challenge assumptions
- Reframe the problem

**Compare fix options**
- Brainstorm multiple fix approaches
- Build comparison tables
- Sketch tradeoffs
- Recommend a path (if asked)

**Visualize**
Diagram (ASCII) when it helps: Causal chains, state machines, data flows, dependency graphs, before/after comparisons

**Research external knowledge**
- When discussion involves technology choices, best practices, or security concerns → delegate to osf-researcher

**Surface risks and unknowns**
- Identify what could go wrong with the fix
- Find gaps in understanding
- Suggest spikes or investigations

---

## Stress-test Questions

Resolve these before ending discovery. Self-answer by exploring the codebase. Only surface items to the user that are genuinely ambiguous or require a personal/team style choice:

1. Regression risks:
   "Could this fix break anything else:
    A. No — isolated change
    B. Maybe — need to check related code
    C. ★ Likely — need comprehensive testing
    D. Khác/Other: ___"

2. Edge cases:
   "For [input/data], edge cases to handle:
    A. Empty/null — show empty state
    B. Too long — truncate at N chars
    C. Special characters — sanitize
    D. ★ All of the above
    E. Khác/Other: ___"

3. Test strategy:
   "Test level needed:
    A. Unit tests for the fix
    B. Unit + integration tests
    C. ★ Unit + integration + regression tests
    D. Khác/Other: ___"

4. Architecture decisions:
   "Error handling strategy for this fix:
    A. Throw exceptions, catch at boundary
    B. Result/Either pattern (no exceptions)
    C. Error codes + error handler
    D. ★ Follow existing project pattern: [detected pattern]
    E. Khác/Other: ___"

---

## Zero-Fog Checklist (additions)

- [ ] A red-capable repro command was run and shown failing with the user's symptom — or building it is step 1 of the plan and the root cause is marked `unconfirmed by runtime`
- [ ] The plan says to re-run the repro command after the fix and see it pass
- [ ] Root cause is identified and verified in code (not just a symptom)
- [ ] Causal chain from root cause to observable symptom is traceable in code (not theoretical)
- [ ] At least one alternative hypothesis was explicitly considered and falsified
- [ ] Fix approach is specific enough for a verifier to objectively check
- [ ] All edge cases are explicitly named (not "handle edge cases" — which ones?)
- [ ] Error paths are defined for every operation that can fail
- [ ] Regression risks identified and mitigation strategy defined
- [ ] Test strategy decided (unit? integration? regression? which functions need edge case tests?)

The following is the user's request: