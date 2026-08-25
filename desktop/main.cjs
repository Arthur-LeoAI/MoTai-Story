const path = require("path");
const { app, BrowserWindow, dialog, shell } = require("electron");
const {
  getDesktopDataPaths,
  pathExists,
  ensureDesktopDataDirectories,
  migrateLegacyData,
  saveMigrationState,
  hasMigrationState
} = require("./data-runtime.cjs");

const singleInstance = app.requestSingleInstanceLock();
let mainWindow = null;
let localServer = null;
let localUrl = "";

app.setName("墨台");
app.setAppUserModelId("com.motai.novelstudio");

if (!singleInstance) {
  app.quit();
}

function focusMainWindow() {
  if (!mainWindow) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

app.on("second-instance", focusMainWindow);

async function chooseLegacyDatabase(paths) {
  const answer = await dialog.showMessageBox({
    type: "question",
    title: "导入旧版数据",
    message: "没有检测到可自动迁移的旧版作品库。是否现在导入？",
    detail: "选择旧工程中的 data\\db.json 后，会同时复制封面和本地 AI 配置。",
    buttons: ["选择旧数据库", "新建空白作品库"],
    defaultId: 0,
    cancelId: 1
  });

  if (answer.response !== 0) {
    await saveMigrationState(paths, { skipped: true });
    return;
  }

  const selection = await dialog.showOpenDialog({
    title: "选择旧版 db.json",
    properties: ["openFile"],
    filters: [{ name: "墨台数据库", extensions: ["json"] }]
  });
  if (selection.canceled || !selection.filePaths[0]) {
    await saveMigrationState(paths, { skipped: true });
    return;
  }

  try {
    const result = await migrateLegacyData({ paths, legacyDbFile: selection.filePaths[0] });
    await saveMigrationState(paths, { imported: result.migrated, sourceDbFile: selection.filePaths[0] });
  } catch (error) {
    await dialog.showMessageBox({
      type: "error",
      title: "导入失败",
      message: "无法导入旧版数据",
      detail: error.message
    });
  }
}

async function prepareDesktopData() {
  const paths = getDesktopDataPaths(app.getPath("userData"));
  await ensureDesktopDataDirectories(paths);
  if (await pathExists(paths.dbFile)) {
    return paths;
  }

  const sourceRoot = process.env.MOTAI_LEGACY_ROOT || (app.isPackaged ? "" : app.getAppPath());
  try {
    const result = await migrateLegacyData({ paths, legacyRoot: sourceRoot });
    if (result.migrated) {
      await saveMigrationState(paths, { imported: true, sourceDbFile: result.sourceDbFile });
      return paths;
    }
  } catch (error) {
    await dialog.showMessageBox({
      type: "warning",
      title: "自动迁移未完成",
      message: "未能自动导入旧版数据",
      detail: error.message
    });
  }

  if (!(await hasMigrationState(paths))) {
    await chooseLegacyDatabase(paths);
  }
  return paths;
}

async function startLocalServer(paths) {
  process.env.MOTAI_DESKTOP = "1";
  process.env.DATA_FILE = paths.dbFile;
  process.env.ENV_FILE = paths.envFile;
  process.env.PORT = "0";

  // server.js reads these paths at module load, so it is required only after configuration.
  const { createAppServer } = require("../server.js");
  localServer = createAppServer();
  await new Promise((resolve, reject) => {
    localServer.once("error", reject);
    localServer.listen(0, "127.0.0.1", () => {
      localServer.off("error", reject);
      resolve();
    });
  });
  const address = localServer.address();
  localUrl = `http://127.0.0.1:${address.port}`;
}

function stopLocalServer() {
  if (!localServer) {
    return;
  }
  const server = localServer;
  localServer = null;
  server.close();
}

function isLocalMotaiUrl(url) {
  return url.startsWith(`${localUrl}/`) || url === localUrl;
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    title: "墨台",
    backgroundColor: "#151515",
    icon: path.join(__dirname, "..", "resources", "motai.ico"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:/i.test(url)) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isLocalMotaiUrl(url)) {
      return;
    }
    event.preventDefault();
    if (/^https:/i.test(url)) {
      shell.openExternal(url);
    }
  });
  mainWindow.loadURL(localUrl);
}

app.on("before-quit", stopLocalServer);
app.on("window-all-closed", () => app.quit());
app.on("activate", () => {
  if (!mainWindow && localUrl) {
    createMainWindow();
  }
});

async function boot() {
  if (!singleInstance) {
    return;
  }
  const paths = await prepareDesktopData();
  await startLocalServer(paths);
  createMainWindow();
}

app.whenReady().then(boot).catch(async (error) => {
  await dialog.showMessageBox({
    type: "error",
    title: "墨台无法启动",
    message: "桌面应用启动失败",
    detail: error.message
  });
  app.quit();
});
