# OSF kit

OpenSpec-flow skills and agents for Claude Code: brainstorm a request thoroughly, then spec → tdd → code → verify → e2e → knowledge. `/osf:osf list` prints the current catalog.

Marketplace `osf-kit`, plugin `osf`, `source: "./"`.

## Install

```bash
claude plugin marketplace add quangnx99/osf-kit && claude plugin install osf@osf-kit
```

Claude Code TUI (if the marketplace is not registered yet):

```text
/plugin marketplace add quangnx99/osf-kit
/plugin install osf@osf-kit
```

Then: `/osf:osf list` · `/osf:brainstorm …`

## Update

```bash
claude plugin marketplace update osf-kit
claude plugin update osf@osf-kit
```

Then restart Claude Code or run `/reload-plugins`.

Version is pinned in `plugin.json`. Bump it on every release or users will not get the new tree.

## Flow

One request from start to handover:

```
/osf brainstorm <request>
  → grill until zero fog → teach-back → "Ready to Implement"
  → C. ★ Full:
     spec → spec gate → tdd (failing tests) → code
          → security ‖ verify (code vs spec, tdd tests green)
          → e2e (full local environment, production build, UI + API, stability gate)
          → archive → knowledge (CLAUDE.md + docs/knowledge/)
```

Spec comes before tdd on purpose: every spec scenario (WHEN/THEN) becomes an acceptance criterion, and every criterion becomes a failing test. The spec gate checks the spec before any test is written, and verify checks the code against both.

Other paths at the same menu: **A. Làm luôn** (small work: code → verify) and **B. Auto** (autopilot picks the shortest chain that still verifies). Bugs start with `/osf fix`; small, already-decided changes with `/osf chore`.

## Kit

Daily: brainstorm (feature, refactor, perf, docs, test, ci, docker), fix, chore

Flow: autopilot, proposal, tdd, apply, verify, e2e, archive, knowledge

Investigate: analyze, review, gap-audit, browser

Tools: git, indexing, agents, enhance

Internal: explore, osf

Agents: osf-analyze, osf-apply, osf-archive, osf-e2e, osf-gap-audit, osf-knowledge, osf-researcher, osf-security, osf-spec-review, osf-tdd, osf-verify

A full security audit of a whole repo is not part of this kit — use the `security-audit` skill.

## Parallel

Stages stay in order; fan-out happens inside a stage, in the same working tree.

- `/osf:apply <change> --parallel=N` — N osf-apply workers on file-disjoint batches, waves for dependencies, orchestrator ticks tasks.md
- `/osf:tdd <change> --parallel=N` — one osf-tdd part per spec capability, merged into tdd.md
- `/osf:autopilot … --parallel=N` — fans out analyze, tdd and implement; osf-security ‖ osf-verify always run together

## Autopilot verdict

Full ends with **READY** or **NOT READY**. NOT READY whenever e2e was skipped, did not reach the stability gate, covered less than 100% of the spec scenarios, or ran without a production build; or when a security/verify warning is open. Run cold (`/osf:autopilot <request>`), autopilot decides alone and tags each `Assumed:` line with its source: `codebase:`, `research:` or `★ default`; only unconfirmed `★ default` choices that change behavior, scope, data or cost block READY, listed first and marked ⛔.

## Knowledge

The last step writes what the next person needs, from verified facts only (commands that exist or ran, paths that exist, env var names never values):

- `CLAUDE.md` — a managed section between `<!-- osf:knowledge:start -->` and `<!-- osf:knowledge:end -->`: stack, layout, working commands, conventions, gotchas
- `docs/knowledge/architecture.md` — modules, data flows, where to start reading
- `docs/knowledge/local-env.md` — the whole system locally, production-like (from the e2e environment runbook)
- `docs/knowledge/decisions.md` — one entry per change: the decisions that will matter later

Run it alone with `/osf:knowledge <change>` or `/osf:knowledge --repo`.

## Agent visualizer

`/osf:agents` (or `node bin/agents-viz/server.mjs [--no-open] [--port=N] [--project=<dir>]`) opens `http://127.0.0.1:4317` (next free port up to 4330; a second call reuses the running server).

- **Header:** one picker for project and session.
  - Sessions are newest first, and a spinner marks a live one.
  - Only projects and sessions that ran osf agents (`osf-*`) are listed; agents of other kits and built-in agents (Explore, general-purpose…) do not count.
  - A running session updates live; a past one replays.
- **Left pane, top:** where the run is ("Coding · vòng 4", "Dừng ở Coding", "Hoàn tất").
  - Next to it: the skill, agent count, start time and duration.
  - Chips count running, stalled and cut agents.
- **Round tabs** (`Vòng 1 … n`): shown when a fix loop happened.
  - Pick a round to see its agents.
  - An earlier round notes why it looped ("Security, Verify báo lỗi → sửa ở vòng 2").
- **Steps:** listed top to bottom, Spec → Spec gate → TDD → Coding → Security ‖ Verify (marked `song song`) → E2E → Archive → Knowledge. A fix round starts again at Coding after the gates or after E2E.
  - Each step's agents are nested under it, stalled and cut agents first.
  - Skipped steps are hidden. Agents outside the pipeline sit under `Khác`.
  - A session without an osf pipeline groups its agents by wave (`Đợt n`); agents in one wave ran in parallel.
- **Right pane:** the selected agent. By default it is the one that most needs a look: stalled, then cut, then running. It shows:
  - what the agent is doing now (live);
  - the report, rendered as Markdown with lists, tables and code blocks;
  - the last 5 tool calls;
  - the brief, collapsed.

  Below 1024px the detail opens as a drawer, and Esc closes it.
- **Status** (icon + text): Đang chạy, Xong, Bị cắt (API or rate-limit error, or no final report), Đứng im (no write for >10 min). An unfinished agent with no write for 2–10 min still shows as running.
- **Look:** flat, follows light/dark mode, respects reduced motion, keyboard and screen-reader friendly. Layout and tokens are in `bin/agents-viz/DESIGN.md`.

Read-only: it reads `~/.claude/projects/**` transcripts, binds 127.0.0.1 only, needs no hooks and no dependencies (Node only).

Tests: `npm test`.
