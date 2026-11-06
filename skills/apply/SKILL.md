---
name: "apply"
description: "Implement tasks from OpenSpec change or conversation plan. Use when the user wants to start implementing, continue implementation, or work through tasks. Args: [change-name] [--parallel=N] — N concurrent osf-apply workers on file-disjoint batches."
metadata:
  kit: osf
---

SCOPE DISCIPLINE

Parallel sessions may share this branch. When briefing osf-apply, include these rules verbatim so the subagent has them in its prompt:

- Scope = files in the change's tasks.md / proposal.md / design.md, plus files the caller named in this input
- Never delete or edit files outside scope, for any reason
- Lint/test/type failures in unowned files → report, do NOT auto-fix by editing or deleting
- Want to delete something? Surface to the caller — the user does deletions manually
- Unfamiliar code = another session's in-progress work, not garbage. No evidence of ownership → no destructive action

TDD LOCK

If `openspec/changes/<change-name>/tdd.md` exists, or the conversation contains a passed `osf:tdd` gate, the tests were written first. Add to the brief: the test command (and the E2E command if an `## E2E` section exists), `Done = test command passes`, and the TEST LOCK block from the `tdd` skill with every locked file from tdd.md — `Locked test files` and `Locked e2e files` (or the conversation).

PARALLEL FAN-OUT (`--parallel=N`)

`N` = max concurrent osf-apply workers. Default **1** — one osf-apply, exactly today's behavior. Fan-out starts when `N > 1`, or when a single osf-apply returns `## ⛔ Scope Too Large — Split Requested` (then use its suggested batches as the starting point and `N` = number of independent batches, max 4 unless the user set `--parallel`).

Same working tree, no worktrees. Safety comes from three rules: batches own disjoint files, workers never touch tasks.md, workers never run the full suite.

1. **Partition by file, not by task.** From tasks.md (or the plan) build batches: task IDs + the files each will create or edit. When the spec does not say which files a task touches, ask osf-analyze (`Mode: quick`, one call per unclear area, all in the same message) before partitioning.
2. **No overlap.** Two batches that share a file are not independent — merge them or run them in different waves. Files every batch would touch (barrel exports, route registration, DI container, migration index, shared config) go to the LAST wave as their own batch — or to the FIRST wave as a scaffold batch that writes them in final form against stub modules (final signatures, bodies that throw `not implemented`); each later batch then owns its stub file and never touches the shared file. Use scaffold-first when the shared file only wires modules together; use last-wave when its content depends on what the batches build.
3. **Waves.** Independent batches form a wave. A batch that needs another batch's output (a new interface, a new table) runs in a later wave.
4. **Launch a wave** as up to `N` Agent calls in ONE message, each `subagent_type: "osf-apply"`, foreground (never `run_in_background`). Every brief carries SCOPE DISCIPLINE, the full TEST LOCK block (every locked file, in every batch), the change name or plan context, and this block:
   ```
   Batch: <A> (wave <1> of <2>)
   Tasks: <task IDs with their text, verbatim from tasks.md>
   Files you own: <the only files you may create or edit>
   Owned by other batches in this wave: <files> — never edit, never fix their errors
   Interfaces from earlier waves: <symbol — file — signature, or none>
   Do NOT edit tasks.md — list finished task IDs in your report; the orchestrator ticks them
   Run only tests that cover your own files — never the full suite
   ```
5. **After each wave** read every `## ✅ Batch <X> Complete` report. Tick `- [ ]` → `- [x]` in tasks.md for the task IDs reported done. This is bookkeeping, not a code change: it is the one Edit the orchestrator makes, and the only file it touches. A worker whose result says it was terminated early or is PARTIAL (rate limit, API error, no `## ✅ Batch` header) did not finish: re-launch that one batch with the same brief before the next wave — never tick its tasks from a partial report. A batch that reports a blocker or a `Test dispute` → stop launching waves and surface it. `Needs file:` for a file no batch owns → add that file and the unfinished tasks as a new batch in the next wave; if another batch owns it, stop and surface the overlap. Otherwise launch the next wave, passing forward the interfaces earlier batches created.
6. **After the last wave** run the project's full test command once (plus the tdd.md test command when it exists). Failures → one sequential osf-apply fix brief naming the failing tests and the files involved, with the TEST LOCK block. Max 2 fix rounds. Then report once:
   ```
   ## ✅ Implementation Complete

   **Change:** <change-name | plan>
   **Progress:** N/N tasks complete ✓
   **Parallel:** <b> batches in <w> waves, max <N> workers
   **Full test run:** <command> → pass | <n> failing after <r> fix rounds
   ```

Before launching the subagent, gather context from the current conversation:

1. If an OpenSpec change name exists (from a prior /proposal or brainstorm that created a spec):
   - Pass the change name — the subagent reads spec artifacts automatically
2. If no spec but there's a conversation plan (from /brainstorm, /fix, etc.):
   - Summarize: what was discussed, key decisions, requirements, scope
3. If user provides explicit arguments:
   - Pass those directly

Brief the user, then launch Agent tool with `subagent_type: "osf-apply"` (one call when `N` = 1; otherwise wave 1 of PARALLEL FAN-OUT above).

Pass context using this format:

With spec:
```
Change name: <change-name>
```

Without spec:
```
Plan summary: [what was discussed]
User choice: Implement directly without spec
Context: [key decisions, requirements, scope]
```