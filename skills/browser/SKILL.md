---
name: "browser"
description: "Reproduce bugs, explore an app or run QA flows in a real browser via dev-browser, with screenshots as evidence."
metadata:
  kit: osf
---

Drive a real browser like a user, capture evidence, then trace root cause in the codebase.

**Input**: a bug report (Mode A: REPRODUCE), a request to explore the app (Mode B: EXPLORE), or a flow to test as QA (Mode C: QA TEST).

## SETUP (MANDATORY — DO THIS FIRST)

Before ANY browser interaction, check that dev-browser is installed:

```bash
which dev-browser
```

If it is missing, do NOT install it yourself. Ask the user once: "dev-browser chưa có — cài global bằng `npm install -g dev-browser && dev-browser install` nhé?" Run that command only after the user says yes; otherwise stop and tell them how to install it (`! npm install -g dev-browser && dev-browser install`). If the install fails, show the error and stop.

Then ask for the app URL if it is not obvious from context.

**Arguments**:
- `e2e` or `test` as first argument → **Mode C: QA TEST** (report-only). Rest = flow name + URL, e.g. `/osf browser e2e login http://localhost:3000`
- `--headless` → no visible window. Default is headed so the user can watch.
- `--connect` → attach to the user's running Chrome (remote debugging on; useful for logged-in sessions).

## dev-browser cheat-sheet

Scripts are piped to the CLI and run in a QuickJS sandbox (not Node: no `require`, `fs`, `process`, `fetch`). Pages are full Playwright `Page` objects. Default script timeout is 30s (`--timeout <s>`); `--ignore-https-errors` for self-signed local certs.

```bash
dev-browser <<'SCRIPT'
const page = await browser.getPage("main");   // named page, persists across scripts
await page.goto("http://localhost:3000", { waitUntil: "domcontentloaded" });
console.log((await page.snapshotForAI()).full);
SCRIPT
```

| Need | Call |
|---|---|
| Page handle / tabs | `browser.getPage(name)`, `browser.listPages()` |
| Navigate | `page.goto(url, { waitUntil: "domcontentloaded" })` (default `load` can hang on dev servers), `page.reload()`, `page.goBack()` |
| Read page | `(await page.snapshotForAI()).full` — primary way to find elements |
| Locate | `page.getByRole(role, { name })`, `getByLabel`, `getByPlaceholder`, `getByTestId`, `locator(css)` |
| Act | `.click()`, `.fill()`, `.pressSequentially()` (key-by-key handlers/validation), `.hover()`, `.check()`, `.selectOption()`, `page.keyboard.press()` |
| Wait | `locator.waitFor()`, `page.waitForURL("**/x")`, `page.waitForLoadState("networkidle")` |
| Screenshot | `await saveScreenshot(await page.screenshot(), "osf-<HHMMSS>-step1.png")` → returns path in `~/.dev-browser/tmp/` |
| Console errors | `page.on("console", m => m.type()==="error" && errs.push(m.text()))`; `page.on("pageerror", e => errs.push(e.message))` — log `errs` at end of the same script |
| Responsive | `page.setViewportSize({ width: 375, height: 812 })` |
| Measure | `page.evaluate(() => ...)` — plain JS only |
| Files | `writeFile(name, data)`, `readFile(name)` — restricted to `~/.dev-browser/tmp/` |

If a script fails, the page stays where it stopped: reconnect with `browser.getPage("main")`, screenshot, log URL/title. Run `dev-browser --help` if an API is unclear.

**Network/WebSocket monitoring** (data not loading, silent form failures, real-time features, races, 401/403): in one script, `page.evaluate` a wrapper around `window.fetch`, `XMLHttpRequest` and `WebSocket` that pushes `{method, url, status, duration, truncated body}` and WS open/close/messages into `window.__NET_LOG`. Run action scripts, then read `window.__NET_LOG` back. Correlate URLs/payloads with handlers via `codebase-retrieval`. Report as `NETWORK EVIDENCE`: action, then each request `METHOD url → status (ms) body` and WS messages in order, flagging anomalies.

## Interaction rules

