# Phase 1 (core rebuild): steps and status

Plan reference: `docs/SUMITALE_PLAN.md`, sections 5.1–5.4, 5.9 and 8 (phase 1).
Done when: every feature of the legacy workspace works in the new interface, and the legacy frontend is retired.

Phase 1 is delivered in steps. Each step leaves the app usable: pages not rebuilt yet say so and link to the legacy workspace at `/`, which keeps working until step 5.

| Step | Contents | Status |
|---|---|---|
| 1 | App frame and routing; Home: new story from one sentence, Shape/Write choice per story, story language, library | Done |
| 2 | Ideate: chat, chat history, streaming, story-material drafts | Done |
| 3 | Write: editor, chapters, AI panel (continue/expand/shorten/polish), diff preview, checks, canon proposals, history, scenes, focus mode | Not started |
| 4 | Settings (AI model, usage, backup), import a manuscript, search, story settings (title, focus, language) | Not started |
| 5 | English and Chinese sample stories; first-run flow; retire `public/`; rename remaining brand identifiers with "read old, write new" | Not started |

Cast, World, Timeline and Plot stay as placeholders through phase 1. They are built in phases 2–4; their current legacy equivalent is the story-material page.

## Step 1: what exists now

- Routes (under `/app/`): `/` Home, `/works/:workId/:section` for the six story pages, anything else a "not found" page with a way back.
- Home follows the mockup: one-sentence premise, the Shape / Write choice, Begin, and the library.
- A story's **focus** (`shape` | `write`) is saved per story (`work.focus`). It decides where the story opens (Ideate or Write) and the order of the navigation; no page is locked. A story with no saved choice reads as `write` if it has text, otherwise `shape`.
- A story's **language** is chosen when it is created (defaults to the interface language) and is independent of the interface language afterwards.
- Library cards show length in the story's own unit: words for English stories, characters for Chinese ones.
- Default names created by the server ("Untitled story", "Chapter 1") follow the story language.
- The works list returns only the current user's stories.

## Step 2: what exists now

- Ideate is a real page: a conversation with the assistant that streams its reply, can be stopped, and can be retried after a failure. Failures are explained by translating the server's error code.
- Conversations: start a new one, switch, rename, delete. The one last opened is remembered.
- "Draft with AI" for the four kinds of story material (outline, characters, world, timeline). A draft appears in the conversation; the writer keeps it part by part, can undo a kept draft, or discard it. Nothing is saved before that.
- The side panel shows the premise and what story material exists so far (read-only).
- The assistant's instructions follow the **story** language: English stories get English instructions and "reply in English"; Chinese stories keep the existing Chinese instructions. Prompts no longer contain the product name.
- Field names in drafts are translated in the interface from their keys; the stored Chinese labels are ignored by the new frontend.

Checked only with the built-in test AI, which always answers in Chinese. How a real model follows the English instructions has not been tried.

## Not in step 2

- From the Ideate mockup: answer chips under a question, "add this character to Cast" capture, the cast medallions and "still to find out" list. They need the structured story data of phase 2.
- Editing story material by hand: it stays in the legacy workspace until Cast / World / Timeline are built.
- An "AI is not connected" indicator and model choice: step 4 (settings).

## Not in step 1 (so nobody looks for it)

- The "Import a manuscript" card from the Home mockup: step 4.
- The interview questions after the first sentence (plan 5.3, steps 2–4): they need Ideate, step 2.
- "Next step" suggestions on library cards beyond "continue": phase 2, they need structured story data.
- Covers on library cards use the typographic placeholder from the mockup, not generated cover images.

## Model check before each step

Per the working agreement, stop and hand over before: the data model v6 migration, changes to the logic in `src/continuity.js` / `src/temporal.js`, or launch preparation (accounts, database, security hardening). Steps 1–5 above need none of these.
