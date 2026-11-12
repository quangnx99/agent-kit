---
name: "review"
description: "Review code for missed impacts, hardcoded values, rule violations, security, error handling, performance and smells. Args: omit for uncommitted changes, a PR/MR URL, or a feature/area."
metadata:
  kit: agent
---

If `codebase-retrieval` is not in your tool list, use Grep + Glob + Read wherever this skill says codebase-retrieval.

Review code for issues that are easy to miss after an implementation or fix: missed impacts, hardcoded values, project-rule violations, security holes and needless complexity. You run in the main conversation, so use what was just implemented or fixed to scope the review.

---

## Detect Scope

**Conversation context first.** If this runs right after an implementation or fix, those changed files are usually the scope; confirm with `git diff --name-only`.

**No arguments (default): uncommitted changes.**
```bash
git diff --name-only
git diff --cached --name-only
git ls-files --others --exclude-standard
```
Read each changed file fully, not just the diff lines.

**GitHub PR URL:** use `gh`.
```bash
gh pr view <url> --json title,body,author,baseRefName,headRefName,files,commits
gh pr diff <url>
```

**GitLab MR URL** (GitLab.com or self-hosted configured in `glab`): use `glab`.
```bash
glab mr view <url>
glab mr diff <url>
```
For self-hosted GitLab, the given URL is the source of truth for host, project and MR. If `glab` is not authenticated for that host, report the exact setup issue; if it cannot resolve the URL, ask for the host/project/MR identifier.

For PR/MR: use the URL as given, never guess or construct one. Ask before checking out the branch locally (it changes the working tree and may overwrite local work).

**Other arguments: a feature or area.** Use codebase-retrieval to find the relevant files, then read the key ones fully.

---

## Gather Context

1. **Read changed files fully** for surrounding context.
2. **Find consumers** with codebase-retrieval: "what code consumes or depends on the functions/APIs in these files?"
3. **Read CLAUDE.md and project rules** at the root and in relevant directories.
4. **PR/MR:** start from the remote diff, then use codebase-retrieval for consumers and project context; do not rely on the platform diff alone.

Tool priority: codebase-retrieval (relationships, related code) → Read (specific files) → Grep (literal patterns such as hardcoded values or TODOs).

---

## Review Dimensions

Run only what applies to the changed code.

- **Always:** Impact Gaps, Hardcoded Values, Project Rules, Security, Simplification, Design Smells
- **UI/frontend components:** UI/UX Feedback
- **Async, I/O or external calls:** Error Handling
- **Data fetching, loops, subscriptions, heavy computation:** Performance & Memory

Skip dimensions that clearly don't fit (e.g. UI/UX for a backend handler; Error Handling and Performance for a static config, schema or migration).

### 1. Impact Gaps
- Changed API response shape, type/interface, function signature, DB schema or event/hook: are all consumers, implementors, call sites, queries and listeners updated?
- New config/env var: documented and set in every environment?
- Find consumers with codebase-retrieval: "what code uses [changed symbol]?"

### 2. Hardcoded Values
- Credentials, API keys, tokens in code (CRITICAL).
- URLs, hosts, ports, paths, timeouts and limits that vary by environment.
- Unexplained magic numbers; literals duplicated across files; user-facing strings that should be i18n keys.

### 3. Project Rules Compliance
- Check against CLAUDE.md and detected conventions: naming, imports, error-handling and logging patterns, test placement, where new code should live.
- Any explicit rule in CLAUDE.md or similar config is in scope.

### 4. Security
- Injection: SQL, command, path traversal, XSS from unescaped user input.
- Missing input validation at system boundaries; insecure defaults (permissive CORS, disabled auth checks).
- Secrets committed to git or sensitive data written to logs.
- This is a quick pass on the diff; for a full audit, use `/security-audit`.

### 5. Simplification
- Dead code, unused imports/variables, redundant null checks, wrappers that add nothing.
- Over-complex conditionals or verbose code where the language has a shorter idiom.
- Duplicated logic (report duplication here only, not again under Design Smells).

