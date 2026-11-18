"use strict";
const { appError } = require("./errors");
const { normalizeCanonObjects } = require("./canon-model");

// Timeline checks (plan 5.7 "automatic reminders" and "What's missing?").
//
// checkTimeline() finds contradictions in what the story already records,
// without AI, so it can run on every visit:
//   twoPlaces          one person in two places at the same time (two events
//                      with the same "when", in the writer's own words)
//   afterDeath         a person takes part in an event after a fact says they
//                      died
//   payoffBeforePlant  a setup paid off before the reader meets it
// Each problem names the events or setup it is about; the interface words it.
//
// missingRequest() asks the AI where cause and effect break between events.

// A fact says someone died; a fact that denies it does not count.
const DEATH = /\b(dead|died|dies|killed|deceased|murdered|executed|slain)\b|死|去世|身亡|遇害|丧生|牺牲|阵亡/i;
const NOT_DEATH = /\b(not|never|no longer|almost|nearly)\s+(dead|died|killed)\b|\balive\b|\bfaked\b|未死|没死|活着|假死|生还|幸存/i;
const MAX_GAPS = 5;

const clean = (value, limit) => (typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, limit) : "");
const isEnglish = (work) => work?.language === "en";

function storyIndex(work) {
  const canon = normalizeCanonObjects(work?.canon);
  const chapters = (work?.chapters || []).filter((chapter) => !chapter.deletedAt);
  const chapterIndex = new Map(chapters.map((chapter, index) => [chapter.id, index]));
  const names = new Map(canon.entities.map((entity) => [entity.id, entity.name]));
  const told = (event) => chapterIndex.get(event.chapterId) ?? -1;
  return { canon, chapters, chapterIndex, names, told };
}

function twoPlaces({ canon, names }) {
  const problems = [];
  const byWhen = new Map();
  for (const event of canon.events) {
    const when = event.timeLabel.trim().toLocaleLowerCase();
    if (!when || !event.locationId) continue;
    if (!byWhen.has(when)) byWhen.set(when, []);
    byWhen.get(when).push(event);
  }
  for (const events of byWhen.values()) {
    for (let a = 0; a < events.length; a += 1) {
      for (let b = a + 1; b < events.length; b += 1) {
        const [first, second] = [events[a], events[b]];
        if (first.locationId === second.locationId) continue;
        for (const personId of first.participantIds.filter((id) => second.participantIds.includes(id))) {
          problems.push({
            id: `twoPlaces:${personId}:${first.id}:${second.id}`,
            kind: "twoPlaces",
            eventIds: [first.id, second.id],
            params: { name: names.get(personId) || "", when: first.timeLabel, event1: first.title, place1: names.get(first.locationId) || "", event2: second.title, place2: names.get(second.locationId) || "" }
          });
        }
      }
    }
  }
  return problems;
}

function afterDeath(work, index) {
  const { canon, chapterIndex, names, told } = index;
  const problems = [];
  const facts = Array.isArray(work?.canon?.facts) ? work.canon.facts : [];
  for (const fact of facts) {
    if (fact?.category !== "life_status" || (fact.status && fact.status !== "active") || !fact.subjectId) continue;
    const said = `${fact.predicate || ""} ${fact.value || ""}`;
    if (!DEATH.test(said) || NOT_DEATH.test(said)) continue;
    const deathChapter = chapterIndex.get(fact.sourceChapterId) ?? -1;
    if (deathChapter < 0) continue;
    const theirs = canon.events.filter((event) => event.participantIds.includes(fact.subjectId));
    // The death happens after the last event the reader has met by that chapter.
    const known = canon.events.filter((event) => told(event) >= 0 && told(event) <= deathChapter);
    if (!known.length) continue;
    const diedAfter = Math.max(...known.map((event) => event.storyOrder));
    for (const event of theirs) {
      if (event.storyOrder <= diedAfter) continue;
      problems.push({
        id: `afterDeath:${fact.id || fact.subjectId}:${event.id}`,
        kind: "afterDeath",
        eventIds: [event.id],
        params: { name: names.get(fact.subjectId) || "", event: event.title, chapter: deathChapter + 1, fact: clean(said, 300) }
      });
    }
  }
  return problems;
}

function payoffBeforePlant({ canon, chapterIndex, told }) {
  const events = new Map(canon.events.map((event) => [event.id, event]));
  const place = (anchor) => {
    if (!anchor) return -1;
    if (anchor.kind === "chapter") return chapterIndex.get(anchor.id) ?? -1;
    const event = events.get(anchor.id);
    return event ? told(event) : -1;
  };
  return canon.setups
    .filter((setup) => setup.status !== "dropped")
    .map((setup) => ({ setup, planted: place(setup.plantedIn), paid: place(setup.paidOffIn) }))
    .filter(({ planted, paid }) => planted >= 0 && paid >= 0 && paid < planted)
    .map(({ setup, planted, paid }) => ({
      id: `payoffBeforePlant:${setup.id}`,
      kind: "payoffBeforePlant",
      eventIds: [setup.plantedIn, setup.paidOffIn].filter((anchor) => anchor.kind === "event").map((anchor) => anchor.id),
      setupId: setup.id,
      params: { setup: setup.description, planted: planted + 1, paid: paid + 1 }
    }));
}

function checkTimeline(work) {
  const index = storyIndex(work);
  return [...twoPlaces(index), ...afterDeath(work, index), ...payoffBeforePlant(index)];
}

// ---- What's missing? (AI) ----------------------------------------------------

/** Events in story order, each with a short reference the AI can point at. */
function eventLines(work, english) {
  const { canon, chapters, names, told } = storyIndex(work);
  const events = [...canon.events].sort((a, b) => a.storyOrder - b.storyOrder);
  const refs = new Map(events.map((event, index) => [`E${index + 1}`, event.id]));
  const lines = events.map((event, index) => {
    const chapter = told(event);
    const parts = [
      `E${index + 1}. ${event.title}`,
      event.summary ? `— ${clean(event.summary, 300)}` : "",
      event.timeLabel ? (english ? `(when: ${event.timeLabel})` : `（时间：${event.timeLabel}）`) : "",
      event.participantIds.length ? (english ? `[who: ${event.participantIds.map((id) => names.get(id)).filter(Boolean).join(", ")}]` : `［人物：${event.participantIds.map((id) => names.get(id)).filter(Boolean).join("、")}］`) : "",
      event.locationId && names.get(event.locationId) ? (english ? `[where: ${names.get(event.locationId)}]` : `［地点：${names.get(event.locationId)}］`) : "",
      chapter >= 0 ? (english ? `[told in chapter ${chapter + 1}: ${chapters[chapter].title}]` : `［第 ${chapter + 1} 章讲述：${chapters[chapter].title}］`) : (english ? "[not told yet]" : "［尚未讲述］")
    ];
    return parts.filter(Boolean).join(" ");
  });
  return { lines, refs };
}

function spineLines(work, english) {
  const spine = work?.spine && typeof work.spine === "object" ? work.spine : {};
  const items = [spine.once, spine.everyDay, spine.oneDay, ...(Array.isArray(spine.because) ? spine.because : []), spine.finally, spine.everSince].map((item) => clean(item, 400)).filter(Boolean);
  return items.length ? items.join(english ? " " : "") : "";
}

