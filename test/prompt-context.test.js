const test = require("node:test");
const assert = require("node:assert/strict");
const { buildAiPrompt, buildImagePrompt, buildStoryBiblePrompt } = require("../server");

const work = {
  title: "超神学院之我是葛小伦",
  genre: "同人",
  premise: "卢小鱼魂穿葛小伦，绑定系统后加入雄兵连，在卡尔与虚空压力下改写地球命运。",
  tags: ["系统", "雄兵连"],
  boldness: 60,
  storyBible: {
    worldview: "超神学院、雄兵连、饕餮入侵与天使恶魔博弈同时压向地球。",
    characters: "卢小鱼承担葛小伦身份；蕾娜负责训练；卡尔是远期敌人。",
    factions: "雄兵连、超神学院、饕餮、天使与冥河。",
    conflict: "主角必须在系统任务和原作命运之间选择。",
    continuityNotes: "当前仍在雄兵连征召前，不能提前获得反虚空完全体。",
    chapterPlan: [
      "第1章｜我叫葛小伦｜剧情目标：确认魂穿与系统激活｜成长点：体质觉醒｜爽点：首次感受银河之力｜冲突：身份错位｜结尾钩子：三天内接触超神学院",
      "第2章｜雄兵连征召｜剧情目标：进入超神学院｜成长点：暗能量感知｜爽点：训练表现超预期｜冲突：杜卡奥起疑｜结尾钩子：饕餮警报"
    ].join("\n")
  }
};

const chapter = {
  title: "第一章 我叫葛小伦",
  status: "draft",
  content: "卢小鱼从车祸后的黑暗中醒来。"
};

test("AI 写作提示词每次注入设定库、当前章纲和连续性提醒", () => {
  const prompt = buildAiPrompt({ mode: "continue", work, chapter, instruction: "写开头" });
  for (const fragment of ["世界观", "人物", "雄兵连", "卡尔", "当前应推进的章节规划", "第1章｜我叫葛小伦", "连续性提醒", "不能提前获得反虚空完全体", "写开头"]) {
    assert.match(prompt, new RegExp(fragment));
  }
  assert.match(prompt, /只输出小说正文/);
});

test("设定库和封面提示词保留题材、主线与章节推进信息", () => {
  const biblePrompt = buildStoryBiblePrompt(work);
  const imagePrompt = buildImagePrompt(work, "银河战士站在巨峡号甲板，星空战场");

  for (const fragment of ["葛小伦", "卢小鱼", "系统", "雄兵连", "卡尔", "虚空", "10-12章详细章纲"]) {
    assert.match(biblePrompt, new RegExp(fragment));
  }
  for (const fragment of ["世界观", "人物", "势力/组织", "主线冲突", "巨峡号甲板"]) {
    assert.match(imagePrompt, new RegExp(fragment));
  }
});

test("失忆重逢题材的设定提示词要求明确人物和箭头关系", () => {
  const romanceWork = {
    title: "再一次，喜欢你",
    genre: "原创",
    premise: "男主因事故失忆，遗忘了与女主相爱的数年。女主只说两人以前认识，直到他重新爱上她后开始想起真相。",
    tags: ["都市", "纯爱", "失忆", "重逢"]
  };
  const prompt = buildStoryBiblePrompt(romanceWork);
  for (const fragment of ["都市失忆重逢情感策略", "自然、易记", "甲 -> 乙", "不要硬塞系统", "重大事件"]) {
    assert.match(prompt, new RegExp(fragment.replace(/[()]/g, "\\$&")));
  }
});
