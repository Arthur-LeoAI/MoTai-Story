const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeTemporalFact, selectTemporalFacts, invalidateDependencies,
  classifyConflict, adjudicateConflict
} = require('../src/temporal');

const fact = (extra = {}) => ({ id: 'f1', status: 'active', strength: 'hard', scope: 'truth', storyFrom: 0, readerOrder: 0, ...extra });
const ids = (values) => values.map((item) => item.id);

test('an ability cannot be used before acquisition or disclosed before reader learns it', () => {
  const ability = fact({ storyFrom: 8, readerOrder: 8 });
  assert.deepEqual(selectTemporalFacts([ability], { storyTime: 1, readerOrder: 1 }), []);
  assert.deepEqual(selectTemporalFacts([ability], { storyTime: 9, readerOrder: 7 }), []);
  assert.deepEqual(ids(selectTemporalFacts([ability], { storyTime: 8, readerOrder: 8 })), ['f1']);
  assert.deepEqual(selectTemporalFacts([ability], { storyTime: 9 }), []);
});

test('historical superseded state is selected for flashbacks, half-open intervals do not overlap', () => {
  const states = [
    fact({ id: 'alive', status: 'superseded', storyFrom: 0, storyUntil: 10 }),
    fact({ id: 'dead', storyFrom: 10, readerOrder: 10 })
  ];
  assert.deepEqual(ids(selectTemporalFacts(states, { storyTime: 5, readerOrder: 20 })), ['alive']);
  assert.deepEqual(ids(selectTemporalFacts(states, { storyTime: 10, readerOrder: 20 })), ['dead']);
  assert.ok(!ids(selectTemporalFacts(states, { readerOrder: 20 })).includes('alive'));
  assert.deepEqual(selectTemporalFacts([fact({ storyFrom: 5, storyUntil: 5 })], { storyTime: 5, readerOrder: 20 }), []);
});

test('beliefs belong to their knower and are never promoted to world truth', () => {
  const belief = fact({ scope: 'belief', knowerId: 'lin', belief: 'mistaken' });
  assert.deepEqual(selectTemporalFacts([belief], { storyTime: 2, readerOrder: 2, povId: 'mei' }), []);
  assert.deepEqual(selectTemporalFacts([belief], { storyTime: 2, readerOrder: 2 }), []);
  const [selected] = selectTemporalFacts([belief], { storyTime: 2, readerOrder: 2, povId: 'lin' });
  assert.equal(selected.belief, 'mistaken');
  assert.equal(selected.scope, 'belief');
  assert.equal(selected.strength, 'soft');
});

test('author-only, stale and review-pending facts cannot enter writing context', () => {
  const facts = [fact({ id: 'hidden', scope: 'author' }), fact({ id: 'stale', status: 'stale' }), fact({ id: 'review', needsReview: true }), fact({ id: 'ok' })];
  assert.deepEqual(ids(selectTemporalFacts(facts, { storyTime: 2, readerOrder: 2 })), ['ok']);
});

test('unknown story placement becomes a soft confirmation, not a hard blocker', () => {
  const [unknownTime] = selectTemporalFacts([fact()], { readerOrder: 2 });
  assert.equal(unknownTime.temporalUncertain, true);
  assert.equal(unknownTime.strength, 'soft');
  const [unknownStart] = selectTemporalFacts([fact({ storyFrom: null })], { storyTime: 2, readerOrder: 2 });
  assert.equal(unknownStart.temporalUncertain, true);
  assert.equal(unknownStart.strength, 'soft');
  const evidence = [{ factId: 'f1', excerpt: '他仍活着。' }];
  assert.equal(classifyConflict({ severity: 'hard', evidence, temporalUncertain: true }), 'confirmation');
  assert.equal(classifyConflict({ severity: 'hard', evidence }), 'contradiction');
  assert.equal(classifyConflict({ severity: 'hard', evidence, category: 'style' }), 'suggestion');
  assert.equal(classifyConflict({ severity: 'hard', evidence: [] }), 'confirmation');
});

test('normalization does not invent times from numeric strings or invalid revisions', () => {
  const normalized = normalizeTemporalFact({ storyFrom: '8', storyUntil: Infinity, sourceRevision: -1, effectiveOrder: 7 });
  assert.equal(normalized.storyFrom, null);
  assert.equal(normalized.storyUntil, null);
  assert.equal(normalized.sourceRevision, null);
  assert.equal(normalized.readerOrder, 7);
});

test('dependency invalidation propagates to recorded downstream facts, memories and generations only', () => {
  const work = {
    canon: { facts: [
      { id: 'source-fact', sourceChapterId: 'c1' },
      { id: 'next-fact', sourceChapterId: 'c2' },
      { id: 'independent-fact', sourceChapterId: 'unrelated' }
    ] },
    chapters: [
      { id: 'c1', content: '原文一', chapterMemory: { status: 'active' } },
      { id: 'c2', content: '原文二', chapterMemory: { status: 'active', context: { factVersions: [{ id: 'source-fact', version: 1 }] } } },
      { id: 'c3', content: '原文三', chapterMemory: { status: 'active', context: { chapterMemoryChapterIds: ['c2'] } } },
      { id: 'unrelated', content: '独立原文', chapterMemory: { status: 'active' } }
    ],
    generationRecords: [
      { id: 'g1', chapterId: 'c3' },
      { id: 'g2', chapterId: 'c4', context: { canonFactIds: ['next-fact'] } },
      { id: 'g3', chapterId: 'other', context: { chapterVersions: [{ id: 'unrelated', version: 1 }] } }
    ]
  };
  const beforeProse = work.chapters.map((chapter) => chapter.content);
  const result = invalidateDependencies(work, { chapterId: 'c1', reason: '修正第一章' });
  assert.deepEqual(result.chapterIds.sort(), ['c1', 'c2', 'c3']);
  assert.deepEqual(result.factIds.sort(), ['next-fact', 'source-fact']);
  assert.deepEqual(result.generationRecordIds.sort(), ['g1', 'g2']);
  assert.deepEqual(work.chapters.map((chapter) => chapter.content), beforeProse);
  assert.equal(work.chapters[3].chapterMemory.status, 'active');
  assert.equal(work.canon.facts[2].needsReview, undefined);
  assert.equal(work.generationRecords[2].needsReview, undefined);
  assert.equal(work.chapters[1].chapterMemory.reviewReason, '修正第一章');
});

test('fact-only changes and circular dependencies terminate with stable impact sets', () => {
  const work = { canon: { facts: [
    { id: 'a', context: { canonFactIds: ['b'] } },
    { id: 'b', context: { canonFactIds: ['a'] } }
  ] }, chapters: [{ id: 'c', chapterMemory: { status: 'active', factIds: ['b'] } }] };
  const result = invalidateDependencies(work, { factIds: ['a'] });
  assert.deepEqual(result.factIds.sort(), ['a', 'b']);
  assert.deepEqual(result.chapterIds, ['c']);
  assert.deepEqual(invalidateDependencies(work, { factIds: ['a'] }).factIds.sort(), ['a', 'b']);
});

test('false-positive adjudication records reason and immutable evidence snapshot', () => {
  const record = { conflicts: [{ id: 'conflict', evidence: [{ factId: 'f1', excerpt: '原文' }] }] };
  const result = adjudicateConflict(record, 'conflict', { reason: ' 这是倒叙 ', baseRevision: 3, currentRevision: 3, canonRevision: 4, currentCanonRevision: 4 });
  assert.equal(result.status, 'resolved');
  assert.equal(result.resolution.note, '这是倒叙');
  assert.equal(result.resolution.baseRevision, 3);
  record.conflicts[0].evidence[0].excerpt = '修改后的引用';
  assert.equal(result.resolution.evidence[0].excerpt, '原文');
});

test('stale revisions and review-pending records cannot be adjudicated; reason required', () => {
  const record = { conflicts: [{ id: 'c', evidence: [] }] };
  const args = { reason: '依据', baseRevision: 2, currentRevision: 2, canonRevision: 3, currentCanonRevision: 3 };
  for (const override of [{ baseRevision: 1 }, { canonRevision: 1 }]) {
    assert.throws(() => adjudicateConflict(record, 'c', { ...args, ...override }), (error) => error.status === 409);
  }
  assert.throws(() => adjudicateConflict({ ...record, needsReview: true }, 'c', args), (error) => error.status === 409);
  assert.throws(() => adjudicateConflict(record, 'c', { ...args, reason: ' ' }), (error) => error.status === 400);
  assert.throws(() => adjudicateConflict(record, 'c', { ...args, currentRevision: undefined }), (error) => error.status === 400);
  assert.throws(() => adjudicateConflict(record, 'missing', args), (error) => error.status === 404);
  assert.equal(record.conflicts[0].status, undefined);
});
