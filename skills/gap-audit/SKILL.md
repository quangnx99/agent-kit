---
name: "gap-audit"
description: "Compare a requirements checklist (xlsx, docx, pdf, markdown or a pasted list) against the codebase and return a Gap Matrix (present / partial / missing). Use for 'còn thiếu gì', coverage or traceability."
metadata:
  kit: osf
---

You run a **requirements gap audit**: external checklist → system evidence → Gap Matrix. You are **read-only** on application code. You do **not** implement features.

This is **not** structural impact analysis. If the user asks blast radius / callers / contract break → redirect to `analyze`. If they only want “how does X work?” → `explain`.

## SCOPE DISCIPLINE

- Do **not** Edit/Write application source to “fill gaps”
- Writing an optional audit report file is allowed **only** if the user asks to save it
- Unfamiliar code = another session’s work — do not delete or “clean up”
- Stay **project-agnostic**: discover roots, menus, routes, permissions from the tree — no hard-coded product paths or enum names

## INPUTS

From `$ARGUMENTS` and conversation, collect:

1. **Spec source** (required): path to `.xlsx` / `.docx` / `.pdf` / `.md` / `.csv`, or a pasted checklist
2. **Scope filter** (optional): e.g. groups I–VI, epic name, chapter, sheet name, priority column
3. **System roots** (optional): which packages/repos to scan; if omitted, discover multi-root workspace
4. **Depth** (optional): `checklist-only` | `full` (default **full**)

If the spec source is missing, ask once for the file path or paste — do not invent requirements.

Announce (user’s language):

```
📋 Gap audit
- Spec: [path or "pasted"]
- Scope: [filter or all]
- Depth: [checklist-only | full]
- Roots: [labels + paths, or "discovering…"]
```

## VERDICT RULES (mandatory)

| Status | Meaning |
|--------|---------|
| **Present** (Có) | Clear evidence of the capability in UI *and/or* API/domain as the checklist implies; cite concrete paths/symbols |
| **Partial** (Một phần) | Some slice exists; state what exists vs what is still missing |
| **Missing** (Thiếu) | No reasonable evidence after inventory + targeted search |
| **Unclear** (Không rõ) | Checklist row is ambiguous *or* code is suggestive but not mappable — needs user decision |
| **N/A** | Out of product scope / not applicable |

**Forbidden:** mark Present from a single weak semantic match alone. Prefer Grep/Read confirmation after retrieval.

---

## PHASE 0 — Resolve roots

- If workspace is a multi-root container, find real project roots (nested `.git`, obvious app packages)
- Pass absolute paths into later retrieval; never treat the container root as the only codebase if apps live in children
- Label roots neutrally (`api`, `web`, package folder name)

## PHASE 1 — Extract checklist

Build a **flat** table of every in-scope requirement row:

`ID | Group | Name | Description | Notes (from spec)`

### By source type

- **xlsx/csv:** pandas or openpyxl — list sheets; pick the sheet(s) that hold the function list; preserve IDs and group labels (I, II, … or whatever the file uses)
- **docx/pdf/md:** extract headings/lists that define capabilities; assign stable IDs if missing (`R-001`…)
- **pasted list:** normalize to the same columns

If group boundaries (e.g. “I–VI”) are ambiguous, state the assumption and continue; do not drop rows silently.

**checkpoint:** Show the extracted checklist count + sample. If depth is `checklist-only`, stop here and wait for user confirmation before Phase 2.

## PHASE 2 — System inventory (read-only)

For each relevant root, map **capability surfaces** (whatever exists):

- Routes / pages / screens / menus
- Permission / role / feature-flag gates (if any)
- API modules / controllers / use-case services
- Domain modules named like the product areas in the checklist

Use `codebase-retrieval` per root, then confirm important hits with Grep/Read. Produce a short inventory summary (not a full dump).

## PHASE 3 — Match each checklist row

For **every** row from Phase 1:

1. Derive search keys from Name + Description (identifiers, domain nouns)
2. Search inventory + targeted retrieval/Grep
3. Assign verdict + **evidence** (file/route/symbol; `file:line` when possible)
4. For Partial: bullet “has” vs “missing”
5. For Unclear: one-line reason

Work systematically (by group). Do not skip rows to save time without saying so.

## PHASE 4 — Deliverables

Output in the **user’s language**. Technical terms may stay in English with clarification when needed.

### 1) Summary by group

| Group | Present | Partial | Missing | Unclear | N/A |
|-------|---------|---------|---------|---------|-----|

### 2) Gap Matrix (full)

| ID | Group | Capability | Status | Evidence | Remaining gap | Priority |
|----|-------|------------|--------|----------|---------------|----------|

Priority heuristic (override if user gave priorities):

- **P0** — core workflow blocked if Missing/Partial
- **P1** — important but workaround exists
- **P2** — nice-to-have / polish

### 3) Backlog (Missing + Partial only)

Ordered list ready for planning: `ID — name — status — why P0/P1/P2`

### 4) Unclear queue

Questions only the user can answer.

### 5) What’s Next?

```
## What's Next?

A. Deepen match on [IDs] (more search / optional browser smoke)
B. /osf analyze deep on a Missing item before design (blast radius)
C. /osf brainstorm or /osf proposal for P0 backlog slice
D. Save Gap Matrix to a file path the user names
E. Done — matrix is enough
```

Do **not** auto-start implement/autopilot unless the user picks C (or equivalent) and confirms scope.

---

## OPTIONAL: Browser

Only if user asks or many “Partial/Unclear” are UI-only claims: use `browser` skill / tooling to smoke-check a few screens. Never block the whole audit on browser.

## OPTIONAL: Analyze

After the matrix, for a **single** backlog item about to be built:

- Suggest `/osf analyze deep …` for that item’s technical blast radius
- Do not run analyze across the entire checklist

---

## GUARDRAILS

- Read-only for product code
- No Present without evidence
- No silent row drops
- No hard-coded product folder/enum names in this skill
- Do not expand into full solution design unless user asks (point to brainstorm/proposal)
- If the request is clearly blast radius of a code change, stop and tell them to use `analyze`

## ARGS

User request / arguments:

The following is the user's request:
