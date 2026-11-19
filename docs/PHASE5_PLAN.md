# Phase 5 (writing enhancements): steps and status

Plan reference: `docs/SUMITALE_PLAN.md`, sections 5.5 (story-progress slider), 5.9 and 5.9.1 (writing styles), and 8 (phase 5).

Done when: a writing style reliably shapes what the AI writes. **Reached 2026-11-19** (step 1).

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
| 1 | Writing styles: built-in style cards for each story language, with descriptive names only (no living authors). Each story has a default style; it shapes every AI writing request (continue, expand, polish, scene). Checked with the real AI: the same request in different styles reads differently, in the way each style says | Done |
| 2 | Your own styles: describe a style in a few words, paste a passage you like (the AI drafts a style card from it), or write the card by hand; export and import a style as a file; your styles are visible to you only | Done |
| 3 | Three ways: select a passage, ask for other ways, and see three versions side by side (tighter, richer, plainer, or three chosen styles); picking one replaces the selection, and undo brings the original back | Done |
| 4 | "Why it's written this way" (off by default): each version says in a sentence or two what technique it used, for writers who want to learn | Done |
| 5 | Story progress on the relationship map: a relationship can begin and end at a chapter; a slider shows how things stand as of each chapter | Done |

## Legal points from the plan, not settled here

- Built-in styles use descriptive names only, or authors whose work is in the public domain (such as Shakespeare). Whether naming living authors is acceptable needs professional advice before launch.
- What the terms of service say about passages a writer pastes in as a style sample needs professional advice before launch.

## Testing

- Unit tests and E2E (Playwright, `data-testid`) run with the built-in test AI.
- Every AI feature (steps 1 to 4) is also checked with real API requests and real replies, English first, on test data only.

## Progress

- 2026-11-19, step 5: story progress on the relationship map. A relationship can hold from a chapter and through a chapter ("Holds from" / "Holds through" in its dialog; `fromChapterId` / `untilChapterId` on relations, empty for the start / the end; a range that ends before it begins is refused). On the Cast map, "Story so far" is a slider from "the whole story" to each chapter, showing only what holds as of that chapter. For the AI, a relationship that begins in a chapter is known from that chapter on (the reader-order rule events and setups already use), and one that ends says so in its fact ("friends (until chapter 2)"). This deliberately does not change how facts are matched in story time (`src/temporal.js`): the existing `storyFrom` / `storyUntil` keep their own scale. No AI involved.
- 2026-11-19, steps 3 and 4: three ways, with "why it's written this way" (`src/variants.js`, `web/src/components/ThreeWays.tsx`, in the Write page's Assistant panel). Select a passage and get three versions side by side: tenser, richer and leaner (keeping the story's own style underneath), or three styles the writer picks. Each keeps the same events, people, dialogue meaning, point of view and tense, and reads on from the text around it (up to 1,500 characters before and after are sent for continuity). "Use this one" replaces the passage as an ordinary edit, so it is saved like typing and Ctrl+Z brings the original back; if the passage changed while the versions were being written, nothing is replaced. "Explain why each version works" (off by default, remembered in the browser) adds one or two plain sentences per version. Route: `POST /api/works/:id/variants` (`VARIANT_PASSAGE_REQUIRED`); nothing is saved on the server. **Checked with real DeepSeek replies**, English first: for "Mira was very angry with Kael…" the three angles kept every beat (liar, never trust you again, takes the map, leaves, he does not follow); the explanations were plain and useful ("Split her anger into short sentences and small physical moves… so each line adds pressure instead of just reporting feelings"). Three styles (Gothic, Hard-boiled, Early Modern) read clearly differently. Found and fixed: Hard-boiled switched the scene to Kael's first person, because the built-in card described it as a first-person voice; the card no longer does, and both styles and three ways now tell the AI to keep the point of view and tense. After the fix Hard-boiled stayed in the third person in two runs out of two. In Chinese the three angles kept the story's 章回体 style underneath, with plain explanations. Formatting inside a replaced passage (italics, bold) is not kept.
- 2026-11-19, step 2: your own styles (`src/user-styles.js`, `web/src/components/StyleManager.tsx`, opened with "Your styles…" under the style picker). Kept per writer (`GET/POST /api/me/styles`, `PUT/DELETE /api/me/styles/:id` with `baseRevision`; up to 100) and offered for stories in the same language. A new card starts from a few words or from a pasted passage (`POST /api/me/styles/draft`, AI; nothing is saved), or from a blank card. A draft from a passage describes how it is written: the prompt forbids quoting it, naming or guessing its author, and mentioning its people, places or events; its sample must be new writing on a different subject, and a sample that shares a run of 8 words (16 Chinese characters) with the passage is dropped. The passage itself is never stored. Export downloads a `.style.json` file; import adds it as an "imported" style with a new id. Deleting a style a story uses sends the story back to no particular style. **Checked with real DeepSeek replies:** from a passage written for the test (a grandmother's tin of letters), the card named the style "Plainspoken Retrospective", described it accurately (plain words, a narrator looking back, hurt arriving quietly, ending on a small concrete fact) and wrote a new sample about a father's can of mismatched screws, copying nothing; from the words "breathless, present tense, second person" it made a usable card with a matching sample; the same in Chinese. Fixed after the real check: a line break written as the characters "\n" in a draft becomes a real one.
- 2026-11-19, step 1: writing styles (`src/styles.js`, `web/src/components/StylePicker.tsx`). Built-in style cards, each with guidance and one short sample written for this project: English "Plain and spare", "Dramatic", "Gothic", "Lyrical", "Hard-boiled", "Early Modern (Shakespearean)"; Chinese 白描, 章回体, 武侠, 散文化 (its own set, not a translation). Descriptive names only. A story's default style is chosen at the top of the Write page's Assistant panel (`GET/PUT /api/works/:id/style`, `work.writingStyle`); a request may name another (`styleId`). Every writing request (continue, expand, polish, scene, and so on) now carries the style as its own section of the prompt, in the story's language, with the instruction that a style changes how a passage is told and never what happens. Styles are listed by `GET /api/styles?language=`. The writer's own styles will be kept per user (document collection `userStyles`, registered in the storage layer). **Checked with real DeepSeek replies:** the same English continuation (Mira hides on the quay until dawn) in three styles read three clearly different ways with the same events: Plain was short sentences and clipped dialogue; Gothic was long rolling sentences and dread ("drawn its silence close about itself like a mourner's shawl"); Hard-boiled was wry and terse ("counting is cheaper than praying"). In Chinese, with 章回体 as the story's default and no style named in the request, the continuation used 话说 / 且说 / 正是 / 且听下回分解. Seen in passing, not caused by styles: one continuation repeated the chapter's opening sentences; the existing repetition check catches that.
