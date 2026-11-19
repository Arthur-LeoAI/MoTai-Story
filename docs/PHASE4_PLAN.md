# Phase 4 (world): steps and status

Plan reference: `docs/SUMITALE_PLAN.md`, sections 5.6 and 8 (phase 4).

Done when: a world rule is used by the AI when it writes, and text that breaks the rule is flagged by the checks.

Branch: `feat/sumitale-phase-4`, on top of `main` after PR #4 (phase 3) was merged on 2026-11-18.

## What is there already

- Card types `location`, `faction` and `rule` exist in data model v6 (`src/canon-model.js`), with card questions: a place has `atmosphere` and `occupants`; a faction has `want`, `assets` and `fear`; a rule has `cost` and `exception`.
- Every rule card already becomes a hard `world_rule` fact (`deriveCanonFacts`), so it reaches the writing context and the chapter review. This has not been checked with the real AI.
- Relations have the kinds `ally` and `enemy`, which a stance between factions can use.
- The World page is still a placeholder. Places can be chosen on an event, but there is nowhere to make them, so the Timeline's "places" rows stay empty.

## Steps

| # | Step | Status |
|---|---|---|
| 1 | World page: the world in a sentence ("A world where ___, in which ___"), and rule cards with three questions: the rule, what it costs or limits, and its exceptions | Done |
| 2 | "Stress-test this rule" (AI): two or three "if so, why can't…?" questions about a rule; the writer's answers are added to the rule as a draft to confirm | Done |
| 3 | Places: cards (what it looks like, atmosphere, who is there), arranged in a simple hierarchy of region › city › place, shown by indenting. Needs a parent on place cards (data model change) | Done |
| 4 | Factions: cards (what they want, what they have, what they fear), and a stance matrix where each pair of factions is ally, neutral or enemy; a click on a cell changes it. Stored as relations | Done |
| 5 | Names linked in the manuscript: names, aliases and terms from cards are lightly underlined in the Write editor; hovering shows the card's summary and a click opens the card. The text itself (Quill Delta) is not changed | To do |
| 6 | Rules in AI writing: check with the real AI that rules reach the writing context as hard constraints and that text breaking a rule is flagged; fill any gap found | To do |

Steps 1 and 2 belong together, and so do 3 and 4. Step 5 does not depend on the others. Step 6 checks the whole and comes last.

## Testing

- Unit tests and E2E (Playwright, `data-testid`) run with the built-in test AI.
- Every AI feature (steps 2 and 6) is also checked with real API requests and real replies, in English and Chinese, on test data only.

## Progress

- 2026-11-19, steps 3 and 4: places and factions on the World page (`web/src/components/WorldCards.tsx`). A place card has what it looks like, what it feels like and who is there, and may sit inside another place (`parentId`, data model change): the list is a tree, indented by depth, with "Add inside" on each place. The server refuses a parent that is missing or not a place, and a loop (`CANON_PLACE_CYCLE`); deleting a place moves the places inside it up one level. A place's fact for the AI now says what it is part of ("Part of: Vell"). A faction card has who they are, what they want, hold and fear. With two factions or more, a stance matrix shows each pair as neutral, allies or enemies; a click cycles it. A stance is a relation of kind `ally` or `enemy` between the two factions (neutral is none), so it reaches the AI as a relationship fact. Places now also appear on the Timeline's "places" rows and in the event dialog. No AI involved.
- 2026-11-19, step 2: "Stress-test this rule" in the rule dialog (`src/rule-stress.js`). The AI asks three pointed questions about the saved rule ("If that is true, why can't…?", "What stops…?"), using the world sentence, the other rules and the people; the writer answers in their own words (empty answers are skipped), and the AI folds the answers into the rule's cost, exceptions and "more". That fills the dialog only; nothing is saved until the writer saves the rule. Unsaved changes must be saved first, so the questions are about the rule as it stands. Routes: `POST /api/works/:id/canon/drafts/rule-questions` and `/rule-answers` (`RULE_ANSWERS_REQUIRED` with no answer). Checked with real DeepSeek replies, English first: the questions are concrete and story-specific (they use Mira, Kael, Vell and the Governor). The first real runs showed the folding repeating one point in several fields and copying the prompt's "(none yet)" placeholder; the prompt now puts each point in one field, and the server treats the placeholder as empty and keeps a point that appears in two fields only in the first. An empty field from the AI never wipes what the card says. Also fixed: dialog fields stacked in a column took 200px of height each (rule and chapter card dialogs).
- 2026-11-18, step 1: the World page (`web/src/pages/World.tsx`) replaces the placeholder. At the top, the world in a sentence, with two blanks ("A world ___, in which ___" / "一个____的世界，在这里____"), saved when a blank is left, against the revision it was read at (`work.world`, `src/world.js`, `GET/PUT /api/works/:id/world`). Below, rule cards with three questions: the rule (the card's name, so it reads as in the mockup), what it costs or limits, and exceptions; "More" holds a longer explanation. A rule without a cost says that a rule that costs nothing makes little drama. A rule that is only its statement now still becomes a hard world-rule fact (`deriveCanonFacts`); before, a card needed a description to count. No AI involved. Not yet: the world sentence in the AI's context (step 6).
