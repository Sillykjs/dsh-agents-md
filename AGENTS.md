# AGENTS.md — dsh-agents-md

本文件是这个仓库的智能体文档：给以后接手这个项目的编码智能体（以及人）一份最少够用的上下文。
面向用户的说明在 `README.md`，这里只写「为什么这样做、改哪里、别踩什么坑」。

## 1. 项目是什么

一个 DSH Web 插件：在对话页签栏加「智能体文档」页签，列出并编辑 DSH 当前会话实际加载的
`AGENTS.md` / `CLAUDE.md` / `*.local.md`，保存后从下一条消息开始生效。

- 零运行时依赖、无构建步骤、纯 ESM（`"type": "module"`）
- host 半：一个 Cordis 插件（`export const name` / `export const inject`），注册同源 JSON 路由
- client 半：一个**预构建**单文件浏览器模块（`window.__ModuleLoader__.load`），向 `conversation.view` 槽位注册视图
- 目标 DSH：0.2.1-rc.2（`~/.dsh/profiles/web`），Node >= 20

## 2. 目录

```
lib/index.js        host 半：路由 / 指令文件发现 / 版本校验写入 / WSL 打开目录
lib/client.js       client 半：页签注册、文件列表、Markdown 预览、编辑器、样式、词典
cordis.patch.yml    bundle patch：让 `dsh plugin add` 把插件插进 profile
test/smoke.mjs      host 路由冒烟测试（假 webServer + 真 HTTP + 临时目录）
test/client.mjs     client 契约测试（VM 里假 React / slots / locale）
README.md           用户文档（功能、安装、路由表、已知边界）
```

## 3. host 半（`lib/index.js`）

### 路由

全部 `POST`，JSON 请求/响应；前缀 `/__dsh-agents-md/`。

| 路由 | 请求 | 响应 |
| --- | --- | --- |
| `list` | `{ cwd }` | `{ ok, cwd, projectRoot, budget, totalBytes, files[] }` |
| `read` | `{ cwd, path }` | `{ ok, path, exists, content, version, size, mtimeMs }` |
| `write` | `{ cwd, path, content, version }` | `{ ok, path, version, size, mtimeMs }` |
| `open` | `{ cwd }` | `{ ok, path, launcher }` |

错误统一 `{ ok: false, code, message }`，代码表：

`CWD_REQUIRED` / `CWD_INVALID` / `PATH_REQUIRED` / `PATH_NOT_ALLOWED`(403) /
`NOT_A_FILE` / `FILE_TOO_LARGE`(413) / `CONTENT_REQUIRED` / `VERSION_INVALID` /
`CONFLICT`(409) / `OPEN_FAILED`(502)

### 指令文件发现（必须与 DSH 对齐）

复刻 `@deepseek-ai/dsh-agent-instructions` 的规则，改这里之前先对照
`node_modules/@deepseek-ai/dsh-agent-instructions/lib/index.js`：

- 用户全局根按顺序 `[$DSH_HOME, $DSH_AGENTS_HOME]`，各自只看 `AGENTS.md`
  （默认 `~/.dsh`、`~/.agents`，支持 `~` 展开，空环境变量视为未设置）
- 工作区：从项目根（向上找到的最近 `.git` 目录；找不到就用 `cwd`）到 `cwd` 的每一级目录，
  依次检查 `AGENTS.md` / `CLAUDE.md` / `AGENTS.local.md` / `CLAUDE.local.md`
- 同一候选组内 DSH 会按 `sha1(content.trim())` 去重（两个用户级根算同一组，项目每个目录各自一组）；
  插件只负责展示与编辑，不去重、不合并内容
- 只给「用户全局 `AGENTS.md`」和「工作区边界（项目根 / `cwd`）的 `AGENTS.md`」提供创建占位；
  不要凭空给中间目录或 `CLAUDE.md` 造文件

### 写入安全（不要简化）

- 路径必须命中本次 `discover(cwd)` 的结果，否则 `403 PATH_NOT_ALLOWED`
- `version` 是内容 sha256：`null` = 文件应不存在（创建），字符串 = 必须与磁盘当前内容一致
- 写入用「同目录临时文件 + `rename`」，保留原文件权限位
- 单文件上限 1 MiB（对齐 `agent-instructions` 的 `maxSourceBytes`），请求体上限 2 MiB
- 预算 64 KiB 仅用于前端展示（对齐 dsh-base 里 `agent-instructions` 的 `maxBytes`），不做硬截断

### `open` 动作

浏览器不能启动本地程序，所以由 host 半开目录：`windowsPathFor()` 在 WSL（`/proc/version` 含
`microsoft`）里先 `wslpath -w`，失败再手写 `/mnt/<盘符>` 转换；`openDirectory()` 依次尝试
`explorer.exe`、`/mnt/c/Windows/explorer.exe`、`xdg-open`。只接受该会话的工作区目录，不接任意路径。

