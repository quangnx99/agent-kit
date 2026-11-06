# OSF kit

32 OpenSpec-flow skills and 15 supporting agents for Claude Code and OMP.

Marketplace `osf-kit`, plugin `osf`, `source: "./"`.

## Install

```bash
# Claude Code
claude plugin marketplace add sonnguyen1812/osf-kit && claude plugin install osf@osf-kit

# OMP
omp plugin install github:sonnguyen1812/osf-kit
```

Claude Code TUI (if the marketplace is not registered yet):

```text
/plugin marketplace add sonnguyen1812/osf-kit
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
omp plugin install github:sonnguyen1812/osf-kit
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

- Pick a project and a session in the header (newest first, `· đang chạy` marks a live one); a running session updates live, a past one replays
- Pipeline stepper: Kickoff (team runs only) → Spec → Spec gate → TDD → Coding → E2E → Security ‖ Verify → Archive. The current step is highlighted at the top ("Đang ở bước Coding · vòng 2"); re-runs show `×N`, steps that did not run show `bỏ qua` (e.g. `--no-e2e`), and a fix loop from the gates back to Coding is drawn as `↺ vòng N`
- Agent cards for the selected step (click any step to see its agents): what each agent is doing right now in plain words ("Đang sửa tag.js", "Đang chạy test"), with running agents first; agents outside the pipeline sit behind the `Khác (n)` chip. A session without an osf pipeline shows all its agents as a plain grid
- Click a card to open the side panel: **Đang làm** (current action, live) and **Vừa làm** (last 5 actions); a finished agent shows its one-line result instead
- Status (icon + text): Đang chạy, Xong, Bị cắt (API / rate-limit error, or no final report), Treo (no write for >10 min). An unfinished agent with no write for 2–10 min still shows as running
- Respects light/dark mode and reduced motion; keyboard and screen-reader friendly

Read-only: it reads `~/.claude/projects/**` transcripts, binds 127.0.0.1 only, needs no hooks and no dependencies (Node only). Claude Code only — OMP sessions are not supported.

Tests: `npm test`.
