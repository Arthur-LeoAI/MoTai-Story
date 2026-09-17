# 墨台工程架构

本文面向参与墨台开发的协作者。普通使用者只需阅读根目录 `README.md`。

## 设计原则

- 本地优先：作品正文、设定库和 API Key 默认只保存在用户电脑上。
- 后端零运行依赖：网页服务使用 Node.js 标准库；Windows 桌面安装包仅在打包和桌面运行时使用 Electron。
- 数据兼容：旧作品缺少新字段时在读取阶段补默认值，不要求迁移脚本。
- 先验证再合并：语法、领域规则、数据读写和主要 HTTP 接口均由 `pnpm run check` 检查；浏览器关键流程由 `pnpm run test:e2e` 检查。

## 分层结构

```text
浏览器 public/
    │ HTTP + JSON
    ▼
server.js                 路由、静态文件、AI 服务编排
    ├─ src/domain.js      作品、章节、设定库和大胆程度规则
    ├─ src/continuity.js  事实库、章节记忆、冲突、生成记录与数据升级
    ├─ src/ai-providers.js OpenAI/DeepSeek 凭据隔离、模型发现和请求适配
    └─ src/storage.js     本地 JSON 数据读取、事务与原子写入
         │
         ▼
      data/db.json        本机私有作品数据
      data/covers/        本机私有封面图片
      data/wallpapers/    本机私有自定义工作台壁纸
```

## Windows 桌面版

- `desktop/main.cjs`：Electron 主进程。启动随机本机端口的现有 HTTP 服务，并把它加载到安全的桌面窗口中。
- `desktop/data-runtime.cjs`：桌面私有数据路径、首次旧数据迁移、封面和 AI 配置复制逻辑。
- `package.json` 的 `build` 配置：Windows 64 位 NSIS 安装包配置，安装向导支持选择安装目录。
- `resources/motai.ico`：安装包、开始菜单和任务栏图标。

