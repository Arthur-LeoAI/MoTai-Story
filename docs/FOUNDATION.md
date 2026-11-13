# Phase 0 foundation: how it fits together

Plan reference: `docs/SUMITALE_PLAN.md`, sections 2, 6, 7 and 8 (phase 0).

## Commands

| Command | What it does |
|---|---|
| `npm start` | Runs `server.js`. `/` opens the new interface (`/app/`, after a build); the legacy workspace is at `/classic/`. |
| `npm run build:web` | Builds `web/` into `web/dist` (git-ignored). |
| `npm run dev:web` | Vite dev server on port 5290; proxies `/api` to the app on 5177. |
| `npm run check` | Syntax, translations, token contrast, TypeScript, unit tests, example data. |
| `npm run test:e2e` | Builds the frontend, then runs Playwright against a temporary database and the test AI. |

No global pnpm on the dev machine: use `npx -y pnpm@10 install`.

## Brand name

- Defined once in `shared/brand.json`: `name.default` ("Sumitale"), `name["zh-CN"]` ("墨台"). Both are provisional.
- Internal identifiers use `codename` ("novel-studio"): npm package name, browser storage keys (`novel-studio:*`).
- The frontend reads it through `web/src/brand.ts`; translations reference it as `$t(brand.name)`.
- Renamed with "read old, write new" (phase 1, step 5): backup format and file names, `NOVEL_STUDIO_*` environment switches (old `MOTAI_*` names still work). Still old, because they belong to the frozen desktop build or the legacy workspace: desktop data folder, `打开墨台.vbs`, `resources/motai.ico`, `package.json` `productName`/`build`, legacy `localStorage` keys `motai.*`.

## Languages

- Interface language: `en` (source) and `zh-CN`. Files: `shared/locales/*.json`, used by the new frontend and, for error codes, by the legacy frontend (`/locales/zh-CN.json`).
- Saved per user via `PATCH /api/me/preferences` and cached in the browser.
- Story language is a separate field, `work.language` (`en` | `zh-CN`); works created before it existed read as `zh-CN`.
- `npm run check:i18n` fails on missing or extra keys, mismatched placeholders, untranslated error codes, or unknown `t("…")` keys in `web/src`. At runtime, a missing key is logged as a console error, which fails the E2E tests.

## Error codes

- Server errors: `{ "error": { "code", "message", "params" } }`. `message` is the English fallback.
- Codes and HTTP statuses: `src/errors.js`. Throw with `appError("CODE", params)`.
- Adding a code: add it to `ERROR_STATUS`, then add `errors.CODE` to every locale file (the check enforces this).
- Unexpected errors become `INTERNAL_ERROR` without leaking internal text.

## Users and data

- `src/auth.js` → `authenticate(req)` is the single entry point; every `/api` request passes through it and handlers read `req.user`. In development it is always the user `local`.
- New data records its owner (`ownerId`) and is read and written only through the storage layer (`src/storage.js`; see `src/preferences.js` for the pattern). No new code reads or writes JSON files directly.
- Stories are read and written one at a time, so that a database can replace `data/db.json` (decided 2026-11-13: Supabase, i.e. hosted PostgreSQL; plan section 9):
  - `store.getWork(id)`, `store.listWorks(ownerId)`, `store.transactWork(id, fn)` for a change made inside one transaction, and `store.saveWorks({ upserts, removals })` for stories read earlier and changed in memory.
  - Every story has a `rowVersion` that storage moves on each stored change. `saveWorks` names the version that was read; if it has moved, nothing is saved (`WORK_UPDATED_ELSEWHERE`).
  - In `server.js`: `readWorkDb(workId)` and `readOwnerDb(ownerId)` read a unit of stories, `writeDb(unit)` saves the ones that changed, `transactStoredWork(workId, fn)` changes one in a transaction. `readDb()` (everything) is only for backup and restore.
  - Data outside stories is read and changed by collection: `readRecords` / `transactRecords` for lists (tasks, usage, import previews, receipts), `readDocument` / `transactDocument` for keyed values (user preferences, settings).

## Database

- Two storage backends with the same methods: the JSON file (`src/storage.js`, default) and PostgreSQL (`src/postgres-store.js`). `test/store-contract.test.js` runs one suite against both; `test/postgres-api.test.js` runs the main flows over HTTP on Postgres. Both use an in-process PostgreSQL (PGlite), never a real database.
- Choose with `NOVEL_STUDIO_STORAGE=postgres`; the connection is `DATABASE_URL`. The switch is explicit, so a connection string in the environment never changes the storage by itself. Both go in `.env.local`, which is not committed.
- For Supabase use the **Session pooler** connection string (Connect → Direct → Session pooler) with the database password filled in.
- TLS: `DATABASE_SSL` = `verify` (default for remote hosts), `no-verify` or `off` (default for this computer). `DATABASE_CA_FILE` = a certificate to trust, such as the one in the Supabase database settings. `DATABASE_POOL_SIZE` (default 5).
- Check the connection without changing anything: `node --env-file=<path to .env.local> scripts/check-database.cjs` (or `npm run check:database` where `.env.local` is in the working directory). It never prints the connection string.
- Tables are created on first use from `src/migrations/*.sql`, in the schema `novel_studio` (not `public`, which Supabase publishes through its REST API), with row level security on and no access for Supabase's API roles. Story data is stored as `json`, not `jsonb`, so that key order survives a round trip.
- Known limits: every write takes one lock row (`storeRevision`), so writes run one at a time, as with the file. Chapter history snapshots, covers and wallpapers are still files under `DATA_DIR`; on a server they need persistent disk or object storage (not done). Stories in an existing `data/db.json` are not copied over; use Settings → backup download, then restore after switching.

## Design tokens and fonts

- Tokens: `web/src/styles/tokens.css` (semantic names only; themes `paper` and `candle` via `html[data-theme]`).
- `npm run check:tokens` verifies WCAG AA contrast for text and graphic tokens in both themes.
- Known gap: control borders (`--color-border-strong`) are about 2.0–2.7:1 against the background, below the 3:1 that WCAG 1.4.11 asks for when a border is the only cue to a control's edge. This follows the approved mockup; review in phase 1.
- Fonts are bundled (see `docs/FONT_LICENSES.md`).

## Tests

- E2E selectors use `data-testid` and state attributes (`data-state`, `data-status`, `data-artifact`, `data-rewrite-count`) instead of copy or colours.
- `e2e/studio.spec.js`: legacy workspace (`/classic/`). The other specs cover the new interface: `foundation`, `ideate`, `write`, `settings`, `welcome`.
- Spec files run one at a time (`workers: 1`): they share one temporary database.
- Tests that read colours turn on reduced motion, so a reading never lands in the middle of a 200 ms colour fade.
