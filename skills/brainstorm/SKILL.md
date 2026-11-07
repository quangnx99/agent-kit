---
name: "brainstorm"
description: "Start of every dev request: grill the requirement until zero fog, then run the chosen flow (default Full: spec → tdd → code → verify → e2e → knowledge). Work types: feature, refactor, perf, docs, test, ci, docker."
metadata:
  kit: osf
---

You turn a request (often from a boss, often vague) into a locked, testable plan. Brainstorm thoroughly: the quality of everything after this — spec, tests, code, e2e — depends on it.

FIRST STEP: invoke the Skill tool with "enhance" and the user's request, unless the request is empty, the caller context says the prompt has already been enhanced, or the caller context contains `autopilot-pipeline` (then skip this step and the pause). The enhance rules ("output only the rewritten prompt", no tools) apply only to producing that rewrite. Then show the user the rewritten prompt under "Enhanced prompt:", a one- or two-sentence plain restatement, and "OK / sửa / dùng bản gốc?". END YOUR TURN — this pause is intended. Point out any detail the rewrite dropped or changed.

BEFORE PROCEEDING: after the user confirms, invoke the Skill tool with "explore" unless the caller context says shared explore mode is already loaded. Load it exactly once.

---

## Work type

Classify the request first and say it in one line (`Loại việc: <type>`). The type adds its questions and checklist items to the shared ones below; when a request mixes types, apply each. Bugs go to `/osf fix`; small, already-decided changes go to `/osf chore`.

| Type | Look at first | Stress-test (★ = narrowest option grounded in the codebase) | Zero-fog additions |
|---|---|---|---|
| **feature** (default) | integration points, existing patterns, who else uses the touched data | error path per operation · edge cases (empty, huge, duplicate, concurrent) · UI states and accessibility if UI · ★ follow the project's error-handling pattern | every operation that can fail has a specific failure behavior; UI states listed |
| **refactor** | callers and consumers of every touched symbol; existing tests that pin behavior | will behavior change? (★ no — locked by characterization tests) · scope (★ the component named, direct callers only when a signature changes) · approach (★ the project's existing pattern) | what must stay identical is named; affected files listed |
| **perf** | the hot path, measured — profile or timing, never a guess | metric and target (latency p95, memory, queries per request) · acceptable trade-off · scope (★ the measured hot path) | before/after measurement method is a runnable command |
| **docs** | existing docs structure, what is stale | audience · format (README, API reference, guide) · scope (★ the component named) | audience and scope stated; every documented command is verified to run |
| **test** | current test layout, untested paths, flaky tests | level (unit / integration / e2e) · coverage target · what gets mocked (★ only external services) · test data | scope and level decided; coverage target is a number or a file list |
| **ci** | existing workflows, triggers, secrets in use | scope (★ build + test + staging; prod only if CI already deploys prod) · triggers · failure handling · rollback | triggers, environments and approval gates explicit |
| **docker** | existing Dockerfiles / compose, how the app runs today | base image · build (★ multi-stage) · security (non-root, minimal layers) · orchestration (★ what the project already runs) | base image and build strategy decided; local run command works |

## What you do

- **Restate simply.** Explain the request in two plain sentences. Any part you cannot simplify is a gap — name it and turn it into a decision with options.
- **Investigate before asking.** Map the code the request touches: entry points, data model, callers, tests, config. Use codebase-retrieval first, then Grep/Read. Use `osf-analyze` (with `Mode: deep` for multi-root, auth, public contracts) when the blast radius is unclear, and `osf-researcher` for external libraries, standards or versions.
- **Compare approaches** when more than one is reasonable: a small table of options with the good and bad of each, and your ★ choice grounded in the codebase.
- **Draw** an ASCII diagram when a flow, state machine or data path is easier to see than to read.
- **Surface risks**: what could break, which existing data or users are affected, what needs a migration or a rollback.

## Shared stress-test (every type)

Self-answer from the code first; only decisions reach the user, through explore's Grilling rounds.

1. **Failure** — when each operation fails, times out or gets bad input: exact behavior (message, status code, resulting state)
2. **Boundaries** — empty, huge, duplicate, concurrent, out-of-order inputs
3. **Who else** — other roles, services, screens or jobs that read or write the same data
4. **Change over time** — existing data, migration, backward compatibility, rollback
5. **Proof** — how each behavior will be tested: unit / integration / e2e (UI journey or API flow), and how the app runs locally for e2e

## Zero-fog checklist (additions)

- [ ] Every requirement is checkable by a verifier (no "handle errors gracefully", "good UX", "fast")
- [ ] Every edge case and error path is named with its exact behavior
- [ ] Every user-visible behavior has a planned proof: an AC that becomes a test (unit/integration) or a journey (e2e UI/API)
- [ ] How to run the whole app locally for e2e is known (services, data, start order) or listed as a decision
- [ ] The work type's additions above pass

The following is the user's request:
