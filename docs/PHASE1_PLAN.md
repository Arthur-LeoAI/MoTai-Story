# Phase 1 (core rebuild): steps and status

Plan reference: `docs/SUMITALE_PLAN.md`, sections 5.1–5.4, 5.9 and 8 (phase 1).
Done when: every feature of the legacy workspace works in the new interface, and the legacy frontend is retired.

**Decision 2026-11-12:** the legacy workspace is not deleted yet. The new interface is the front door at `/`; the legacy workspace stays reachable at `/classic/` until the features it still has alone (see step 5) are rebuilt in phases 2–4. It is deleted then.

Phase 1 is delivered in steps. Each step leaves the app usable: pages not rebuilt yet say so and link to the legacy workspace, which keeps working (at `/classic/` since step 5).

| Step | Contents | Status |
|---|---|---|
| 1 | App frame and routing; Home: new story from one sentence, Shape/Write choice per story, story language, library | Done |
| 2 | Ideate: chat, chat history, streaming, story-material drafts | Done |
| 3 | Write: editor, chapters, AI panel (continue/expand/shorten/polish), diff preview, checks, canon proposals, history, scenes, focus mode | Done |
| 4 | Settings (AI model, usage, backup), import a manuscript, search, story settings (title, focus, language) | Done |
| 5 | English and Chinese sample stories; first-run flow; new interface as the front door, legacy workspace moved to `/classic/`; rename remaining brand identifiers with "read old, write new" | Done |

Cast, World, Timeline and Plot stay as placeholders through phase 1. (Phase 2 has since added the Cast card view; see `docs/PHASE2_HANDOFF.md`.) They are built in phases 2–4; their current legacy equivalent is the story-material page.

## Step 1: what exists now

- Routes (under `/app/`): `/` Home, `/works/:workId/:section` for the six story pages, anything else a "not found" page with a way back.
- Home follows the mockup: one-sentence premise, the Shape / Write choice, Begin, and the library.
- A story's **focus** (`shape` | `write`) is saved per story (`work.focus`). It decides where the story opens (Ideate or Write) and the order of the navigation; no page is locked. A story with no saved choice reads as `write` if it has text, otherwise `shape`.
- A story's **language** is chosen when it is created (defaults to the interface language) and is independent of the interface language afterwards.
- Library cards show length in the story's own unit: words for English stories, characters for Chinese ones.
- Default names created by the server ("Untitled story", "Chapter 1") follow the story language.
- The works list returns only the current user's stories.

## Step 5: what exists now

