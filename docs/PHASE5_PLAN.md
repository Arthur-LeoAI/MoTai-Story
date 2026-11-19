# Phase 5 (writing enhancements): steps and status

Plan reference: `docs/SUMITALE_PLAN.md`, sections 5.5 (story-progress slider), 5.9 and 5.9.1 (writing styles), and 8 (phase 5).

Done when: a writing style reliably shapes what the AI writes.

Branch: `feat/sumitale-phase-5`, on top of `feat/sumitale-phase-4` (phase 4 is not merged into `main` yet).

Scope (decision 2026-11-18): build through phase 5, then stop. Phase 6 (launch preparation) is described in `docs/PHASE6_GUIDE.md` for the team to decide.

English writers come first: built-in styles, prompts and real-AI checks start in English; Chinese is kept working.

## What is there already

- "Tell it plainly" (scene from a plain account) and the scene brief were built in phase 2.
- `work.writingPreferences` (person, viewpoint, dialogue, banned words, things to avoid, samples) is saved through `PATCH /api/works/:id/preferences` and reaches the writing prompt only as raw JSON under a Chinese label. The new interface has no screen for it.
- Relations have `storyFrom` / `storyUntil`, but no screen sets them, so the relationship map cannot change over the story yet.

## Steps

| # | Step | Status |
|---|---|---|
| 1 | Writing styles: built-in style cards for each story language, with descriptive names only (no living authors). Each story has a default style; it shapes every AI writing request (continue, expand, polish, scene). Checked with the real AI: the same request in different styles reads differently, in the way each style says | To do |
| 2 | Your own styles: describe a style in a few words, paste a passage you like (the AI drafts a style card from it), or write the card by hand; export and import a style as a file; your styles are visible to you only | To do |
| 3 | Three ways: select a passage, ask for other ways, and see three versions side by side (tighter, richer, plainer, or three chosen styles); picking one replaces the selection, and undo brings the original back | To do |
| 4 | "Why it's written this way" (off by default): each version says in a sentence or two what technique it used, for writers who want to learn | To do |
| 5 | Story progress on the relationship map: a relationship can begin and end at a chapter; a slider shows how things stand as of each chapter | To do |

## Legal points from the plan, not settled here

- Built-in styles use descriptive names only, or authors whose work is in the public domain (such as Shakespeare). Whether naming living authors is acceptable needs professional advice before launch.
- What the terms of service say about passages a writer pastes in as a style sample needs professional advice before launch.

## Testing

- Unit tests and E2E (Playwright, `data-testid`) run with the built-in test AI.
- Every AI feature (steps 1 to 4) is also checked with real API requests and real replies, English first, on test data only.

## Progress

(None yet.)
