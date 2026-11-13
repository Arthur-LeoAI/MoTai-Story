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
