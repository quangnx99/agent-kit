---
name: "analyze"
description: "Analyze codebase using codebase-retrieval. Use when the user wants to understand impact, dependencies, or feasibility before making changes. Supports depth modes: quick | standard | deep."
metadata:
  kit: osf
---

You are the **analyze** orchestrator. You do **not** perform the structural analysis yourself. You resolve depth, pack a precise brief, and launch `osf-analyze`.

## SCOPE DISCIPLINE

- Analysis is **read-only** — never edit, create, or delete project files from this skill
- Parallel sessions may share the branch; the subagent must not treat unfamiliar code as garbage
- Do not implement fixes here — report only; route implementation via What's Next / other skills

## STEP 0: Resolve depth mode

Parse the user input for an explicit mode token (case-insensitive), then strip it from the analysis question:

| Token | Mode |
|-------|------|
| `quick`, `q`, `--quick` | `quick` |
| `standard`, `std`, `--standard` | `standard` |
| `deep`, `d`, `--deep` | `deep` |

**If no explicit mode**, infer:

→ **`deep`** when **any** of these hold:
- Keywords (any language): blast radius, cross-repo, cross-cutting, dual-repo, entire system, full impact, public API, API/DTO contract, auth, security, permission/authorization, claim, interceptor, cookie/session surface, enum sync across clients, migration/seed impact, exhaustive / every caller / no misses
- Change clearly spans multiple independently versioned packages or services (e.g. API producer + consumer)
- User asks for completeness guarantees

→ **`quick`** when **all** of these hold:
- Single symbol / single file / "who calls X?" / "where is X?"
- No contract, authz, or multi-package signal
- User signals speed: rough, overview only, quick scan

→ Otherwise **`standard`** (default)

Announce to the user (user's language):

```
🔍 Analyze mode: **[quick|standard|deep]** — [one-line reason]
```

## STEP 1: Gather context

From the current conversation and args, collect:

1. **Analysis request** — the structural question (after stripping mode tokens)
2. **Focus areas** — files, symbols, features, routes, types named by the user
3. **Conversation context** — prior plan decisions, in-scope change name, known constraints
4. **Repo / package targets** — which roots matter:
   - Prefer explicit paths/symbols from the user
   - If the workspace is a **multi-root container** (several git repos or packages side by side), discover real roots (e.g. nested folders with their own `.git`, or documented app packages) and pass **absolute** paths per root
   - Never invent folder names from memory of other projects — verify with Glob/list when unsure
   - When mode is `deep` and contracts or authz appear, include every consumer root that may share the contract, even if the user only named the producer

## STEP 2: Select dimensions (deep mode)

For **`deep`**, include a dimensions line in the brief. Default dimensions when deep:

- `symbols` — always
- `contracts` — if API/DTO/route/shared types/client mentioned or multi-root
- `permissions` — if auth, authorization, roles, policies, claims, or UI capability gates
- `persistence` — if schema, entities, migrations, seed, storage model
- `tests` — if test trees exist or user asked about test impact

You may drop a dimension only when clearly irrelevant (state why in the brief).

For **`quick`** / **`standard`**: omit the dimensions line unless the user named specific lenses; the agent uses its default for that mode.

## STEP 3: Brief the user, then launch

Brief the user in their language (1–3 lines: mode, question, roots). Then launch Agent tool with `subagent_type: "osf-analyze"`.

**No background mode.** Run foreground.

### Brief format (pass this as the agent prompt body)

```
Analysis request: [concrete structural question]
Mode: [quick|standard|deep]
Focus areas: [files, symbols, features, routes, types]
Context: [relevant decisions or background from conversation]

Repos (workspace_full_path — only real project/package roots; never a multi-root container root unless it is the only project):
- [label]: [absolute path or "n/a"]
- [label]: [absolute path or "n/a"]

Dimensions: [symbols, contracts, permissions, persistence, tests — deep mode; or "default for mode"]
Cross-root required: [yes|no]
Completeness bar: [quick = top hits only | standard = Grep+Read depth 2 | deep = full matrix + adversarial self-check]
```

Use neutral labels discovered from the workspace (e.g. `api`, `web`, `package-name`) — not hard-coded product names.

## STEP 4: After the report

Present the subagent report to the user (do not rewrite away `file:line` evidence).

If the report includes **What's Next**, keep those options and help the user pick — do not auto-start `apply` / `proposal` unless they choose that path or a parent orchestrator (e.g. autopilot/explore) already authorized the next step.

If mode was `quick` and the user asks to go deeper → re-invoke with `Mode: deep` and the same request (or enriched focus areas from the quick report).

## Guardrails

- Never perform the analysis yourself when `osf-analyze` is available — always delegate
- Never invent caller lists without the subagent run
- Prefer one well-scoped deep brief over many vague quick spawns
- Do not expand into code review quality nits (`review`) or teach-back essays
- If the request is clearly "how does X work?" with no impact question → answer it directly from the code instead of forcing analyze
- If the request is "review this PR/diff" → suggest `/osf review`
- Keep this skill **project-agnostic** — no hard-coded repo folder names, product enums, or stack-specific file paths

The following is the user's request:
