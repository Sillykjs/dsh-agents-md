# dsh-agents-md

一个 DSH Web 插件：在对话页签栏里加一个「智能体文档」页签，直接查看和编辑 DSH 实际加载的 `AGENTS.md` 指令文件。

## 它解决什么问题

DSH 会在每个会话里注入一组 `AGENTS.md`（以及 `CLAUDE.md`、`AGENTS.local.md`、`CLAUDE.local.md`）作为智能体指令，但 Web 界面没有入口能看到“这次到底加载了哪些文件、内容是什么”。改指令只能去文件管理器里翻路径。

这个插件把入口放到对话页签栏里：切到「智能体文档」就能看到当前会话的全部指令文件，改完保存，从下一条消息开始生效。

## 功能

- 列出当前会话实际参与注入的指令文件：
  - 用户全局：`$DSH_HOME/AGENTS.md`（默认 `~/.dsh/AGENTS.md`）、`$DSH_AGENTS_HOME/AGENTS.md`（默认 `~/.agents/AGENTS.md`）
  - 工作区：从项目根（最近的 `.git` 所在目录）到当前工作目录的每一级目录，检查 `AGENTS.md` / `CLAUDE.md` / `AGENTS.local.md` / `CLAUDE.local.md`
  - 侧栏顺序：`$DSH_HOME/AGENTS.md` → 工作区链路 → `$DSH_AGENTS_HOME/AGENTS.md`（`~/.agents/AGENTS.md` 固定排在最下面，不挡常用的工作区文件；只影响展示，DSH 的实际注入顺序不变）
  - 侧栏每项的加粗标题是文件所在位置（`全局 DSH 目录` / `工作区根` / `工作区子目录 · 目录名` / `全局 Agents 目录`），第二行是地址，第三行是文件名与大小：三个文件都叫 `AGENTS.md`，靠位置标题区分
- 文件头部同样以位置为主标题（`全局 DSH 目录` / `工作区根` / …），地址作为第二行，文件名在地址里
- 两态查看：默认是 Markdown 预览（标题、列表、代码块、表格、引用、链接），点「编辑」才进入等宽字体编辑器；保存成功自动回到预览，取消则回退到上次读取的内容
- 编辑能力：Ctrl/⌘+S 保存、未保存标记、字节数与修改时间，切换文件前会确认是否放弃未保存修改
- 缺失文件可直接创建：只对用户全局 `AGENTS.md` 和工作区边界（项目根 / 当前目录）的 `AGENTS.md` 提供“尚未创建”的占位，避免在工作区里凭空造出 CLAUDE.md
- 顶部标出当前工作区路径，点一下就在系统文件管理器里打开（WSL 下自动转成 `\\wsl.localhost\...` 再交给 Windows 资源管理器）；路径用主色等宽字体突出显示，打开结果提示显示在路径右侧
- 显示指令总预算（64 KiB，与 `agent-instructions` 的默认配置一致）和当前合计大小，超预算会变黄
- 保存安全：sha256 版本校验 + 临时文件原子替换。文件在编辑器外被改过时返回冲突提示，而不是静默覆盖
- 中英文界面，跟随 DSH 语言设置；浅色主题，使用 DSH 的 CSS 变量

## 安装

```bash
# 本地 link 安装（开发时）
dsh plugin --profile web add link:/path/to/dsh-agents-md

# 从 npm 安装
dsh plugin --profile web add dsh-agents-md
```

安装后**重启**承载 Web UI 的 DSH 进程（例如 `dsh web`），再刷新页面。页签栏会多出「智能体文档」。

> 改 host 半（`lib/index.js`）后需要重启承载进程；改 client 半（`lib/client.js`）后刷新页面即可取到重新下发的 bundle。

## 实现方式

- **host 半**（`lib/index.js`）：注册同源 JSON 路由 `/__dsh-agents-md/{list,read,write,open}`，按 `agent-instructions` 的规则复刻发现逻辑，写入用 `tmp + rename` 原子替换。
- **client 半**（`lib/client.js`）：用 `window.__ModuleLoader__.load({ id, factory })` 注册的预构建单文件 bundle，向 `conversation.view` 槽位注册 `id: "agents-md"`、`order: 20` 的视图。视图从渲染器标准 kit 拿到 `sessionId` 与 `useSessions`，用 `sessions.list` 里的 `cwd` 定位工作区。

## 路由

所有路由都是 `POST`，请求/响应都是 JSON：

| 路由 | 请求体 | 响应 |
| --- | --- | --- |
| `/__dsh-agents-md/list` | `{ cwd }` | `{ ok, cwd, projectRoot, budget, totalBytes, files[] }` |
| `/__dsh-agents-md/read` | `{ cwd, path }` | `{ ok, path, exists, content, version, size, mtimeMs }` |
| `/__dsh-agents-md/write` | `{ cwd, path, content, version }` | `{ ok, path, version, size, mtimeMs }` |
| `/__dsh-agents-md/open` | `{ cwd }` | `{ ok, path, launcher }` |

`open` 只接受该会话的工作区绝对路径，用 `explorer.exe` / `xdg-open` 打开；WSL 下先经 `wslpath -w` 转换。

`version` 是内容的 sha256 十六进制串；`null` 表示“文件应不存在”。文件在磁盘上已变化时返回 `409 CONFLICT`。请求路径必须命中该工作区的发现结果，否则返回 `403 PATH_NOT_ALLOWED`。

## 开发

```bash
npm test        # host 路由冒烟 + client 注册契约测试
npm run check   # node --check
```

测试不依赖真实 DSH 进程：`test/smoke.mjs` 用临时目录和真实 HTTP 服务器驱动 host 路由；`test/client.mjs` 在 VM 里用假的 React / slots / locale 跑 client bundle，检查注册出来的槽位选项、渲染树，以及 Markdown 预览渲染器。

## 已知边界

- 只编辑文本，不做文件系统监听；外部改动后点「重新读取」。
- 单文件上限 1 MiB（与 `agent-instructions` 的 `maxSourceBytes` 一致），超出后只读提示。
- 页签栏只在已有会话、且存在多个视图时显示；空白新会话页不显示。
- 保存后的指令在**下一条消息**的 `agent/pre-step` 才被重新读取，当前正在生成的回合不受影响。

## License

MIT