function missingRequest(work) {
  const english = isEnglish(work);
  const { lines } = eventLines(work, english);
  if (lines.length < 2) throw appError("TIMELINE_TOO_SHORT");
  const { canon } = storyIndex(work);
  const cast = canon.entities.filter((entity) => entity.type === "character").map((entity) => `${entity.name}${entity.summary ? `: ${clean(entity.summary, 200)}` : ""}`).join("\n");
  const setups = canon.setups.filter((setup) => setup.status === "open").map((setup) => `- ${setup.description}`).join("\n");
  const spine = spineLines(work, english);
  const prompt = (english ? [
    "Read the events of this novel in the order they happen, and find where cause and effect break: something a character knows, has, or does without any event showing how; a consequence that never follows; a jump the reader cannot cross.",
    `Story: "${work?.title || "Untitled story"}"`,
    `Premise: ${work?.premise || "none yet"}`,
    spine ? `The story spine: ${spine}` : "",
    `Characters:\n${cast || "none yet"}`,
    `Events, in the order they happen:\n${lines.join("\n")}`,
    setups ? `Setups planted and not paid off yet:\n${setups}` : "",
    `Name at most ${MAX_GAPS} gaps, the clearest first. For each, give the event after which something is missing (its E number), and say in one or two plain sentences what is missing and why the reader would notice; in that text, call events by their titles, never by E numbers. Name only gaps the events above show; do not invent facts about the story, and do not suggest how to fill the gap. If nothing is missing, return an empty list. Write in English.`
  ] : [
    "按发生顺序阅读这部小说的事件，找出因果断开的地方：人物知道、拥有或做了某件事，却没有任何事件说明是怎么来的；该有的后果没有出现；读者跨不过去的跳跃。",
    `作品：《${work?.title || "未命名作品"}》`,
    `一句话梗概：${work?.premise || "暂无"}`,
    spine ? `故事骨架：${spine}` : "",
    `人物：\n${cast || "暂无"}`,
    `事件（按发生顺序）：\n${lines.join("\n")}`,
    setups ? `已埋下、尚未回收的伏笔：\n${setups}` : "",
    `最多指出 ${MAX_GAPS} 处，最明显的在前。每一处给出缺口出现在哪个事件之后（E 编号），并用一两句平实的话说明缺了什么、读者为什么会注意到；说明里用事件标题称呼事件，不要写 E 编号。只指出上面事件能看出来的缺口；不要编造作品里没有的事实，也不要建议怎么补。如果没有缺口，返回空列表。用简体中文。`
  ]).filter(Boolean).join("\n\n");
  return {
    toolName: "report_missing_links",
    description: english ? "Report where cause and effect break between events" : "指出事件之间因果断开的地方",
    system: english ? "You read a novelist's timeline closely and point out gaps. Return them through the given tool." : "你仔细阅读小说作者的时间线，指出其中的缺口。请通过指定工具返回。",
    prompt,
    properties: {
      gaps: {
        type: "array",
        items: {
          type: "object",
          properties: {
            after: { type: "string", description: english ? "The E number of the event after which something is missing" : "缺口出现在哪个事件之后（E 编号）" },
            missing: { type: "string", description: english ? "What is missing, in one or two sentences" : "缺了什么，一两句话" }
          },
          required: ["after", "missing"]
        }
      }
    },
    required: ["gaps"]
  };
}

function normalizeMissing(raw, work) {
  const english = isEnglish(work);
  const { refs } = eventLines(work, english);
  const titles = new Map(normalizeCanonObjects(work?.canon).events.map((event) => [event.id, event.title]));
  // The writer never sees the E numbers: any that slip into the text become titles.
  const named = (text) => text.replace(/\(?\bE(\d{1,3})\b\)?/g, (whole, number) => {
    const title = titles.get(refs.get(`E${number}`));
    return title ? `“${title}”` : whole;
  });
  const items = Array.isArray(raw?.gaps) ? raw.gaps : [];
  const gaps = [];
  for (const item of items) {
    const missing = named(clean(item?.missing, 600));
    if (!missing) continue;
    const ref = clean(String(item?.after ?? ""), 12).toUpperCase().replace(/^E?/, "E");
    gaps.push({ afterEventId: refs.get(ref) || "", missing });
    if (gaps.length === MAX_GAPS) break;
  }
  return gaps;
}

/** Built-in test AI: one gap after the first event. */
function testMissing(work) {
  const english = isEnglish(work);
  const { lines } = eventLines(work, english);
  if (lines.length < 2) throw appError("TIMELINE_TOO_SHORT");
  return normalizeMissing({ gaps: [{ after: "E1", missing: english ? "Nothing shows how the next event comes about." : "没有事件说明下一件事是怎么发生的。" }] }, work);
}

module.exports = { checkTimeline, missingRequest, normalizeMissing, testMissing };
