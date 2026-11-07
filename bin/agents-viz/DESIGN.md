# DESIGN — agent-kit visualizer

## Brief
- Who uses it: a developer running `/agent:autopilot`, with the page open next to the terminal (about 900px wide) or full screen.
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
| Stalled | amber `#973c00` |
| Cut | red `#c70036` |
| Done | gray, because done is the normal state |

## Layout (option B, chosen 2026-11-07, with "Gọn chữ" and "Bỏ lặp")
- Header:
  - Brand.
  - One picker button for project and session. The menu lists sessions, then projects.
  - Live dot.
- Left pane:
  - Summary: step and round, meta line, and chips counting running, stalled and cut agents.
  - Round tabs, shown only when there is more than one round.
  - Steps listed vertically, each step's agents nested under it. Order: Spec → Spec gate → TDD → Coding → Security ‖ Verify (one position, marked "song song") → E2E → Archive → Knowledge.
  - A fix round starts again at Coding when the gates or E2E report defects; the earlier round ends with a loop note such as "E2E báo lỗi → sửa ở vòng 2".
- Right pane: the selected agent's detail. By default it opens the agent that most needs a look.
  - Badge and name.
  - A "now" box for running, stalled or cut agents.
  - Report.
  - Latest tools.
- Below 1024px the detail opens in a drawer. Esc closes it and returns focus to the row.
- Sessions without a pipeline group agents by wave ("Đợt n").
- Agents outside the pipeline steps appear under "Khác".
- Not built, per the user's choice:
  - On agent rows: line 2.
  - On the detail: meta grid, brief, and the step sub-line under the title.
  - On step headers: agent count.
  - In the summary: "done" chip.
  - In the round bar: "Bỏ qua" note.

## Rules
- Keyboard focus has no outline ring. The focused control takes the hover background.
- Scrollbars are 4px and auto-hide.
- Gap between rows is 4px.
- No native `<select>`.
