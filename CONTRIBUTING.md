# 墨台协作规范

本仓库只同步程序代码，不同步每个人本机的小说正文、设定库、API Key 或运行文件。

## 首次准备

1. 安装 Git、Node.js 24 LTS 和 GitHub CLI。
2. 克隆私有仓库并进入目录。
3. 复制本地配置：

```powershell
Copy-Item .env.example .env.local
```

4. 按需填写 `.env.local`，然后运行：

```powershell
npm run check
npm start
```

程序会在第一次保存作品时自动创建本机 `data/db.json`。该文件不会上传 GitHub。

## 分支流程

不要直接在 `main` 上开发。开始任务前运行：

```powershell
git switch main
git pull --ff-only
git switch -c feature/简短功能名
```

分支前缀统一使用：

- `feature/`：新增功能。
- `fix/`：修复问题。
- `docs/`：只修改文档。
- `refactor/`：不改变功能的代码整理。

分支名称使用简短英文和连字符，例如 `feature/chapter-timeline`。

## 提交与合并

提交前必须运行：

```powershell
npm run check
git status
```

`npm run check` 包含语法检查、领域测试、存储测试和临时 HTTP 接口测试，不会读取真实作品数据库。

只提交与当前任务有关的文件：

```powershell
git add <文件路径>
git commit -m "feat: add chapter timeline"
git push -u origin feature/chapter-timeline
gh pr create
```

提交信息使用以下前缀：`feat:`、`fix:`、`docs:`、`refactor:`、`test:`、`chore:`。

Pull Request 必须说明修改内容、修改原因、验证方式以及是否影响数据格式。等待至少一位伙伴检查后再合并。

新增作品字段、接口或启动方式时，必须同步更新对应测试、`README.md` 和 `docs/ARCHITECTURE.md`。

## 同步与冲突处理

开发期间定期同步 `main`：

```powershell
git fetch origin
git rebase origin/main
```

发生冲突时只解决自己理解的文件，不使用 `git reset --hard` 或强制覆盖伙伴修改。无法确定时暂停合并并与对应作者确认。

## 禁止提交

- `.env.local` 或任何真实 API Key。
- `data/db.json`、`data/covers/`、小说正文、故事设定和本机生成封面。
- `tools/node/`、安装包、日志、PID、缓存和临时文件。
- 与当前功能无关的系统维护脚本或个人文件。

小说内容需要共享时，从墨台导出 Markdown 后通过双方约定的私密渠道传递，不放入本代码仓库。
