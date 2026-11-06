---
name: "agents"
description: "Open a local web page that shows what agents are doing in Claude Code sessions: which skill spawned which agent, parallel waves, each agent's brief, latest tool call, final report and status (running, done, cut, stalled). Live for a running session, replay for past ones. Read-only, local-only. Args: [--no-open] [--port=N]."
metadata:
  kit: osf
---

You start the osf agent visualizer. You do not spawn subagents and you do not write any file.

Claude Code only. On OMP, print `agents: Claude Code only (reads ~/.claude/projects transcripts)` and stop.

## Steps

1. Resolve three values:
   - **Skill directory**: the absolute directory containing this `SKILL.md` (Claude Code shows it as "Base directory for this skill").
   - **Project dir**: the current working directory with every character that is not a letter or digit replaced by `-` (e.g. `C:\Users\admin` → `C--Users-admin`, `/home/me/app` → `-home-me-app`).
   - **Flags**: from the arguments (`$ARGUMENTS`), keep only tokens that are exactly `--no-open` or match `--port=` followed by digits only (e.g. `--port=4320`). Drop every other token. Never paste the raw arguments into the command.
2. Run with Bash, `run_in_background: true` (it is a long-running server, not a subagent):
   ```bash
   node "<skill directory>/../../bin/agents-viz/server.mjs" --project=<project dir> <flags>
   ```
   `<flags>` is the whitelisted list from step 1 (empty when none).
3. Read the background output until the line `osf agents → http://127.0.0.1:<port>` appears (a few seconds). If it ends with `(already running)`, a server from an earlier call is still up and the command exits on its own — reuse that URL.
4. Tell the user, briefly:
   - the URL (the browser opens by itself unless `--no-open`)
   - left: project and sessions; center: session → skill → agents, one row per wave (agents in a row ran in parallel); right: brief, tool timeline, doing now, final report
   - statuses: running, done, cut (API/rate-limit error or no final report), stalled (no write for >10 min)
   - read-only, binds 127.0.0.1 only, reads `~/.claude/projects`; no hooks, nothing installed
   - stop it by stopping that background task (or Ctrl+C when run in a terminal)

If `node` is missing or the command fails, print the error line and stop.
