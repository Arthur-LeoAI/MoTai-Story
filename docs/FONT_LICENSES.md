# Font licences (checked 2026-11-10)

The new frontend (`web/`) bundles its fonts with the app and does not use an
online font service. Each font was checked against the licence file in its npm
package and against the upstream `OFL.txt` in the Google Fonts repository
(`github.com/google/fonts`, folder `ofl/<family>`).

| Family | Used for | npm package (version) | Licence | Copyright (upstream OFL.txt) | Reserved Font Name |
|---|---|---|---|---|---|
| EB Garamond | Body text | `@fontsource/eb-garamond` 5.3.0 | SIL OFL 1.1 | Copyright 2017 The EB Garamond Project Authors | None declared |
| Cormorant Garamond | Display headings | `@fontsource/cormorant-garamond` 5.3.0 | SIL OFL 1.1 | Copyright 2015 The Cormorant Project Authors | None declared |
| IM Fell English | Italic tagline, numerals | `@fontsource/im-fell-english` 5.3.0 | SIL OFL 1.1 | Copyright (c) 2010, Igino Marini | None declared |
| IM Fell English SC | Latin wordmark | `@fontsource/im-fell-english-sc` 5.3.0 | SIL OFL 1.1 | Copyright (c) 2010, Igino Marini | None declared |
| Noto Serif SC | Chinese (Songti) | `@fontsource/noto-serif-sc` 5.3.1 | SIL OFL 1.1 | Copyright 2012 Google Inc. All Rights Reserved. | None declared |

The OFL licence text is identical in all five packages.

## What the licence allows and requires

- Use, bundling and redistribution with the app, including commercial use: allowed.
- Each copy must carry the copyright notice and the licence. The build ships
  them at `/app/licenses/fonts.txt` (source: `web/public/licenses/fonts.txt`).
- The fonts may not be sold on their own.
- Modified versions may not use a Reserved Font Name. None is declared, and we
  ship the files unmodified.

## Notes

- For IM Fell English / IM Fell English SC, the Fontsource package metadata
  lists the attribution as "Google Inc."; the upstream Google Fonts `OFL.txt`
  names Igino Marini. The shipped notice uses the upstream copyright line.
- Only the weights the design uses are bundled (see `web/src/fonts.ts`).
  Noto Serif SC is split into unicode-range chunks, so browsers download only
  the characters a page needs; the two bundled weights add about 9 MB to the
  build output.
- This is a reading of the licence texts, not legal advice. Before a public
  launch, have the full list of bundled third-party software reviewed.
