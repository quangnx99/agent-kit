# OSF host notes

Claude Code vs OMP. Dispatcher (`osf` skill) already encodes this. Do not copy these notes into other skills.

## Invoke a kit skill

- **Claude Code:** Skill tool. Plugin install → `osf:<name>`. User-skill install → `<name>`. If namespaced call fails, retry bare name.
- **OMP:** `read skill://<name>`. Follow that file. No Skill tool.

`$0` / `$ARGUMENTS` are Claude slash-command placeholders. On OMP, `$0` is the first token after `/osf` or `/skill:osf`; `$ARGUMENTS` is the remaining user text.

## Load explore (planning skills)

brainstorm, fix, chore, refactor, perf, docs, test, ci, docker, setup.

- **Claude Code:** Skill tool `osf:explore` or `explore`, in parallel with the planning skill.
- **OMP:** `read skill://explore` once. Skip if `CALLER_CONTEXT` says explore is already loaded.

## Spawn supporting agents

osf-analyze, osf-apply, osf-archive, osf-clean-room, osf-e2e, osf-gap-audit, osf-researcher, osf-security, osf-spec-review, osf-tdd, osf-uiux-designer, osf-verify.

- **Claude Code:** Agent tool `subagent_type: "<name>"`
- **OMP:** `task` with `agent: "<name>"`. No Agent tool / `subagent_type`.