桌面版在 `%APPDATA%\墨台\` 保存 `data/db.json`、`data/covers/`、`data/wallpapers/` 与 `.env.local`。主进程在加载 `server.js` 前设置 `DATA_FILE` 和 `ENV_FILE`，因此网页 API 无需区分桌面或浏览器模式。桌面窗口开启 `contextIsolation`，禁用渲染层 Node 能力，并且只允许加载随机端口上的 `127.0.0.1` 页面。

`server.js` 只负责协调请求，不再重复实现作品规则和数据库写入细节。`createAppServer()` 可以被测试直接创建，也可以在执行 `node server.js` 时监听端口。

## 前端结构

- `public/index.html`：页面语义结构、主界面和面板容器。
- `public/studio.js`：新版工作台的状态、接口调用、AI 对话、资料草案、富文本编辑和自动保存。
- `public/studio.css`：新版工作台的布局、主题变量和响应式样式。
- `data/covers/`：用户本机生成或迁移出来的作品封面，由 `/data/covers/...` 只读访问。
- `data/wallpapers/`：用户上传或由图片模型生成的工作台壁纸，由 `/data/wallpapers/...` 只读访问。

作品正文不写入前端文件；所有保存操作都经过 `/api/works` 写入本地数据库。新版启动后直接进入工作台，并恢复可用的最近作品与章节；失效的作品或章节 ID 会安全回退，不影响作品数据库。API Key 仅由本地服务保存，前端读取配置时不会获得明文 Key。

## 主要数据流

1. 浏览器从 `GET /api/works` 获取作品摘要。
2. 进入作品后通过 `GET /api/works/:id` 读取完整章节和设定库。
3. 编辑操作通过 `PATCH` 保存；每个前端保存任务在创建时固定携带作品 ID（章节保存还携带章节 ID），切换作品后延迟请求只能写回原作品，不能污染新作品。存储层先写临时文件，再原子替换 `data/db.json`。
4. 旧数据库中的 base64 封面会在读取阶段迁移到 `data/covers/`，数据库只保留图片路径。章节插图也保存于该目录，文件名以 `illustration-` 开头，并在章节正文中用本地 Markdown 图片路径引用。
5. AI 生成封面使用独立的 `IMAGE_*` 图片接口配置：模型只绘制背景，服务端按 `coverStyle` 选择性叠加书名、类型标签、故事导语和作者署名，以保证中文标题准确可读。若四项均关闭，上传的成品封面会按原图保存，不产生重复水印。每部作品的 `coverHistory` 最多保留 16 个本地封面版本，生成和上传都会入库，可重新选为当前封面。
6. AI 写作只接受作品 ID、章节 ID、作者指令和选中文本；服务端重新读取权威作品、章节、已确认事实与最近章节记忆，拒绝基于旧章节版本的请求。
7. 生成后先执行重复段落规则检测，再由当前 AI 模型做语义连续性审校；硬冲突最多自动重写两次，仍未解决时阻止写入并把全部问题交给作者。
8. 可接受结果先保存为生成记录。作者确认后，正文、章节记忆和生成状态在同一事务中写入；从正文提取的事实另做提案，由作者逐条确认后才进入 Canon。正式运行没有本地预设回答；`MOTAI_TEST_AI=1` 只允许自动化测试使用隔离桩。
9. `GET /api/backup` 将作品库、本地封面和正文引用的章节插图打包为 `.motai-backup.json`，不读取或导出 `.env.local`。每次首次保存以及其后满 12 小时会异步创建自动快照，保存到 `data/backups/`，只保留最新 7 份；自动快照失败不会阻断正文保存。
10. `POST /api/backup/restore` 先写入一个本地回退快照，再校验并恢复作品与封面；AI 配置不参与恢复。
11. 自定义工作台壁纸可经 `POST /api/wallpapers/upload`、`POST /api/wallpapers/generate` 保存到本机 `data/wallpapers/`；生成请求可携带当前 `workId`，服务端仅读取该作品的资料来决定画面气质，并禁止把文字绘进背景。偏好只保存图片路径，不保存 base64 数据。壁纸不参与小说备份。

设定库的 `characters` 与 `relationships` 使用可解析的文本约定：人物每行以“姓名：身份｜目标：…｜秘密：…｜成长弧：…”开头；关系每行使用“甲 -> 乙：关系｜状态：…｜矛盾：…”。前端的结构化人物卡、关系卡和箭头图都只从当前作品这两个字段构建，避免跨作品或泛化名称造成错误节点。设定库顶部的“从梗概到正文”路线根据梗概、设定、人物关系、章节规划和正文状态计算 5 步完成度；质量检查的每项问题带有前端导航动作，可将用户定位到项目梗概、人物关系、时间线或设定库字段。`chapter.planning` 保存当前章节的目标、场景、出场人物、冲突和钩子，时间线看板按章节状态展示这些数据；章节列表可通过 `PATCH /api/works/:id/chapters/:chapterId` 重命名，并可通过同一路径的 `DELETE` 删除，允许作品暂时没有章节。

## HTTP 接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api` | 服务健康检查 |
| `GET/PATCH` | `/api/ui-preferences` | 读取或保存无敏感工作现场偏好 |
| `GET/POST` | `/api/works` | 查询或创建作品 |
| `GET/PATCH/DELETE` | `/api/works/:id` | 读取、修改或删除作品 |
| `GET` | `/api/works/:id/export?format=...` | 导出 Markdown、TXT、HTML、Word 或 PDF |
| `GET` | `/api/backup` | 导出完整作品库、本地封面和章节插图的备份包，不含 API Key |
| `GET` | `/api/backup/status` | 查询本地自动备份数量、保留策略和最后一次快照 |
| `POST` | `/api/backup/restore` | 校验并恢复备份包，自动保留恢复前快照 |
| `POST` | `/api/works/:id/story-bible/generate` | 生成设定库 |
| `POST` | `/api/works/:id/story-bible/check` | 检查设定完整度、章节可执行性、题材一致性和人物关系格式 |
| `POST` | `/api/works/:id/cover/generate` | 生成封面 |
| `POST` | `/api/works/:id/cover/rebuild` | 保留当前背景图，按作者、导语和封面样式重新生成信息排版 |
| `POST` | `/api/works/:id/cover/upload` | 保存用户选择的 PNG、JPG 或 WebP 本地封面 |
| `POST` | `/api/works/:id/cover/select` | 从该作品封面历史中恢复一个版本为当前封面 |
| `POST` | `/api/works/:id/chapters/:chapterId/images/generate` | 按当前章节与设定库生成并返回可插入正文的章节插图 |
| `POST` | `/api/works/:id/chapters/:chapterId/images/upload` | 保存用户图片并返回可插入正文的章节插图 Markdown |
| `POST` | `/api/wallpapers/upload` | 保存用户添加的 PNG、JPG 或 WebP 工作台壁纸 |
| `POST` | `/api/wallpapers/generate` | 通过已配置图片模型生成并保存工作台壁纸 |
| `POST/PATCH/DELETE` | `/api/works/:id/chapters/...` | 管理章节 |
| `POST` | `/api/ai/write` | AI 写作 |
| `GET/POST` | `/api/ai/config` | 读取或保存本地 AI 配置（仅服务商和对应 Key） |
| `POST` | `/api/ai/test` | 从官方模型列表自动选择写作模型并做最小连接测试 |
| `POST` | `/api/works/:id/chapters/:chapterId/generations/:generationId/accept` | 校验章节版本与冲突后原子写入生成正文 |
| `POST` | `/api/works/:id/canon-proposals/:proposalId/confirm` | 将作者勾选的事实写入 Canon |
| `POST` | `/api/works/:id/canon-proposals/:proposalId/reject` | 拒绝事实提案 |

## 测试边界

- `test/domain.test.js`：纯作品规则与旧数据兼容。
- `test/storage.test.js`：缺失数据库初始化、JSON 持久化和连续写入。
- `test/continuity.test.js`：数据升级、事实与章节记忆、硬冲突阻塞和事实提案原子应用。
- `test/ai-providers.test.js`：双 Key 隔离、模型发现、请求形状和响应解析。
- `test/server.test.js`：使用临时数据库启动真实 HTTP 服务，验证主页、作品生命周期、偏好和本地壁纸存储。
- `test/desktop-data-runtime.test.js`：验证旧数据库、封面和本地 API 配置的桌面迁移，不覆盖已有数据。
- `test/backup.test.js`：验证备份不包含 API Key、恢复保留回退快照、无效备份不破坏数据。
- `test/prompt-context.test.js`：验证设定库、当前章节规划与连续性提示会注入 AI 请求。
- `test/ai-context-api.test.js`：使用临时本地模拟 AI 验证设定库、正文、标题与封面接口的上下文传递。
- `e2e/studio.spec.js`：浏览器流程，覆盖新版工作台的核心作品、资料草案和正文 AI 交互。

所有测试只使用系统临时目录，不读取或修改真实 `data/db.json` 和 `.env.local`。

## 扩展约定

- 新的作品字段先在 `src/domain.js` 中定义默认值和归一化规则。
- 新接口应保持 JSON 错误格式 `{ "error": "说明" }`。
- AI 提示词可以调整，但不得绕过设定库上下文和大胆程度边界。
- 修改数据格式、路由或启动流程时，同时更新测试、README、`CHANGELOG.md` 和本文。
