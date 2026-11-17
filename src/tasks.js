"use strict";
const { AsyncLocalStorage } = require("node:async_hooks");
const { createId, nowIso } = require("./domain");
const { fail } = require("./workspace");
const { appError, toErrorResponse } = require("./errors");
const taskContext = new AsyncLocalStorage();
// Tasks keep the error code so any client can translate it later.
function taskError(error) {
  const { status, body } = toErrorResponse(error);
  return { message: body.error.message, errorCode: body.error.code, errorParams: body.error.params, errorStatus: status };
}
const terminal = new Set(["completed", "failed", "cancelled", "interrupted"]);
function createTaskService(store, execute) {
  let running = false, initialized;
  const controllers = new Map();
  async function init() {
    if (!initialized) initialized = store.transactRecords("tasks", tasks => {
      for (const task of tasks) if (!terminal.has(task.status)) { Object.assign(task, { status: "interrupted" }, taskError(appError("TASK_INTERRUPTED_BY_RESTART"))); }
    });
    return initialized;
  }
  async function update(id, values) {
    return store.transactRecords("tasks", tasks => {
      const t = tasks.find(t => t.id === id);
      if (!t || terminal.has(t.status)) return t;
      Object.assign(t, values, { updatedAt: nowIso() }); return t;
    });
  }
  async function pump() {
    if (running) return;
    running = true;
    try {
      while (true) {
        const task = (await store.readRecords("tasks")).find(t => t.status === "queued");
        if (!task) break;
        const controller = new AbortController(); controllers.set(task.id, controller);
        try {
          await update(task.id, { status: "generating" });
          const result = await taskContext.run({ taskId: task.id, workId: task.workId, stage: "generation", signal: controller.signal, update: values => update(task.id, values) }, () => execute(task.input));
          await update(task.id, { status: "completed", result });
        } catch (error) {
          await update(task.id, { status: controller.signal.aborted ? "cancelled" : "failed", ...taskError(error) });
        } finally { controllers.delete(task.id); }
      }
    } finally { running = false; }
  }
  async function create(input) {
    await init();
    if (!input.requestId || typeof input.requestId !== "string" || input.requestId.length > 120) fail("REQUEST_ID_REQUIRED");
    const task = await store.transactRecords("tasks", tasks => {
      const prior = tasks.find(t => t.requestId === input.requestId);
      if (prior) {
        if (JSON.stringify(prior.input) !== JSON.stringify(input)) fail("REQUEST_ID_REUSED");
        return prior;
      }
      const task = { id: createId("task"), requestId: input.requestId, workId: input.workId, chapterId: input.chapterId, status: "queued", input, createdAt: nowIso(), updatedAt: nowIso(), draft: "" };
      tasks.push(task); return task;
    });
    void pump(); return task;
  }
  async function cancel(id) {
    await init();
    const task = await update(id, { status: "cancelled", ...taskError(appError("TASK_CANCELLED")) });
    controllers.get(id)?.abort(); return task;
  }
  async function get(id) { await init(); return (await store.readRecords("tasks")).find(t => t.id === id); }
  async function list(workId) { await init(); return (await store.readRecords("tasks")).filter(t => !workId || t.workId === workId).slice(-100).reverse(); }
  async function wait(id) {
    while (true) {
      const task = await get(id);
      if (!task) fail("TASK_NOT_FOUND");
      if (terminal.has(task.status)) {
        if (task.status !== "completed") throw appError(task.errorCode || "TASK_NOT_COMPLETED", task.errorParams, { status: task.errorStatus || 409 });
        return task.result;
      }
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }
  return { init, create, get, list, cancel, wait };
}
module.exports = { createTaskService, taskContext };
