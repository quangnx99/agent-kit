# Agent kit

OpenSpec-flow skills and agents for Claude Code: brainstorm a request thoroughly, then spec → tdd → code → verify → e2e → knowledge. `/agent:agent list` prints the current catalog.

Marketplace `agent-kit`, plugin `agent`, `source: "./"`.

## Install

```bash
claude plugin marketplace add quangnx99/agent-kit && claude plugin install agent@agent-kit
```

Claude Code TUI (if the marketplace is not registered yet):

```text
/plugin marketplace add quangnx99/agent-kit
/plugin install agent@agent-kit
```

Then: `/agent:agent list` · `/agent:brainstorm …`

## Update

```bash
claude plugin marketplace update agent-kit
claude plugin update agent@agent-kit
```

Then restart Claude Code or run `/reload-plugins`.

Version is pinned in `plugin.json`. Bump it on every release or users will not get the new tree.

## Flow

One request from start to handover:

```
/agent brainstorm <request>
  → grill until zero fog → teach-back → "Ready to Implement"
  → C. ★ Full:
     spec → spec gate → tdd (failing tests) → code
          → security ‖ verify (code vs spec, tdd tests green)
          → e2e (full local environment, production build, UI + API, stability gate)
          → archive → knowledge (CLAUDE.md + docs/knowledge/)
```

Spec comes before tdd on purpose: every spec scenario (WHEN/THEN) becomes an acceptance criterion, and every criterion becomes a failing test. The spec gate checks the spec before any test is written, and verify checks the code against both.

Other paths at the same menu: **A. Làm luôn** (small work: code → verify) and **B. Auto** (`auto` picks the shortest chain that still verifies). Bugs start with `/agent fix`; small, already-decided changes with `/agent chore`.

## Kit

Daily: brainstorm (feature, refactor, perf, docs, test, ci, docker), fix, chore

Flow: auto, proposal, tdd, apply, verify, e2e, archive, knowledge

Investigate: analyze, review, gap-audit, browser

Tools: git, indexing, monitor, enhance

Internal: explore, agent

Agents: agent-analyze, agent-apply, agent-archive, agent-e2e, agent-gap-audit, agent-knowledge, agent-researcher, agent-security, agent-spec-review, agent-tdd, agent-verify

A full security audit of a whole repo is not part of this kit — use the `security-audit` skill.

## Parallel

Stages stay in order; fan-out happens inside a stage, in the same working tree.

- `/agent:apply <change> --parallel=N` — N agent-apply workers on file-disjoint batches, waves for dependencies, orchestrator ticks tasks.md
- `/agent:tdd <change> --parallel=N` — one agent-tdd part per spec capability, merged into tdd.md
- `/agent:auto … --parallel=N` — fans out analyze, tdd and implement; agent-security ‖ agent-verify always run together

## Auto verdict

Once auto starts (B, C, or `/agent:auto`), it never asks again until Done: every remaining decision is taken by the decision list, the codebase, research or ★, and logged as an `Assumed:` line; anything it cannot resolve becomes a ⛔ blocker in the final report while the rest of the chain keeps running.

Full ends with **READY** or **NOT READY**. NOT READY whenever e2e was skipped, did not reach the stability gate, covered less than 100% of the spec scenarios, or ran without a production build; or when a security/verify warning is open. Run cold (`/agent:auto <request>`), auto decides alone and tags each `Assumed:` line with its source: `codebase:`, `research:` or `★ default`; only unconfirmed `★ default` choices that change behavior, scope, data or cost block READY, listed first and marked ⛔.

## Knowledge

The last step writes what the next person needs, from verified facts only (commands that exist or ran, paths that exist, env var names never values):

- `CLAUDE.md` — a managed section between `<!-- agent:knowledge:start -->` and `<!-- agent:knowledge:end -->`: stack, layout, working commands, conventions, gotchas
- `docs/knowledge/architecture.md` — modules, data flows, where to start reading
- `docs/knowledge/local-env.md` — the whole system locally, production-like (from the e2e environment runbook)
- `docs/knowledge/decisions.md` — one entry per change: the decisions that will matter later

Run it alone with `/agent:knowledge <change>` or `/agent:knowledge --repo`.

## Agent visualizer

`/agent:monitor` (or `node bin/agents-viz/server.mjs [--no-open] [--port=N] [--project=<dir>]`) opens `http://127.0.0.1:4317` (next free port up to 4330; a second call reuses the running server).

- **Header:** one picker for project and session.
  - Sessions are newest first, and a spinner marks a live one.
  - Only projects and sessions that ran kit agents (`agent-*`) are listed; agents of other kits and built-in agents (Explore, general-purpose…) do not count.
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
  - A session without an kit pipeline groups its agents by wave (`Đợt n`); agents in one wave ran in parallel.
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
