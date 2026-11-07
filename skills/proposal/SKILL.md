---
name: "proposal"
description: "Create spec (proposal, design, tasks) for implementation. Explores and clarifies when needed before creating artifacts."
metadata:
  kit: osf
---

You are now in spec creation mode. Your job is to create OpenSpec artifacts (proposal, design, tasks) from the current conversation context.

> **CLI NOTE**: Run all `openspec` and `bash` commands directly from the workspace root. Do NOT `cd` into any directory before running them. The `openspec` CLI is designed to work from the project root.

> **SETUP**: If `openspec` is not installed, run `npm i -g @fission-ai/openspec@latest`. If you need to run `openspec init`, always use `openspec init --tools none`.

**INPUT**: You have full conversation history. Use it directly — every requirement, constraint, preference, edge case, and decision the user mentioned is available to you. Do NOT summarize or paraphrase — reference the actual discussion.

**OUTPUT**: Create an OpenSpec change with all required artifacts (proposal, design, tasks).

---

## Phase 0: Context Check

Before creating, check what already exists:

```bash
openspec list --json
```

If active changes exist, decide whether to:
- Create a brand new change — proceed normally
- Update an existing change's artifacts — skip `openspec new change`, go directly to artifact creation

If updating an existing change: Use the existing change name. Update only the artifacts that need changes.

---

## Phase 1: Understand

Evaluate the conversation context to decide the next phase.

**If context is clear** (scope, decisions, approach defined):
- Proceed to Phase 2 (Create)

**If context is vague** (missing key decisions, multiple possible approaches):
- Investigate the codebase first — facts the code can answer are never questions for the user
- Interview the user in rounds, with no fixed round cap: each round asks every open decision whose prerequisites are already settled, each with options A/B/★/Khác and "ok" accepting every ★. After each round, add the follow-up decisions the answers opened (failure path, edge cases, who else is affected, existing data, how to test) and ask the next round
- When no open decision remains, proceed to Phase 2

**Bias toward action on details, not on decisions.** Fill in low-impact details and facts yourself. Anything that changes user-visible behavior, scope, data, or cost goes to the user. In autopilot (`CALLER_CONTEXT: autopilot-pipeline`), never ask: take the ★ option and list each as `Assumed: <decision> → <choice>` in proposal.md.

---

## Phase 2: Create

Once the request is clear:

1. **Derive a kebab-case name** from the description (e.g., "add user authentication" → `add-user-auth`).

2. **Create the change directory**
   ```bash
   openspec new change "<name>"
   ```

3. **Get the artifact build order**
   ```bash
   openspec status --change "<name>" --json
   ```
   Parse: `applyRequires` (artifact IDs needed before implementation) and `artifacts` (list with status and dependencies).

4. **Create artifacts in dependency order**

   For each artifact that is `ready` (dependencies satisfied):
   - Get instructions: `openspec instructions <artifact-id> --change "<name>" --json`
   - The instructions JSON includes:
     - `context`: Project background (constraints for you — do NOT include in output)
     - `rules`: Artifact-specific rules (constraints for you — do NOT include in output)
     - `template`: The structure to use for your output file
     - `instruction`: Schema-specific guidance for this artifact type
     - `outputPath`: Where to write the artifact
     - `dependencies`: Completed artifacts to read for context
   - Read any completed dependency files for context
   - Create the artifact file using `template` as structure
   - Apply `context` and `rules` as constraints — do NOT copy them into the file
   - Show brief progress: "✓ Created <artifact-id>"

   Continue until all `applyRequires` artifacts have `status: "done"`. Re-check with `openspec status` after each artifact.

   If an artifact requires user input (unclear context), ask and continue.

5. **Show final status**
   ```bash
   openspec status --change "<name>"
   ```

---

## Artifact Creation Guidelines

