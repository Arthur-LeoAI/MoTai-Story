const { start } = require("./server.cjs");

module.exports = async function setup() {
  // Keep ownership in this process: Playwright's Windows webServer cleanup uses
  // taskkill /T, which can hang when process-tree inspection is unavailable.
  // A fresh isolated database and test AI are mandatory, even if another app runs.
  return start();
};