- **Front door**: `/` (and `/index.html`) opens the new interface at `/app/`. The legacy workspace is at `/classic/`; placeholder pages link there.
- **First-run welcome** on Home, shown once to a user with an empty library: choose the interface language, see whether AI is ready (configured, test AI, or not set up), then open the sample story or start your own. "Skip" also counts as seen. Stored per user as `welcomedAt` in preferences.
- **Sample stories**: an original English one (*The Cartographer's Sister*) and an original Chinese one (《雾港来信》), each with two short chapters and story material, in `shared/samples/`. `POST /api/works/samples` copies one into the library; it is the writer's copy to change. Also offered from the library ("Open a sample story").
- **Renames, read old / write new**:
  - Backups are written as format `novel-studio-backup`; `motai-backup` files still restore. The download is named `<brand>-backup-<time>.json`; automatic and pre-restore copies are `novel-studio-auto-…` / `novel-studio-before-restore-….backup.json`, and old `墨台-自动-….motai-backup.json` files still count toward retention.
  - Environment switches `NOVEL_STUDIO_TEST_AI`, `NOVEL_STUDIO_DESKTOP`, `NOVEL_STUDIO_E2E_PORT`; the `MOTAI_*` names still work.
  - The cover prompt no longer names the product.

## Features still only in the legacy workspace (`/classic/`)

These are why the legacy workspace is kept. Each has a planned home:

| Feature | Planned home |
|---|---|
| Editing story material by hand (outline, characters, world, timeline text) | Cast, World, Timeline, Plot pages (phases 2–4) |
| Viewing and editing canon facts ("正式设定") | Cast / World / Timeline (phases 2–4) |
| Writing preferences | Write settings (phase 5) |
| Volumes | Plot (phase 3) |
| Cover generation, cover history, chapter illustrations | Not scheduled yet |

Not renamed, because they belong to the frozen desktop build or to the legacy workspace: desktop data folder, `打开墨台.vbs`, `resources/motai.ico`, `package.json` `productName` / `build`, the legacy workspace's `motai.*` browser keys and its Chinese title.

## Step 4: what exists now

- **Settings** (`/app/settings`, linked from every page): choose the writing model from those the server offers, test the connection, see which providers are configured. No key or secret is entered or shown; they stay in the server's environment. Usage today against the daily limit, and recent AI tasks with their outcome. Backup: download, restore from a file (with a confirmation naming how many stories it replaces), and the automatic backup schedule.
- **Import a manuscript** (Home, library card): TXT, Markdown or DOCX; choose the story language and the text encoding; preview the chapters found; import. The new story opens in Write. English headings ("Chapter 1", "CHAPTER IV", "Chapter Two: …", "Part Two", "Prologue", "Epilogue") are now recognised besides Chinese ones; imported stories record their owner, language and Write focus.
- **Story settings** (click the story name in the side panel): title, premise, genre, Shape / Write focus, story language; export as Word, Markdown, plain text or web page; delete the story.
- **Search** within a story (side panel, Ctrl/⌘+K): finds chapters by title or text and opens the chapter in Write.

## Not in step 4

- Generated covers, wallpapers and chapter illustrations: not part of the new interface yet.
- Writing preferences and volumes: still only in the legacy workspace.
- Search covers chapter text and titles only; searching story material and facts comes with the structured data of phase 2.
- The backup file name and format id still contain the old name ("墨台备份", `motai-backup`); renaming with "read old, write new" is step 5.

## Step 3: what exists now

- **Editor**: the chapter as a printed page (Quill, no toolbar; type and paragraph indent follow the story language). Autosave after a short pause and before switching chapters or leaving. Length in words (English) or characters (Chinese).
- **Save conflicts**: if the chapter was saved in another window, nothing is overwritten silently. The writer chooses "keep this version" (the other one stays in history) or "load the saved version".
- **Chapters**: add, open, rename, reorder with buttons, move to the trash and restore. New chapters are named in the story's language. The open chapter is in the address (`?chapter=…`).
- **Focus mode**: only the page; Escape leaves it.
- **Assistant tab**: continue, expand, tighten, polish, or follow an instruction in plain words. Runs as a background task with live status and Stop. The suggestion is shown change by change and enters the chapter only when the writer adds it; the earlier text stays in history.
- **Checks**: a suggestion shows its consistency checks; a hard contradiction blocks adding it; a check can be marked "fine as written" with a reason. The Checks tab reviews the chapter and lists new facts to confirm one by one; after AI text is added, its queued review refreshes this list.
- **Scenes tab**: plan the scenes of a chapter (goal, obstacle, must / must not happen, ending, place, people, time, flashback, status), reorder, and tie a scene to a passage by selecting it.
- **History tab**: save a named version, compare an old version with the current text, restore it.
- Writing prompts for English stories now ask for English prose.

Checked with the built-in test AI only.

## Not in step 3

- The writing prompt, the consistency analysis and the fact extraction are still written for Chinese. English stories get an "answer in English" instruction on top; whether the checks catch problems in English prose has not been tried. A proper English prompt set is its own piece of work (plan 2.2).
- From the Write mockup: the scene brief tab, "the same scene in three styles" and the style library (plan 5.9, phase 5).
- Writing preferences (style, length targets), volumes and story-time fields of scenes (`storyTime`, point of view): still only in the legacy workspace.
- Chapter illustrations and export: step 4 or later.
- On wide screens the page shows two side columns (story pages, chapters). The mockup folds chapters behind a button; revisit when the layout is reviewed.

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