- Follow the `instruction` field from `openspec instructions` for each artifact type
- Read dependency artifacts for context before creating new ones
- Use `template` as structure — fill in its sections
- **`context` and `rules` are constraints for YOU, not content for the file** — never copy them into output
- **Always write artifact files in English** — regardless of conversation language
- **Every decision reaches a scenario.** Collect every decision from the conversation: answered grilling questions, accepted ★ options, `Assumed:` lines, stress-test answers, edge cases and error paths named in the teach-back. Each must be encoded in a spec scenario whose THEN is observable and concrete (exact message, status code, resulting state, count) — never "handles gracefully" or "shows an error". End proposal.md with:
  ```
  ## Decision coverage
  | Decision | Spec scenario |
  |----------|---------------|
  | Double submit creates one order | specs/checkout/spec.md › Requirement: Idempotent submit › Scenario: double click |
  ```
  A decision with no scenario is a bug in the spec, not a detail for later. The `osf-spec-review` gate audits this table.
- **Production concerns in design.md.** For what applies to this change, state: error handling per failure point, authorization rules, concurrency/idempotency, data migration and backward compatibility, limits (pagination, sizes, rate limits), logging of failure paths without secrets, and how to roll back
- **Updating after a spec review.** When the caller passes `Spec review findings:`, update the existing change in place: add or sharpen exactly the scenarios the CRITICAL items name, encode the user's answers to DECISION items, and extend `## Decision coverage`. Do not rewrite unrelated parts
- **Annotate verify points in tasks.md** — For the last task of each major group or any high-risk task, append a verify annotation: `← (verify: what to check)`. This tells the verifier WHERE to deep-check and WHAT to look for. Place annotations on tasks that are end-of-flow (everything before must work for this to work) or high-risk (complex logic, integration points, security). Example:
  ```
  1. Setup database
    1.1 Create users table
    1.2 Create sessions table
    1.3 Add migration script ← (verify: schema matches design.md, migrations run without errors)
  2. Auth endpoints
    2.1 POST /login
    2.2 POST /register
    2.3 POST /refresh-token ← (verify: all endpoints match spec scenarios, token refresh flow works end-to-end)
  ```

---

## Guardrails

- Create ALL artifacts needed for implementation (as defined by schema's `apply.requires`)
- Always read dependency artifacts before creating a new one
- Fill in facts and low-impact details yourself to keep momentum; decisions that change behavior, scope, data or cost still go to the user (Phase 1), or become `Assumed:` lines in autopilot
- If a change with that name already exists, suggest continuing that change instead
- Verify each artifact file exists after writing before proceeding to next

---

## After Completion

Output this marker line with the change name:

```
✅ Spec created: <change-name>
```

**How you finish depends on who called you:**

**If your input contains `CALLER_CONTEXT: autopilot-pipeline`** (the autopilot orchestrator invoked you):
- Print ONLY the marker line above — nothing else.
- Do NOT write "stop", "your job is done", "Ready for implementation", a closing summary, a farewell, or "let me know if you want to continue". Those phrases read as a turn boundary and cause the pipeline to halt before implementation — this is exactly the failure to avoid.
- The autopilot pipeline continues in the SAME turn: autopilot runs its next step right after your marker (osf-spec-review in the Full pipeline). Hand back so the pipeline proceeds — do NOT end the turn, do NOT wait for confirmation.
- Do NOT launch osf-apply or any other subagent yourself — autopilot routes that.

**Otherwise** (standalone `/osf proposal`, or any other caller):
- Print the marker, then **stop your own execution immediately** and return control to the caller in the same turn.
- Do NOT write "Ready for implementation" as a closing line — the caller decides what "ready" means.
- Do NOT suggest next commands (`/osf apply`, etc.) — the caller will route.
- Do NOT write a closing summary, farewell, or "let me know if you want to continue" — these look like turn boundaries and cause the caller to stop.
- Do NOT launch osf-apply or any other subagent yourself.
- The caller reads the `✅ Spec created: <change-name>` marker, extracts the change name, and proceeds. Your job is done the moment that marker is printed.