"use strict";
const { AsyncLocalStorage } = require("node:async_hooks");
const { createId, nowIso } = require("./domain");
const { fail } = require("./workspace");
const taskContext = new AsyncLocalStorage();
const terminal = new Set(["completed", "failed", "cancelled", "interrupted"]);
function createTaskService(store, execute) {
  let running = false, initialized;
  const controllers = new Map();
  async function init() {
    if (!initialized) initialized = store.transact(db => {
      db.tasks ||= []; db.usage ||= [];
      for (const task of db.tasks) if (!terminal.has(task.status)) { task.status = "interrupted"; task.message = "应用已重启，请重新执行。"; }
    });
    return initialized;
  }
  async function update(id, values) {
    return store.transact(db => {
      const t = db.tasks.find(t => t.id === id);
      if (!t || terminal.has(t.status)) return t;
      Object.assign(t, values, { updatedAt: nowIso() }); return t;
    });
  }
  async function pump() {
    if (running) return;
    running = true;
    try {
      while (true) {
        const db = await store.read(), task = db.tasks.find(t => t.status === "queued");
        if (!task) break;
        const controller = new AbortController(); controllers.set(task.id, controller);
        try {
          await update(task.id, { status: "generating" });
          const result = await taskContext.run({ taskId: task.id, workId: task.workId, stage: "generation", signal: controller.signal, update: values => update(task.id, values) }, () => execute(task.input));
          await update(task.id, { status: "completed", result });
        } catch (error) {
          await update(task.id, { status: controller.signal.aborted ? "cancelled" : "failed", message: error.message, errorStatus: error.status || 500 });
        } finally { controllers.delete(task.id); }
      }
    } finally { running = false; }
  }
  async function create(input) {
    await init();
    if (!input.requestId || typeof input.requestId !== "string" || input.requestId.length > 120) fail("缺少请求标识。");
    const task = await store.transact(db => {
      const prior = db.tasks.find(t => t.requestId === input.requestId);
      if (prior) {
        if (JSON.stringify(prior.input) !== JSON.stringify(input)) fail("请求标识已用于其他操作。", 409);
        return prior;
      }
      const task = { id: createId("task"), requestId: input.requestId, workId: input.workId, chapterId: input.chapterId, status: "queued", input, createdAt: nowIso(), updatedAt: nowIso(), draft: "" };
      db.tasks.push(task); return task;
    });
    void pump(); return task;
  }
  async function cancel(id) {
    await init();
    const task = await update(id, { status: "cancelled", message: "已取消；已生成的草稿仍保留。" });
    controllers.get(id)?.abort(); return task;
  }
  async function get(id) { await init(); return (await store.read()).tasks.find(t => t.id === id); }
  async function list(workId) { await init(); return (await store.read()).tasks.filter(t => !workId || t.workId === workId).slice(-100).reverse(); }
  async function wait(id) {
    while (true) {
      const task = await get(id);
      if (!task) fail("任务不存在。", 404);
      if (terminal.has(task.status)) {
        if (task.status !== "completed") fail(task.message || "任务未完成。", task.errorStatus || 409);
        return task.result;
      }
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }
  return { init, create, get, list, cancel, wait };
}
module.exports = { createTaskService, taskContext };