- Loop per script: get page → navigate → snapshot → act → verify. One logical action per script; end by logging the state you need next.
- Interact like a user, measure like an engineer: Playwright locator actions only; `page.evaluate()` only for reading styles, DOM state, geometry, `window.performance`, observers, network logs.
- Prefer role/text locators. An element only reachable by CSS is an accessibility finding.
- Pace like a human: `waitForLoadState("networkidle")` or `waitForTimeout(500)` between rapid actions.
- Screenshot before and after each critical action; capture console errors on every action.
- Never close the main page — the user may inspect it. Ask first.

## Codebase mapping

Use `codebase-retrieval` BEFORE opening the browser and again while tracing:
- Before: routes, page components, handlers, API endpoints, state for the flow.
- After evidence: search by error text, URLs, component names.
- Tracing: all writers/readers of the involved state. Don't guess file locations.

Keep a `CORRELATION MAP`: each piece of browser evidence (URL, failing click, console error, missing element) → `file:line`.

## Mode A: REPRODUCE

1. **UNDERSTAND** — expected vs actual, URL, steps. If vague, ask ONE focused question.
2. **MAP** — `codebase-retrieval` for route, handlers, endpoints, state.
3. **REPRODUCE** — run the exact steps, one script each, screenshots before/after + snapshot. If it doesn't reproduce, vary input, timing, viewport; after 3 attempts report not reproduced.
4. **CAPTURE** at the failure point:
   ```
   EVIDENCE BLOCK
   Step / Expected / Actual / Screenshot: <path + what's visible>
   Console errors / Network / DOM state (snapshotForAI) / Viewport
   ```
5. **TRACE** — follow the evidence: stack trace → files; 500 → endpoint handler; missing element → conditional render; wrong data → API → state → render; dead click → handler binding; layout → component + ancestor styles; mobile-only → breakpoints. Strategy: reverse trace (clear error), differential (intermittent), forward trace (multi-step), boundary trace (data corruption), shared-state audit (state bugs). Draw the causal chain from symptom up to `ROOT CAUSE ──▶ file:line`.
6. **REPORT**
   ```
   ## E2E Diagnosis
   **Bug**: … **Reproduced**: Yes/No
   **Steps to reproduce**: 1. …
   **Evidence**: screenshot at step N / console error / network
   **Root cause**: … **Location**: file:line
   **Causal chain**: [ASCII]
   **Complexity**: SIMPLE / COMPLEX
   **Suggested fix**: …
   ```
7. **ROUTE** (tell the user in their language, pass the diagnosis as context):
   - SIMPLE (one cause, 1–2 files, no architectural impact) → `/osf apply`
   - COMPLEX (multi-file, breaking, design decisions) → `/osf brainstorm`, then `/osf apply`
   - UNCERTAIN → say root cause isn't found yet; stay in this mode and run more scenarios.

## Mode B: EXPLORE

1. **MAP** — `codebase-retrieval`: pages/routes, main flows (auth, CRUD, navigation, forms), components.
2. **PLAN** — list flows (`EXPLORATION PLAN`: Flow 1…N, incl. form validation and responsive). Ask the user whether to prioritize some or test all.
3. **WALK** each flow, happy path and edge cases. At every step check: no console errors; elements findable via snapshot; interactive elements respond; forms validate; navigation/back/forward works; no visual glitches; mobile viewport layout holds. Edge cases: empty submit, very long input, rapid double-click, navigate away and back, refresh mid-flow.
4. **DETECT** —
   ```
   FINDING [N]
   Page / Action / Issue / Severity: CRITICAL|WARNING|INFO / Screenshot / Console
   ```
   CRITICAL = broken function, data loss, crash, security. WARNING = degraded UX, visual glitch, a11y, missing validation. INFO = minor inconsistency.
5. **REPORT** — `## Exploration Report`: **App URL**, **Flows tested**, **Findings** (count by severity), then `### Critical` / `### Warning` / `### Info` with evidence.
6. **ROUTE** — Critical → REPRODUCE each, then `/osf apply` or `/osf brainstorm`; Warnings → one `/osf apply` batch (or `/osf brainstorm` if architectural); Info → note only.

## Mode C: QA TEST

Act as a QA tester for one flow and deliver a test report. **REPORT-ONLY**: never modify code, never invoke or suggest `/osf apply`, `/osf brainstorm` or `/osf fix`. If you're about to edit a file or route to a fix, STOP.

