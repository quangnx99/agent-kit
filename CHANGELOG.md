# Changelog

Skill and agent names are stable from 1.3.0. A rename only happens in a major version, and the old name keeps working as an alias for at least one minor release.

## 1.3.0 — 2026-11-12

- brainstorm: the path menu puts ★ by size — A (code → verify) for 1–3 tasks in one area, C (Full) when the work adds a user journey, changes a contract, migrates data or touches auth/payments, B (auto) otherwise. Full is no longer the default.
- brainstorm: `enhance` runs only with `--enhance`; no confirmation pause by default.
- Fallbacks: without `codebase-retrieval` every skill and agent uses Grep + Glob + Read; without `openspec` explore continues and offers only A and B.
- `npm run eval`: behavior evals that run the kit headless with `claude -p` (costs tokens, not part of `npm test`).
- Names frozen (see top).

## 1.2.4 — 2026-11-12

- agent-apply, agent-tdd, agent-e2e preload the `karpathy-guidelines` skill; chore loads it before its first edit.

## 1.2.0 – 1.2.3 — 2026-11-08

- **Breaking:** kit renamed to agent-kit, plugin to `agent` (`/agent:*`).
- Renames: visualizer `agents` → `monitor`, `autopilot` → `auto`.
- auto runs to Done without asking; unresolved decisions become `Assumed:` lines or ⛔ blockers.
- monitor: run bar, compact steps, tabbed agent detail.

## 1.1.0 — 2026-11-08

- **Breaking:** daily-dev flow brainstorm → spec → tdd → code → verify → e2e → knowledge; team mode removed.

## 1.0.17 – 1.0.26 — 2026-11-06 – 2026-11-07

- Parallel fan-out, security ‖ verify gates, Auto path composing the shortest safe chain.
- Live agents visualizer; `indexing` skill for the Context Engine.
- Pipeline hardening and context trimming; OMP support dropped.

## Earlier — 2026-09-07 – 2026-11-05

- Initial OSF kit; tdd and e2e skills with their agents; `enhance`; security audit skill; `feat` renamed to `brainstorm`.
