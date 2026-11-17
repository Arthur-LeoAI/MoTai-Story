# Phase 3 (timeline and plot): steps and status

Plan reference: `docs/SUMITALE_PLAN.md`, sections 5.7, 5.8 and 8 (phase 3). Mockups: `project/Timeline.dc.html` and `project/Plot.dc.html` in the design artifact.

Done when: a writer can tell part of the story as a flashback and see a reminder for a setup that has not been paid off.

Branch: `feat/sumitale-phase-3`, on top of `main` after PR #3 (phase 2) was merged on 2026-11-17.

| Step | Contents | Status |
|---|---|---|
| 1 | Timeline page: the events as a list in two orders, "as it happened" (story order) and "as it is told" (chapter order, flashbacks marked); new event in a sentence ("And then what happened?"); edit, delete and reorder events | Done |
| 2 | The chart of persons and events (swimlanes): rows by person, by plot thread or by place; columns follow the chosen order | Done |
| 3 | Setups and payoffs: plant and pay off a setup (chapter or event); the setup line on the chart; "Planted, not yet paid off" reminders | Done |
| 4 | Plot: the story spine (six sentences, from "Once upon a time…" to "And ever since…"); AI suggestions for an empty line | To do |
| 5 | Chapter cards: one card per chapter with what it must do and what it leaves us with; columns by state (idea, planned, drafted, finished); reorder and move between columns | To do |
| 6 | Timeline checks: contradictions shown on the timeline (reusing the consistency checks), and "What's missing?" (AI) | To do |

Every AI feature is also checked with real requests and replies (the user's rule); the automated suites stay on the built-in test AI.

Not in phase 3: the story-progress slider on the relationship graph and "Suggest missing links" (phase 5), places and factions as cards (phase 4).

## Progress

- 2026-11-17, step 3: setups and payoffs (`web/src/components/Setups.tsx`, below the list and the chart on the Timeline page). A setup says what is planted, where it is planted and where it pays off (a chapter or an event, or not decided), and whether it waits, is paid off or was dropped. Setups that are planted and still waiting are listed as reminders ("Planted, not yet paid off"); ideas not planted yet and settled setups are listed apart. On the chart each planted setup is a row: a filled diamond where it is planted, a dashed line to where it pays off, and a hollow diamond where it still waits (at its planned payoff, or the end of the chart). A setup planted in a chapter sits at the first event that chapter tells; a setup with no such event is counted under the chart. Dropped setups leave the chart. The API and model already existed (data model v6); no AI involved.
- 2026-11-17, step 2: the chart of persons and events beside the list (`web/src/components/TimelineChart.tsx`), as in the mockup's Fig. 2. Rows by person, plot line or place (only rows with at least one event); columns are the events in the order the list shows, flashbacks marked; a dot where a row takes part, a line from its first to its last event; a column opens its event. It is a table, so it reads row by row with a screen reader; on narrow screens it scrolls inside its card. Plot lines can now be started and chosen in the event dialog. The row choice is remembered in the browser. No AI involved. Places stay empty until the World page lets writers make place cards (phase 4).
- 2026-11-17, step 1: Timeline page (`web/src/pages/Timeline.tsx`). Two orders of the same events: as it happened (story order; moved up and down with buttons, saved with `POST /api/works/:id/canon/events/order`, which names every event once against the canon revision it was read at) and as it is told (by the chapter that tells each event, events not told yet last). An event told after one that happens later is marked as a flashback. New event in a sentence; a dialog for what happens, when (the writer's words), the chapter that tells it, who takes part and where; delete asks first; a change saved elsewhere is not overwritten. The chosen order is remembered in the browser. No AI involved, so no real-API check was needed. Not yet: dragging to reorder (buttons only), threads on events.