### 6. UI/UX Feedback
- Async action with no loading/disabled state, no error state, no success feedback.
- Lists/tables without an empty state; forms without inline validation feedback.
- Accessibility: focus management after modal/route change, aria-labels, aria-live for dynamic content.
- Flag only where the code handles an interaction; skip display-only components.

### 7. Error Handling
- Empty catch, or catch that only logs with no recovery or user feedback.
- Unhandled promise rejections; missing error boundaries or fallback UI.
- Rethrow that loses the original cause; generic messages; network calls without timeouts.

### 8. Performance & Memory
- N+1 queries, unbounded queries/lists without LIMIT or pagination, O(n) scans over data that will grow.
- Listeners, subscriptions or timers without cleanup; caches/arrays that grow without eviction; superseded fetches without AbortController.
- Whole-library imports for one function; missing memoization or new objects/closures created on every render.

### 9. Design Smells (fragility, scalability, Fowler baseline)
- Structure that breaks under growth: god function/class, tight coupling to another module's internals, deep inheritance/mixin chains, hardcoded capacity assumptions.
- Hidden invariants: implicit call ordering, two sources of truth synced by hand, global mutable state, string-based dispatch instead of enums/types.
- Fowler smells: Mysterious Name, Feature Envy, Data Clumps, Primitive Obsession, Repeated Switches, Shotgun Surgery, Divergent Change, Speculative Generality, Message Chains, Middle Man, Refused Bequest.
- Project rules win: suppress anything the project's conventions endorse or a linter already enforces. Label Fowler smells "possible <smell>", never as hard violations.

---

## Severity Classification

- **CRITICAL**: security vulnerabilities, data-loss risk, broken functionality, impact gaps that will cause runtime errors, unbounded memory leaks, global mutable state shared across modules, implicit ordering that can corrupt data or bypass security.
- **WARNING**: rule violations, hardcoded values that should be config, impact gaps that may cause subtle bugs, missing error handling on user-facing paths, missing UI feedback on primary actions, structural smells that work today but break under growth, Shotgun Surgery or Divergent Change made worse by this diff.
- **SUGGESTION**: simplification, other possible smells, style, performance on non-hot paths, copy-paste with only 2 instances, mild coupling contained in one module.

Be conservative with CRITICAL: only things that will break or are security risks.

---

## Report Format

```
## Code Review Report

**Scope:** [uncommitted changes / GitHub PR / GitLab MR / feature]
**Files reviewed:** [count] files

### Summary
| Dimension | Findings |
|-----------|----------|
| Impact Gaps | X issues |
| ... one row per dimension that was run ... |

### Findings (sorted by severity)

**CRITICAL**
- [file:line] Issue and why it matters

**WARNING**
- [file:line] Issue

**SUGGESTION**
- [file:line] Improvement
```

---

## What's Next?

**CRITICAL or WARNING found:**
```
Found X issue(s) that should be fixed.

→ /agent apply — fix these issues directly (pass this report as context)
→ /agent fix — investigate deeper if the root cause is unclear
```

**Only SUGGESTION:**
```
No critical issues. X suggestion(s) for improvement.

→ /agent apply — apply these improvements
→ Done — code is acceptable as-is
```

**All clear:** `No issues found. Code looks good.`

---

## Remote Comments

For a PR/MR review you may offer to post the review as a comment. Posting affects shared state and notifies people, so it is a separate action from reviewing:

1. Show the exact comment body.
2. Post only after the user explicitly confirms:
   - GitHub: `gh pr comment <url> --body "<review comment>"`
   - GitLab: `glab mr note <url> --message "<review comment>"`
3. No duplicate, vague or noisy comments.
4. Never approve, request changes, merge, close or edit the PR/MR unless explicitly asked.

---

## Guardrails

- **Read-only** — never modify, create or delete local files; report findings, do not fix.
- **Remote comments need explicit confirmation.**
- **Concrete references** — every finding has file:line.
- **No false positives** — report only what you are confident about after reading the code; if unsure, skip it.
- **Respect project context** — check conventions before flagging something that looks wrong in isolation.
- **Use the user's language** for explanations; technical terms for code references.
