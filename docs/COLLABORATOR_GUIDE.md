# 墨台合作伙伴创作与开发入门手册

本文给第一次加入墨台项目的合作伙伴使用。目标是让你能顺利完成三件事：

1. 把 GitHub 上的工程下载到自己的电脑。
2. 在本机启动墨台，配置 AI，并开始创作。
3. 修改代码后用分支和 Pull Request 提交给团队。

如果你只参与写小说，不改代码，重点看“一、加入项目”“二、启动墨台”“三、配置 AI”“四、开始创作”和“九、小说内容如何共享”。如果你也参与开发，再继续看后面的代码协作流程。

## 一、加入项目

项目仓库：

```text
https://github.com/makemoremoney687/novel-studio
```

仓库是私有仓库。你需要先把自己的 GitHub 用户名发给仓库负责人，由负责人在 GitHub 仓库中邀请你。

负责人邀请流程：

1. 打开仓库页面。
2. 进入 `Settings`。
3. 打开 `Collaborators & teams`。
4. 点击 `Add people`。
5. 输入你的 GitHub 用户名或邮箱。
6. 权限选择 `Write`。
7. 你在邮箱或 GitHub 通知里接受邀请。

接受邀请后，你就能访问仓库、克隆代码、推送自己的分支和创建 Pull Request。

## 二、电脑需要安装什么

推荐 Windows 环境。

### 必装

- Git：用于下载和提交代码。
- Node.js 24 LTS：用于运行墨台本地服务。
- 浏览器：Edge、Chrome 都可以。

### 建议安装

- GitHub CLI：命令名是 `gh`，用于登录 GitHub、创建 Pull Request。
- VS Code 或 Cursor：用于编辑代码。

### 检查是否安装成功

打开 PowerShell，分别运行：

```powershell
git --version
node --version
npm --version
```

看到版本号就说明安装成功。Node.js 建议是 `v24.x`。

如果还安装了 GitHub CLI，可以继续运行：

```powershell
gh --version
gh auth login
```

登录时选择 GitHub.com，协议建议选 HTTPS。按浏览器提示完成授权。

## 三、第一次下载工程

在你想保存工程的目录打开 PowerShell，例如桌面或 `D:\Projects`。

```powershell
git clone https://github.com/makemoremoney687/novel-studio.git
cd novel-studio
Copy-Item .env.example .env.local
```

说明：

- `.env.example` 是配置模板，可以提交到 GitHub。
- `.env.local` 是你自己的本机配置，里面会保存 API Key，不会上传 GitHub。
- `data/db.json` 是你的本机作品数据库，也不会上传 GitHub。

然后检查工程：

```powershell
npm run check
```

如果检查通过，就可以启动：

```powershell
npm start
```

浏览器打开：

```text
http://127.0.0.1:5177
```

也可以双击工程目录里的 `打开墨台.vbs` 一键启动。

## 四、配置 AI

进入墨台后，点击顶部 `接口`。

### 文本写作接口

用于生成设定库、续写、润色、扩写、大纲、章节标题。

需要填写：

- 服务商
- API Key
- API 地址
- 模型名称
- 接口类型
- 输出上限
- 超时毫秒
- 代理地址，如果你的网络需要代理

常见示例：

```text
OpenAI API 地址：https://api.openai.com/v1
DeepSeek API 地址：https://api.deepseek.com
```

如果想让续写或按指令写一次生成约 2000 个中文字符：

```text
输出上限：3200
超时毫秒：30000
```

注意：ChatGPT 会员和 API 额度不是一回事。使用 API 一般需要单独开通额度。

### 图片生成接口

用于生成小说封面和主页图。

如果文本写作用 DeepSeek、Kimi、通义等纯文本模型，图片生成通常需要单独配置支持图片生成的 API。

推荐填写：

```text
图片 API 地址：https://api.openai.com/v1
图片模型：gpt-image-1
```

如果报 `404` 或 `AI route not found`，通常说明当前服务不支持 `/images/generations` 图片路由，或者 API 地址填错。

## 五、第一次创作一本小说

建议按这个顺序做：

1. 点击左侧 `+ 新作品`。
2. 填写作品名。
3. 填写类型，例如 `原创`、`同人`、`科幻`、`玄幻`。
4. 填写标签，例如 `系统, 热血, 成长`。
5. 填写第一章标题。
6. 填写一句话梗概。
7. 点击 `创建`。
8. 打开顶部 `项目` 页面，继续补充梗概。
9. 点击 `生成设定`。
10. 打开 `设定库`、`人物`、`世界观`、`时间线` 检查并修改生成内容。
11. 回到 `创作` 页面。
12. 打开 `AI 助手`。
13. 点击 `续写`，或输入要求后点击 `按指令写`。

`续写` 和 `按指令写` 会自动插入当前章节正文。

`扩写`、`润色`、`大纲`、`灵感` 会先生成到右侧结果框，确认后再点 `插入正文`。

## 六、怎样写好一句话梗概

一句话梗概要尽量具体。建议包含：

- 主角是谁
- 开局发生什么变化
- 主角有什么能力或限制
- 主要敌人或压力来自哪里
- 长期目标是什么
- 这本书的爽点是什么

弱梗概：

```text
主角穿越后变强。
```

更好的梗概：

```text
普通青年魂穿成即将进入超级学院的葛小伦，获得一个只能通过改变关键事件升级的系统；他必须在饕餮战争爆发前稳住身份、开发银河之力，并阻止卡尔提前开启虚空计划。
```