1. **PARSE** — flow name and app URL; if either is missing, ask ONE question.
2. **MAP** — `codebase-retrieval`: routes, components per step, API endpoints, state driving the flow.
3. **EXECUTE** step by step like a user: screenshot before → act → screenshot after → console errors → snapshot → log findings as you go (inject network monitoring if the flow calls APIs). Watch for:
   - Bugs: console errors, network failures, broken/missing UI, wrong data, unresponsive actions.
   - UX: confusing labels, missing loading/error/success feedback, layout breaks, poor responsive, keyboard/ARIA gaps, slow without spinner.
   - Automation: no role/label/test-id, unstable selectors, timing-dependent steps, external dependencies (email, CAPTCHA, OAuth), hover/scroll-only elements.
4. **INVESTIGATE** each bug or stuck point with `codebase-retrieval` (stack trace, handler, conditional render, data pipeline, unmet prerequisite state). Record file:line and the faulty pattern.
5. **REPORT** — clear enough for a developer who wasn't watching:
   ```
   ## QA Test Report
   **Flow** / **App URL** / **Date** / **Status**: PASS|FAIL|PARTIAL

   ### Test Steps
   | # | Action | Expected Result | Actual Result | Status |

   ### Bugs Found
   #### BUG-N: title
   - Step, Severity (CRITICAL|HIGH|MEDIUM|LOW), What happened, Expected,
     How to reproduce (from flow start), Evidence (screenshot path, console),
     Root cause (from codebase): file:line — what's wrong and why

   ### UX Issues
   #### UX-N: title
   - Step, Severity (HIGH|MEDIUM|LOW), What happened, Why it's bad, Suggestion, Related code

   ### Automation Notes
   #### AUTO-N: title
   - Step, Element/Action, Why it's hard, Suggestion

   ### Summary
   Total steps / Passed / Failed / Bugs by severity / UX issues / Automation blockers

   ### Screenshots
   path → step
   ```
   Then tell the user (in their language) the report is complete and developers can use it to reproduce and fix. Suggest no fixes.

## VERIFY (post-fix)

After `/osf apply`, rerun the same steps on `browser.getPage("main")` with screenshots at the same points:

```
## Verification
**Bug** / **Fix applied** / **Re-test result**: PASS|FAIL / **Before** / **After**
```

FAIL → back to TRACE with the new evidence.

## Cleanup

After your session ends (diagnosis routed, exploration reported, or verification done), clean up dev-browser artifacts:

1. Keep a list of every file this session saved in `~/.dev-browser/tmp/` (via `saveScreenshot()` or `writeFile()`) as you create them. Give them a per-session prefix (e.g. `osf-<HHMMSS>-…`) so they are recognizable.
2. Delete only those files, by name: `rm -f ~/.dev-browser/tmp/<file1> ~/.dev-browser/tmp/<file2>`. Never `rm -rf ~/.dev-browser/tmp/*` — other sessions keep evidence there.
3. If you lost track of which files are yours, list the folder (`ls -la ~/.dev-browser/tmp/`) and ask the user before deleting anything.

Exception: if the user asks to keep evidence files (e.g. for a bug report), skip cleanup and tell them where the files are.

## Guardrails

- **QA TEST is report-only** — no edits, no `/osf apply|brainstorm|fix`.
- **Don't fix bugs yourself** in A/B — diagnose and route to `/osf apply` or `/osf brainstorm`.
- **Always map with `codebase-retrieval`** before and during browser work; browser evidence without code is just symptoms.
- **No JS-injected interactions** — user-like locator actions only.
- **Evidence for every claim** — screenshot, console message, network log or code reference. Screenshot liberally; check console after every action.
- **No fog** — "probably", "likely", "should work" means you need more evidence.
- **Be honest** — say when a bug doesn't reproduce or the evidence contradicts the report.
- **One bug at a time** in REPRODUCE — each gets its own reproduce → trace → report cycle.
- **Redact secrets** — mask passwords, tokens, cookies, API keys and personal data in logs, network evidence and reports; don't log request headers or auth payloads verbatim.
- **Always quote the heredoc** — `<<'SCRIPT'`, not `<<SCRIPT`.

## Next steps (Mode A/B only)

Simple fix → `/osf apply` · complex → `/osf brainstorm` then `/osf apply` · more bugs → stay in `/osf browser` · full implementation check → `/osf verify` · QA report for a flow → `/osf browser e2e [flow] [url]`.
