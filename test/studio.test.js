const test = require("node:test");
const assert = require("node:assert/strict");

const {
  applyArtifactProposal,
  autoChatTitle,
  createArtifactProposal,
  createChatRecord,
  createMessage,
  ensureAiWorkspace,
  normalizeAiWorkspace,
  normalizeRichContent,
  plainTextToRichContent,
  revertArtifactProposal,
  richContentToMarkdown,
  selectChatContext
} = require("../src/studio");
const { emptyStoryBible } = require("../src/domain");

test("AI workspace normalization remains additive for old works", () => {
  const work = {};
  const workspace = ensureAiWorkspace(work, { createChat: true });
  assert.equal(workspace.chats.length, 1);
  assert.equal(workspace.activeChatId, workspace.chats[0].id);
  assert.deepEqual(normalizeAiWorkspace(null).proposals, []);

  const chat = createChatRecord();
  chat.messages.push(createMessage("user", "一个关于深海列车的故事"));
  assert.equal(autoChatTitle("  一个关于深海列车的故事。  "), "一个关于深海列车的故事");
  assert.equal(selectChatContext(chat, 8)[0].content, "于深海列车的故事");
});

test("artifact proposals support partial apply and one-step revert", () => {
  const work = { storyBible: { ...emptyStoryBible(), outline: "旧大纲", chapterPlan: "旧章纲" } };
  const proposal = createArtifactProposal(work, "chat_1", "outline", {
    outline: "新大纲",
    chapterPlan: "新章纲"
  });

  assert.throws(
    () => applyArtifactProposal(work, proposal, []),
    (error) => error.status === 400 && /至少选择一个/.test(error.message)
  );
  assert.equal(proposal.status, "pending");

  const applied = applyArtifactProposal(work, proposal, ["outline"]);
  assert.deepEqual(applied, ["outline"]);
  assert.equal(work.storyBible.outline, "新大纲");
  assert.equal(work.storyBible.chapterPlan, "旧章纲");
  assert.equal(proposal.status, "applied");

  revertArtifactProposal(work, proposal);
  assert.equal(work.storyBible.outline, "旧大纲");
  assert.equal(proposal.status, "reverted");
});

test("Quill Delta normalization keeps basic formatting and derives Markdown", () => {
  const richContent = normalizeRichContent({
    ops: [
      { insert: "标题" },
      { insert: "\n", attributes: { header: 2, color: "red" } },
      { insert: "重要", attributes: { bold: true } },
      { insert: "段落\n" },
      { insert: "列表项" },
      { insert: "\n", attributes: { list: "bullet" } }
    ]
  });

  assert.equal(richContent.version, 1);
  assert.equal(Object.hasOwn(richContent.ops[1].attributes, "color"), false);
  assert.equal(richContentToMarkdown(richContent), "## 标题\n**重要**段落\n- 列表项");
  assert.deepEqual(plainTextToRichContent("正文").ops, [{ insert: "正文\n" }]);
});
