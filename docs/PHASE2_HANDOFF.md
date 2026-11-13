# Phase 2 handoff (written 2026-11-13)

For the session that starts phase 2. Read this first, then the files listed below.

## Where things stand

- Repository for this work: the user's personal repo `Arthur-LeoAI/MoTai-Story` (git remote `personal`). It is public for now; the user will make it private when everything is done, then move the work back to the original repo.
- Phase 0 (PR #1) and phase 1 (PR #2) are merged into `main` of the personal repo (merge commit `4ccd4b6`). CI on `main`: 99 unit tests and 45 E2E tests pass.
- This file is the first commit on `feat/sumitale-phase-2`, branched from that `main`. Continue on this branch.
- The new interface (`web/`, served at `/app/`) is the front door at `/`. The legacy workspace (`public/`) stays at `/classic/` until the features only it has are rebuilt; the list and their planned homes are in `docs/PHASE1_PLAN.md`, section "Features still only in the legacy workspace".
- Working agreement: small commits on the branch; ask the user before pushing and before opening or merging a PR. Commits pushed to the personal repo must use the GitHub noreply address (already set as the worktree's repo-local `user.email`); GitHub rejects the private one.

## Progress

- 2026-11-13: data model v6 is in (`docs/DATA_MODEL_V6.md`): structured objects in canon, derived facts, routes, revisions and invalidation. No interface yet.
- 2026-11-13: decided to replace `data/db.json` with Supabase (plan section 9, row 6); the user reconfirmed a hosted website with subscriptions over a local app with users' own API keys.
- 2026-11-13: Cast page, card view (plan 5.5): characters as cards with the three main questions (want, obstacle, change) and more under "More"; create, edit, delete; a change made in another window is not overwritten (load the saved version). Earlier character notes from story material are shown read-only. Not yet: the relationship graph, AI completion of a card from one sentence, finding characters in the manuscript, portraits and colours.
- 2026-11-13: storage reads and writes per story and per collection; PostgreSQL backend added and tested on an in-process PostgreSQL (`docs/FOUNDATION.md`, "Database"). Not yet run against the real Supabase project.

## What phase 2 is

`docs/SUMITALE_PLAN.md`, section 8: "Shape: data model v6 and migration, character cards, relationship graph, capture from conversation. Write: tell it plainly → prose, scene brief, extract characters and events from an imported manuscript."

Start with the data model (section 4 of the plan). Everything else in phase 2 builds on it.

## Decisions already made

- **Model**: the user asked for this step to run on Fable (their checklist: data model v6, and changes to `src/continuity.js` / `src/temporal.js` logic).
- **Existing data is throwaway** (user, 2026-11-13). All stories in the project are test content and may be deleted. So **no conversion of old stories is required** for v6. Keep the existing habit of a `schemaVersion` bump, but the read-time migration of old `storyBible` text can be minimal (for example, keep each old text field as a `notes` value) or simply refuse old data with a clear error. Confirm the choice with the user before writing it.
- **Do not touch the real `data/db.json`** (in the main checkout, `D:\Claude\projects\MoTai\data\db.json`). If it should be emptied, the user does it, or explicitly tells you to. Tests use temporary databases only.
- **Do not read or print `.env.local`**, and never type an API key anywhere.
- No global pnpm: use `npx -y pnpm@10`.

## The problem to solve

Today a story has two separate sources of truth:

1. `work.storyBible`: 18 free-text fields (`STORY_BIBLE_FIELDS` in `src/domain.js`): logline, theme, tone, genrePositioning, worldview, rules, era, characters, relationships, factions, locations, conflict, antagonistPressure, keyEvents, foreshadowing, continuityNotes, outline, chapterPlan. Written by the writer and by AI drafts in Ideate.
2. `work.canon`: structured `entities` (types: character, location, event, faction, item, rule, foreshadowing) and `facts` (subject, predicate, value, object, category, strength, status, supersedes / superseded-by, source chapter and generation). Used by the consistency checks and the writing context.

Plan section 4 makes **canon the single source** and adds first-class objects: Entity (with `summary`, type-specific `card`, `notes`, optional image and colour), Relation (from, to, kind, label, tension, story-time range), Event (title, summary, story order, telling chapter, participants, location, threads), Thread (plot line), Setup / Payoff (foreshadowing). Facts stay as the low-level record the checks use.

Things to get right:

- **Revisions.** `bumpVersions` in `src/workspace.js` derives `canonRevision` from `[canon, storyBible]` and `structureRevision` from a structure snapshot. Generations, reviews and fact proposals are only accepted against matching revisions. The new objects must move the right revision, and nothing that is currently protected may become unprotected.
- **Dependency invalidation.** `invalidateDependencies` in `src/temporal.js` marks facts, chapter memories and generation records stale when their sources change. Editing a character, relation or event must invalidate what depended on it, and only that.
- **Time.** `src/temporal.js` already has story-time intervals, reader order, truth / belief / author views and knowers. Relations and events should reuse these semantics rather than invent new ones.
- **Every reader of `storyBible`.** It is used in about 58 places in `server.js` (chat and draft prompts, `compactStoryBible`, `englishStoryMaterial`, the writing prompt `buildAiPrompt`, story-bible generation and quality checks, cover and illustration prompts, export), in `src/studio.js` (Ideate drafts are applied to and undone from `storyBible`), `src/domain.js`, `src/workspace.js`, `src/beta-api.js`, the legacy `public/studio.js` (the story-material page at `/classic/`), and the new `web/src/pages/Ideate.tsx`, `web/src/ideateApi.ts`, `web/src/api.ts`. Decide for each: read the new model, or derive text from it during the transition. The legacy workspace must keep working until it is retired.
- **Ownership and storage.** New data records `ownerId` from `req.user` (single entry point `src/auth.js`) and is read and written only through the storage layer (`src/storage.js` transactions; see `src/preferences.js` for the pattern). No direct JSON file access in new code.
- **Errors and text.** New API errors use codes from `src/errors.js` with English and Chinese text in `shared/locales/*.json` (the check enforces it). Field labels are not stored; the interface translates keys. Prompts follow the story's language (`work.language`), not the interface language.

## Files to read first

| File | Why |
|---|---|
| `docs/SUMITALE_PLAN.md` sections 4, 5.4–5.9, 8 | Target model and the phase 2 features |
| `docs/PHASE1_PLAN.md` | What the new interface already does, and what it does not |
| `docs/FOUNDATION.md` | Conventions: brand, languages, error codes, users, tokens, tests |
| `src/continuity.js` | Canon entities and facts, `upgradeDatabase`, `applyCanonProposal`, `selectContinuityContext` |
| `src/temporal.js` | Temporal facts, `invalidateDependencies`, conflict adjudication |
| `src/workspace.js` | `upgradeWorkspace`, `bumpVersions`, revisions and history snapshots |
| `src/domain.js`, `src/studio.js` | `storyBible` normalisation; Ideate drafts (apply / undo) |
| `server.js` | All `storyBible` readers listed above; work creation (`createWorkRecord`) |

## Checks before calling a piece done

- `npm run check` (syntax, translations, token contrast, type check, unit tests, example data) and `npm run test:e2e` (builds `web/` first). E2E spec files run one at a time on one temporary database.
- Tell the user plainly what was done, what was verified and what was not.

## Stop and hand over before

Launch preparation (accounts and sign-in, replacing `db.json` with a database, porting `main`'s security hardening), or after two failed attempts at the same problem.