## 4. client 半（`lib/client.js`）

### 加载与注册

- 文件必须保持 `window.__ModuleLoader__.load({ id: 'dsh-agents-md', factory: (require) => ... })`
  包装，`require('react')` 从宿主模块表取 React；**没有打包器**，所以只能手写
  `React.createElement`，不能写 JSX
- 导出 `{ apply, inject: ['slots', 'locale'], __messages, __test }`
- `apply` 内：`ctx.effect` 注入 `<style>`，`locale.register(NS, { zh, en })` + `locale.bind(NS)`，
  然后 `ctx.slots.inject('conversation.view', () => ctx.slots.register({ name: 'conversation.view',
  id: 'agents-md', order: 20, locale: NS, label: () => translate('view.label') }, AgentsMdView))`，
  返回清理函数
- 视图是会话作用域：props 由渲染器标准 kit 注入，`props.sessionId` + `props.useSessions` 可用；
  工作区 `cwd` 取 `useSessions((s) => s.byId[sessionId]?.cwd)`（会话 store 本身没有 cwd）

### 交互模型（用户明确要求）

- 默认**预览**态：内置 Markdown 渲染器输出 `div.dam-preview`，只用 `React.createElement`
  拼白名单节点（标题/段落/列表/代码块/引用/表格/链接），**禁止 `innerHTML`**
- 点「编辑」才切到等宽 `<textarea>`；`dirty` 以 `base`（上次读取内容）为基线
- 保存成功 → 回预览并更新基线；取消/切换文件前对未保存内容确认
- 顶部显示工作区路径（点击调 `open`），显示 64 KiB 预算与合计大小
- 侧栏顺序由 `orderFiles()` + `SCOPE_ORDER` 决定：`dsh-home`(0) → `project`(1) → `agents-home`(2)，
  稳定排序，**只改展示**（host 的 `discover()` 顺序仍与 DSH 注入顺序一致；`~/.agents/AGENTS.md`
  是用户 2026-11-02 明确要求排到最下面的）。新增 scope 时在这里补 rank，别去动 host。

### 客户端错误处理

`callHost` 把非 JSON 的 404/405 归一为 `ROUTE_MISSING`，前端提示「需要先重启 DSH」——因为
host 半改动只有在重启承载进程后才加载，这是真实用户会遇到的第一个坑。

## 5. 开发与验证

```bash
npm run check   # node --check lib/index.js lib/client.js
npm test        # host 12 项 + client 11 项
```

测试不依赖真实 DSH：`test/smoke.mjs` 用临时目录 + 真实 HTTP 驱动路由；`test/client.mjs` 在
Node VM 里喂假 React / slots / locale，断言注册选项、渲染树与 Markdown 渲染器。

**验证约定（用户强制）**：只做代码级验证，不跑浏览器截图 / CDP 点击；页面视觉与交互由用户验收。
需要确认「运行中的 DSH 是否下发新 bundle」时用公开端点：

```bash
curl -sN --max-time 2 http://127.0.0.1:3080/plugins/events | grep -o '{"id":"dsh-agents-md"[^}]*}'
curl -s "http://127.0.0.1:3080/plugins/??dsh-agents-md/client.js&rev=<rev>" | grep -c dam-workspace
```

## 6. 部署

```bash
# 本地 link 安装（当前使用的方式）
dsh plugin --profile web add link:/home/sjk/projects/dsh-agents-md
```

- 改 `lib/client.js`：clientModules 会重建并换 rev，刷新页面即可
- 改 `lib/index.js`：**必须重启**承载 3080 的 DSH 进程，刷新页面也不会加载新 host 代码
- 装完/重启后页签栏出现「智能体文档」；空白新会话页不显示页签栏（`tabs.length > 1` 且非 hero 态才显示）

## 7. 提交规范

- Conventional Commits，`type` + 英文单行 subject（仓库现有历史即此风格），正文可用中文
- 一次提交一件事；`npm test` 通过后再提交
- 仓库是本地库（`main` 分支，无 remote）；不提交 `node_modules`、日志、编辑器临时文件
- 版本号跟 `package.json` 走，功能改动同步 README 与 `AGENTS.md`（本文件）

## 8. 已知边界（不要"顺手修"）

- 不做文件系统监听：外部改动后由用户点「重新读取」；不引入 watch/浏览器通知
- 不编辑 DSH 的其它配置（权限、模型、skills），只处理指令文件
- 不引入依赖、不引入构建步骤、不引入路径别名——保持「拷一个目录就能用」
- 保存后只影响**下一条消息**（`agent/pre-step` 重新读取），当前回合不受影响；不要试图热改运行中回合
