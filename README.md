# OSF kit

32 OpenSpec-flow skills and 15 supporting agents for Claude Code and OMP.

Marketplace `osf-kit`, plugin `osf`, `source: "./"`.

## Install

```bash
# Claude Code
claude plugin marketplace add quangnx99/osf-kit && claude plugin install osf@osf-kit

# OMP
omp plugin install github:quangnx99/osf-kit
```

Claude Code TUI (if the marketplace is not registered yet):

```text
/plugin marketplace add quangnx99/osf-kit
/plugin install osf@osf-kit
```

Restart the OMP session after install.

- Claude Code: `/osf:osf list` · `/osf:brainstorm …`
- OMP: `/skill:osf list` · `/skill:osf brainstorm …`

## Update

```bash
# Claude Code
claude plugin marketplace update osf-kit
claude plugin update osf@osf-kit

# OMP (reinstall from git; same command as install)
omp plugin install github:quangnx99/osf-kit
```

Restart the OMP session after update. Claude Code: restart or `/reload-plugins`.

Version is pinned in `plugin.json`. Bump it on every release or users will not get the new tree.

## Kit

Planning: brainstorm, fix, chore, refactor, perf, docs, test, ci, docker, setup

Spec: proposal, tdd, apply, e2e, verify, archive

Investigate: analyze, gap-audit, explain, review, security, research, browser
Utility: enhance

Automation: autopilot, team, agents, git, clean-room, uiux-design

Internal: explore, osf

Agents: osf-analyze, osf-apply, osf-archive, osf-ba, osf-clean-room, osf-e2e, osf-gap-audit, osf-pm, osf-qa, osf-researcher, osf-security, osf-spec-review, osf-tdd, osf-uiux-designer, osf-verify

## Parallel

Stages stay in order (spec → tests → code → gates); fan-out happens inside a stage, in the same working tree.

- `/osf:apply <change> --parallel=N` — N osf-apply workers on file-disjoint batches, waves for dependencies, orchestrator ticks tasks.md
- `/osf:tdd <change> --parallel=N` — one osf-tdd part per spec capability, merged into tdd.md
- `/osf:autopilot … --parallel=N` — fans out analyze, tdd, implement; runs osf-security ‖ osf-verify together
- `/osf:team <request> [--parallel=N]` — PM, BA, DEV, QA, SEC (and researcher) kick off in one message, reports are merged, then autopilot Full runs with N workers. Trades tokens for wall-clock time.

## Agent visualizer

`/osf:agents` (or `node bin/agents-viz/server.mjs [--no-open] [--port=N] [--project=<dir>]`) opens `http://127.0.0.1:4317` (next free port up to 4330; a second call reuses the running server).

- **Header:** one picker for project and session.
  - Sessions are newest first, and a spinner marks a live one.
  - Only projects whose sessions spawned agents are listed.
  - A running session updates live; a past one replays.
- **Left pane, top:** where the run is ("Coding · vòng 4", "Dừng ở Coding", "Hoàn tất").
  - Next to it: the skill, agent count, start time and duration.
  - Chips count running, stalled and cut agents.
- **Round tabs** (`Vòng 1 … n`): shown when a fix loop happened.
  - Pick a round to see its agents.
  - An earlier round notes why it looped ("Security, Verify báo lỗi → sửa ở vòng 2").
- **Steps:** listed top to bottom, Kickoff (team runs only) → Spec → Spec gate → TDD → Coding → E2E → Security ‖ Verify (marked `song song`) → Archive.
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

Read-only: it reads `~/.claude/projects/**` transcripts, binds 127.0.0.1 only, needs no hooks and no dependencies (Node only). Claude Code only — OMP sessions are not supported.

Tests: `npm test`.