梗概越清楚，设定库、人物关系、大纲和章节规划越有用。

## 七、人物和关系图怎么写

`人物` 页面顶部会自动生成带箭头的关系图。下方文本建议这样写。

主要人物：

```text
葛小伦：银河之力，主角，目标是守住地球并开发自身能力。
赵信：雄兵连队友，速度型战士，和主角互相扶持。
卡尔：虚空威胁源头，远程布局观察主角成长。
系统：绑定主角，提供任务、训练加速和阶段奖励。
```

关系网：

```text
葛小伦与赵信是盟友。
葛小伦与卡尔是敌对。
天使彦守护并观察葛小伦。
系统训练葛小伦，但不会替他战斗。
```

这样人物关系图会更简洁，也更接近原剧关系图那种结构。

## 八、写作分工建议

如果多人一起创作，建议这样分工：

- 一个人负责主线大纲和章节规划。
- 一个人负责人物设定和关系网。
- 一个人负责世界观、势力、地点和战力体系。
- 一个人负责正文初稿。
- 一个人负责润色和连续性检查。

每次写正文前，先检查：

1. 当前章节标题是否和章节规划一致。
2. 本章剧情目标是否明确。
3. 本章冲突是什么。
4. 本章爽点是什么。
5. 结尾钩子是什么。
6. 是否违背已有设定和人物关系。

## 九、小说内容如何共享

当前项目不建议直接用 GitHub 同步小说正文。

原因：

- 小说正文保存在 `data/db.json`。
- 多个人同时修改同一个 JSON 数据库，很容易冲突。
- `data/db.json` 可能包含私人创作内容，不适合随代码一起提交。

推荐做法：

1. 在墨台里导出 Markdown、Word、PDF 或 TXT。
2. 把导出的文档发给伙伴审阅或修改。
3. 由负责人整理回墨台。

后续项目可以增加“作品包导入/导出”功能，用更安全的方式共享单本小说。

## 十、代码开发流程

如果你要改代码，不要直接改 `main` 分支。

每次开始前：

```powershell
git switch main
git pull --ff-only
git switch -c feature/简短功能名
```

分支命名建议：

```text
feature/新增功能
fix/修复问题
docs/只改文档
refactor/整理代码
```

例子：

```powershell
git switch -c feature/story-import-export
```

改完后先检查：

```powershell
npm run check
git status
```

如果 `npm` 找不到，但工程里有兼容 Node，可以临时运行：

```powershell
tools\node\node.exe --check server.js
tools\node\node.exe --check public\studio.js
tools\node\node.exe --check src\domain.js
tools\node\node.exe --check src\storage.js
tools\node\node.exe --test
tools\node\node.exe -e "JSON.parse(require('fs').readFileSync('data/db.example.json','utf8')); console.log('Example database JSON is valid.')"
```

## 十一、提交代码到 GitHub

只提交和本次任务有关的文件。

```powershell
git add README.md public/studio.js
git commit -m "feat: improve ai writing flow"
git push -u origin feature/简短功能名
```

提交信息建议用这些前缀：

```text
feat: 新功能
fix: 修复问题
docs: 文档
refactor: 代码整理
test: 测试
chore: 工程杂项
```

不要提交这些文件：

```text
.env.local
data/db.json
data/covers/
tools/node/
server.out.log
server.err.log
.motai.pid
```

## 十二、创建 Pull Request

推送分支后，打开 GitHub 仓库页面。

1. 点击 `Pull requests`。
2. 点击 `New pull request`。
3. base 选择 `main`。
4. compare 选择你的功能分支。
5. 填写标题和说明。
6. 写清楚改了什么、为什么改、怎么测试。
7. 创建 PR。

PR 描述建议格式：

```markdown
## 修改内容
- 

## 修改原因
- 

## 验证方式
- npm run check

## 注意事项
- 是否影响数据格式：
- 是否需要伙伴重新配置：
```

至少等一位伙伴检查后再合并。

## 十三、如何查看别人的提交

1. 打开 GitHub 仓库。
2. 点击 `Pull requests`。
3. 打开某个 PR。
4. 点击 `Commits` 查看提交记录。
5. 点击 `Files changed` 查看具体改动。
6. 对不理解的地方可以在代码行旁边留言。
7. 没问题后再合并。

## 十四、常见问题

### 网页打不开

1. 确认服务已启动。
2. 打开 `http://127.0.0.1:5177`。
3. 再双击一次 `打开墨台.vbs`。
4. 仍失败时，在工程目录运行：

```powershell
npm start
```

### AI 测试超时

检查：

- API Key 是否正确。
- API 地址是否只填根地址。
- 模型名称是否有权限。
- 是否需要代理。
- 账号是否有 API 额度。

### 图片生成失败

文本模型可用不代表图片模型可用。图片生成需要支持 `/images/generations` 的图片 API，并且账号要有图片模型权限。

### 拉取代码会不会覆盖我的小说

正常不会。小说保存在本机 `data/db.json`，该文件不进 Git。为了安全，更新代码前仍建议备份整个 `data/` 目录。

### 代码冲突怎么办

不要使用 `git reset --hard`。先暂停，把冲突截图或文件名发给团队，让改过对应文件的人一起处理。

## 十五、推荐阅读顺序

只创作：

1. 本文。
2. `README.md`。

参与开发：

1. 本文。
2. `docs/HANDOFF.md`。
3. `docs/ARCHITECTURE.md`。
4. `CONTRIBUTING.md`。

以后每次修改工程前，先读 `docs/HANDOFF.md`，确认当前项目目标和设计规范。
