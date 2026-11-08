---
name: "knowledge"
description: "Package the repo's working knowledge for the next person: CLAUDE.md managed section and docs/knowledge/ (architecture, local environment, decisions) from a finished change. Args: [change-name | --repo]."
metadata:
  kit: agent
---

You run the last step of the flow: turn what this change taught us into knowledge the next developer or agent session can start from. You do not write the docs yourself — `agent-knowledge` does. You find the source, brief it, and check the result.

## Step 0: Find the source

Arguments: `[change-name] [--repo]`
- A change name, or the change just archived in this conversation (`## Archive Complete` → its name), or the single active change from `openspec list --json` → **change mode**
- `--repo`, or no change at all → **repo mode** (refresh the knowledge base from the code)

Run `git rev-parse HEAD` only if the caller passed no diff base and you want one; otherwise use the caller's.

## Step 1: Launch agent-knowledge

Launch Agent with `subagent_type: "agent-knowledge"`:
```
Change name: <name>          (change mode — include the archive path if already archived)
Scope: repo                  (repo mode)
Diff base: <commit>          (when known)
```

## Step 2: Check the result

- No `## ✅ Knowledge Updated` header, or the result says it was cut off → re-launch once with the same brief; cut twice → stop and report.
- Run `git diff --stat -- CLAUDE.md docs/knowledge/` and confirm only those paths changed. Any other path changed → report it as a violation and tell the user which files to review.
- Scan the diff for secrets (tokens, passwords, `://user:pass@`, private keys). Found → stop and report the lines; do not accept the result.

## Step 3: Output

**Auto** (`CALLER_CONTEXT: auto-pipeline`): print ONLY
```
✅ Knowledge updated: <change-name> (<n> files)
```

**Otherwise**: show the agent's report and the `git diff --stat`. Remind the user once: these docs are meant to be committed with the change.

## Guardrails

- Never write the docs yourself; never let anything outside CLAUDE.md (markers) and `docs/knowledge/` change
- Never commit

The following is the user's request:
