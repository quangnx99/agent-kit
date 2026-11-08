# DESIGN — agent-kit visualizer

## Brief
- Who uses it: a developer running `/agent:auto`, with the page open next to the terminal (about 900px wide) or full screen.
- Main job: see which step the pipeline is on, spot agents that need a look (stalled, cut), and read each agent's report.
- Live session over SSE, or replay of a finished one. Read-only.

## Look
- Flat: no gradient, glow or blur. Light and dark follow the system setting.
- One sans font (Segoe UI Variable / system-ui). Digits use tabular-nums.
- Tokens live in `:root` at the top of `index.html`.

## Status colors
| Status | Color |
| --- | --- |
| Accent and running | indigo `#4f46e5` (dark `#a5b4fc`) |
| Stalled, NOT READY | amber `#973c00` |
| Cut, gate FAIL | red `#c70036` |
| READY, gate PASS | green `#047857` (dark `#34d399`) |
| Done | gray, because done is the normal state |

## Layout (rebuilt: "run bar + compact steps + tabbed detail")
- Header:
  - Brand mark in the accent color.
  - Two pickers: **Project** (label + "n phiên · last run") and **Phiên** (session title, "Đang chạy" or last run, agent count). Below 1024px both menus open full width under the header.
  - Live dot.
- Run bar (full width, above both panes): what the whole run did.
  - Status icon, title ("Hoàn tất", "Dừng ở X", current step) and the auto verdict pill (READY / NOT READY) when the transcript has one.
  - Meta line: skill, agent count, start time, duration. Chips for running, stalled, cut.
  - Step pills for the whole pipeline (Spec → … → Knowledge), colored by state; a click opens that step and selects its agent. A fix round still shows the steps before Coding (from round 1). Below 1024px the pills are one scrolling row with a faded right edge.
  - Round tabs when there is more than one round, with the loop note.
- Left pane: one line per step (status icon, label, "n agent · duration", chevron). A step opens by itself only when it needs a look (running, stalled, cut, loop note), is current, or holds the selected agent; the user can open or close any step. Security and Verify are one step, "Security & Verify".
- Right pane (drawer below 1024px): selected agent.
  - Badge, name, sub line (type · round · start · duration).
  - Verdict card: the first "Gate:" / "## " line of the report, tinted by tone (PASS green, FAIL/CRITICAL red, warning amber).
  - "Now" box for running, stalled or cut agents.
  - Tabs: Báo cáo · Tool (count) · Brief. Paths inside the session's repo are shown relative to it.
- Sessions without a pipeline group agents by wave ("Đợt n"); agents outside the pipeline steps appear under "Khác".

## Rules
- Keyboard focus has no outline ring. The focused control takes the hover background.
- Scrollbars are 4px and auto-hide.
- Gap between rows is 4px.
- No native `<select>`.
