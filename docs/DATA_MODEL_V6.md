# Data model v6: structured story objects

Plan reference: `docs/SUMITALE_PLAN.md`, section 4. Code: `src/canon-model.js` (shapes, derived facts), `src/canon-store.js` (reads and writes), `src/canon-api.js` (routes). Tests: `test/canon-model.test.js`, `test/canon-api.test.js`.

## What a story holds now

`work.canon` is the single source of structured story data:

| Collection | Fields (besides `id`, `ownerId`, `revision`, `createdAt`, `updatedAt`) |
|---|---|
| `entities` | `type` (character, location, faction, item, rule), `name`, `aliases`, `summary`, `card`, `notes`, `image`, `color` |
| `relations` | `fromId`, `toId`, `kind` (family, friend, lover, mentor, rival, enemy, ally, custom), `label`, `tension`, `storyFrom`, `storyUntil` |
| `events` | `title`, `summary`, `storyOrder`, `timeLabel`, `chapterId`, `participantIds`, `locationId`, `threadIds` |
| `threads` | `name`, `color` |
| `setups` | `description`, `plantedIn`, `paidOffIn` (each `{ kind: "chapter" \| "event", id }` or null), `status` (open, paid, dropped) |
| `facts` | unchanged from v5 |

- **Cards.** `card` holds the few key questions of the entity's type (`CARD_FIELDS`): for a character `want`, `obstacle`, `change`, `appearance`, `voice`, `secret`, `background`; for a rule `cost`, `exception`; and so on. Only keys are stored; the interface translates them. A card's type cannot be changed after creation.
- **Colours** are palette keys the interface maps to design tokens, never colour values.
- **Story time.** A relation's `storyFrom` / `storyUntil` use the same half-open interval and the same scale as temporal facts and `scene.storyTime`. An event's `storyOrder` is only an order; `chapterId` is the chapter that tells it (reader order), empty when it is not told yet.
- **`work.storyBible` stays** as free-text notes (decision 2026-11-13). The legacy workspace and the Ideate drafts keep reading and writing it. Nothing is converted.
- The v5 entity types `event` and `foreshadowing` are still read, but cannot be created; events and setups are their own collections.

## Upgrading from v5

Reading v5 data adds the empty collections and the new entity fields, gives missing ids, removes references to objects that do not exist, and sets `schemaVersion` to 6. Old relationship facts stay facts. The upgrade is idempotent. As before, a copy of the old file is written to `data/backups/` first.

## How the objects reach the consistency checks

`deriveCanonFacts(work)` turns the objects into facts on every read; they are never stored, so they cannot drift from their source. `continuityFacts(work)` (stored facts + derived facts) is what the writing context and the chapter review select from.

| Object | Derived fact | Notes |
|---|---|---|
| Entity with a summary, card answers or aliases | `derived:entity:<id>` | A rule is a hard `world_rule`; other cards are soft guidance. `notes` are not included. |
| Relation | `derived:relation:<id>` | `relationship`, over the relation's story-time interval |
| Event told in a live chapter | `derived:event:<id>` | Known from that chapter on. An event no chapter tells yields nothing, so writing cannot reveal a plan early. |
| Setup planted in a live chapter (directly or through an event) | `derived:setup:<id>` | Dropped: nothing. Paid: recorded as resolved. |

Wording inside derived facts follows the story language (`work.language`). `describeCanon(work)` gives the cards and relationships as text for the Ideate conversation prompt.

Known limit, unchanged from v5: `selectTemporalFacts` treats any fact without a place in story time as soft. A rule card therefore does not block generated text yet. Making rules binding is phase 4 (plan 5.6).

## Revisions and invalidation

- Every object has its own `revision`. `PATCH` and `DELETE` must send it as `baseRevision`: missing is `BASE_REVISION_REQUIRED` (428), stale is `REVISION_CONFLICT` (409). A save that changes nothing moves no revision.
- Every change moves `work.canonRevision` (the objects live inside `canon`, which `bumpVersions` compares). Generated text and reviews made before the change are refused as before (`GENERATION_STALE`, `REVIEW_BASIS_STALE`).
- A change calls `invalidateDependencies` with the derived facts that depended on the object, so only generations, chapter memories and stored facts built on it are marked for review:
  - a card edit: the entity's own fact;
  - a rename: also the relations and events that spell the name;
  - an event moved to another chapter: also the setups anchored to it;
  - a removed entity: also its relations (removed with it), and the stored facts about it (kept, marked for review);
  - reordering or deleting chapters: the events and setups tied to those chapters.
- Review reasons written by this module are codes (`canon_object_changed`, `canon_object_removed`), not prose.

## Routes

| Route | Does |
|---|---|
| `GET /api/works/:workId/canon` | All collections except facts, plus `canonRevision` |
| `POST /api/works/:workId/canon/:collection` | Create; 201 with `{ item, impacts, canonRevision }` |
| `PATCH /api/works/:workId/canon/:collection/:itemId` | Change the named fields (`baseRevision` required); `card` merges by key, an empty string clears a key |
| `DELETE /api/works/:workId/canon/:collection/:itemId` | Remove (`baseRevision` required); `{ removed: { id, relationIds }, impacts, canonRevision }` |

`:collection` is `entities`, `relations`, `events`, `threads` or `setups`. Requests are checked against the story's owner. Error codes: `CANON_ITEM_NOT_FOUND`, `CANON_NAME_REQUIRED`, `CANON_ENTITY_TYPE_UNSUPPORTED`, `CANON_REFERENCE_NOT_FOUND` (with `field`), `CANON_RELATION_SELF`, `CANON_STORY_RANGE_INVALID`.

## Not done in this step

- Interface: the Cast page shows and edits character cards (`web/src/pages/Cast.tsx`). The relationship graph, capture from conversation and the cards of the other types (places, factions, things, rules) are still to come.
- Ideate drafts still write text into `storyBible`; they do not create cards.
- The sample stories carry no cards yet.
- Search does not cover the new fields.
- No endpoint reorders events in one call (Timeline, phase 3).
