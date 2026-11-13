# 开发规范与工程边界

## 当前基础

仓库使用 Tauri 2、Vue 3、TypeScript、Vite、Tailwind CSS 4、Oxlint 和 Oxfmt，包管理器为 pnpm。`src/` 是 WebView 界面，`src-tauri/` 是原生进程。项目服务、编辑器与本机 MCP 接口已接入。原生依赖中，`notify` 用于文件监听，`trash` 用于移到系统回收站，`tauri-plugin-log` 用于写入滚动日志，`tauri-plugin-updater` 与 `tauri-plugin-process` 用于应用内更新和更新后重启。

遵循仓库根目录的 `AGENTS.md`：2 空格、严格类型、职责拆分、最小范围验证和 Conventional Commits。不要引入不适用于单应用项目的 monorepo、后台业务接口或并行的 ESLint/Prettier 配置。

## 目录职责

```text
src/
  App.vue                 只做布局编排与全局事件挂载
  components/             跨功能复用：标题栏、两种编辑器、对话框、提示、悬停提示
  features/
    annotations/          标注浮层、创建、编辑、删除
    commands/             命令表、快捷键分发、命令面板 / 快速打开
    documents/            文档状态（document-store 可在 Node 中测试）与应用实例
    editor/               编辑器外观样式
    export/               HTML 导出、打印、复制富文本（按需加载）
    history/              版本历史面板状态
    project/              项目、文档树、最近项目、文件操作、侧栏
    search/               项目全文搜索
    settings/             偏好、设置窗口、检查更新
    terms/                术语匹配（纯函数）、悬停、编辑
    ui/                   对话框、菜单互斥、提示的共享状态
    workspace/            顶栏、分栏、侧面板、欢迎页、布局、原生事件
  lib/                    无界面依赖的纯逻辑、Tauri 命令类型与适配（project-api.ts）
src-tauri/src/
  error.rs                AppError { code, message } 与错误码
  project/                项目服务：paths、documents、entries、tree、search、assets、
                          annotations、history、export、watcher、session
  metadata.rs             可复制的项目结构化数据
  system.rs               日志目录、发布页、MCP 连接信息
  ai.rs                   带令牌的本机 MCP 服务（复用 project/ 的同一实现）
tests/
  *.test.mjs              Markdown 往返、大纲、搜索等
  unit/                   文档状态、错误解析、快速打开、偏好、版本比较等领域规则
  ui/editor.html          使用内存模拟层的界面回归页
docs/                     开发说明与方案
```

目录按功能真正出现时再建立。共享状态放在功能目录的 `use-*.ts` 模块中（模块级单例），切换项目时通过 `onProjectReset` 清理；组件只处理交互和展示，不直接调用 `invoke`。项目文件的边界、版本检查、锁定、原子写入应由原生侧统一保证。前端请求和 Rust 返回值要使用稳定、可序列化的类型；所有命令返回 `AppError { code, message }`，前端用 `parseAppError` 按错误码判断，不匹配提示文字。

## Markdown 编辑与渲染

- 使用 [Milkdown Crepe](https://milkdown.dev/docs/guide/using-crepe) 编辑排版视图，使用 [CodeMirror 6 Markdown](https://codemirror.net/docs/ref/#lang-markdown) 编辑原文视图。Milkdown 官方文档列有列表、待办项、代码块、图片与表格编辑能力。
- `.md` 文件是正文的唯一持久化来源。两种视图通过同一文档版本同步；切换视图前检查编辑器尚未保存的改动。双栏打开同一文件时共用文档内容，栏位独立保存选区、滚动位置和视图模式。
- Markdown 只提供源代码和视图两种模式。视图使用完整文档编辑器保留跨块上下文；frontmatter、HTML、引用链接和脚注等语法在预设转换前保留为可编辑原文块。往返检查失败时也保留可编辑原文，不以只读预览替代编辑。保存、切换模式和关闭分栏前同步尚未发布的内容；外部更新取消旧同步任务并通过最小 ProseMirror 变更映射选区。
- Markdown 使用当前依赖版本的全部官方主题家族及各自浅深色版本。`editor-theme.ts` 仅为官方 CSS 添加作用域，不改写其变量或正文排版规则；窄画布仅在 `editor-chrome.css` 中适配内容区边距；主题家族与界面明暗模式分别持久化。主题不进入编辑器 key，不重建编辑器。目录是当前画布左侧的布局栏；分栏使用稳定 id，关闭左栏不销毁右栏编辑器。
- 批注 Markdown 使用 `remark-rehype` 生成 HAST、`rehype-sanitize` 过滤属性和 URL，再由 Vue 创建节点；原始 HTML 转为文字展示。`katex` 在净化后处理公式，`hast-util-from-html` 仅解析其生成的可信 HTML。命名字符实体解码显式使用 `decode-named-character-reference` 的无 DOM 入口，以兼容 Worker。批注组件仅在浮层出现时异步加载，通过共享 Worker 按需解析、缓存最多 24 篇内容，浮层宽高分别限制在当前画布的三分之二。Mermaid 以 strict 安全模式生成 SVG，配置与渲染串行执行，缓存按明暗模式区分。
- 文档格式化使用 `remark-stringify`，属于应用功能，与仓库代码的 Oxfmt 配置无关。格式化在 Worker 中运行，写回前核对当前文档对象、内容、版本、锁定和重新加载状态；通过语法树等价校验后才更新共享文档状态，最终仍由原生保存命令校验并持久化。自动格式化只处理已修改文档，撤销格式化后不立即重复格式化。
- 用户文档按不可信内容处理。不要直接把 Markdown 中的原始 HTML 注入 `v-html`；若未来提供独立 HTML 预览，必须经过明确的 HTML 净化和安全链接处理。图片仅解析到当前项目允许的相对路径。
- 术语、标注、固定与锁定写入项目内的结构化数据，不进入 `.md`。外部文件变化由 `project/watcher.rs`（`notify`，合并 300ms）发出 `vivin://documents-changed` 与 `vivin://project-changed`；前端只核对相关文档，另有 15 秒兜底的批量版本查询。磁盘内容优先加载，本地未保存编辑先通过 `save_conflict_copy` 另存为冲突副本，再取消旧草稿和格式化结果；写入仍核对版本，防止旧自动保存覆盖磁盘内容。应用不创建项目 `AGENTS.md`，已有文件按普通 Markdown 处理。
- 版本历史存放在 `.vivin/history/`，由保存命令按节流规则写入；`.vivin/` 不进入文档树、搜索和文件监听。

## Tauri 边界

- 只暴露与业务动作对应的命令，不暴露任意路径读写。项目路径在原生侧规范化并核对真实位置，防止 `..` 或符号链接逃出项目根目录。
- 写操作应使用临时文件与原子替换或等效机制，并提供清晰失败结果。批量操作避免成功一半；不再维护 AI 修改记录、撤销接口或项目规则接口。
- 本机 AI 控制接口与前端共享项目服务和锁定规则，不通过另一套写入路径绕开校验。MCP 服务只监听本机，采用随机令牌；令牌路径由应用配置目录确定。
- Tauri capability 按功能逐项增加。项目数据随文件夹移动，不在项目元数据里保存当前机器的绝对路径。窗口布局等个人状态可放应用数据目录。
- 发布构建使用 Tauri CSP 限制 WebView 资源来源；开发模式暂沿用 Vite 默认连接。接入图片、字体或插件时按实际资源收紧或扩展 CSP，不把生产配置改回 `null`。

## 日常命令

```bash
pnpm install
pnpm tauri dev
pnpm check
pnpm build
pnpm format
```

Rust 工具链安装后，在 `src-tauri/` 运行 `cargo fmt --check`、`cargo check` 和 `cargo test`。提交前优先执行受影响范围的检查，再运行 `pnpm check`、`pnpm test:unit` 和 `pnpm test:markdown`。依赖更新应保留 `pnpm-lock.yaml` 和 `src-tauri/Cargo.lock`，不要混用 npm 或 yarn 安装。桌面构建运行 `pnpm tauri build`。

`pnpm build` 后检查分包：首屏只应加载 `index-*.js` 与少量基础模块；Mermaid、KaTeX、导出模块和排版编辑器都应是按需加载的独立 chunk。

## 发布与应用内更新

应用内更新使用 Tauri 官方的 `tauri-plugin-updater`：已安装的应用读取 `https://github.com/hopeful-adrian/vivin/releases/latest/download/latest.json`，用 `tauri.conf.json` 中的 `plugins.updater.pubkey` 校验更新包签名后安装。这对更新签名密钥与 Apple 或 Windows 的代码签名证书无关，私钥一旦丢失，已安装的应用将无法再接收更新，只能手动重装，务必备份。

一次性准备：

1. 私钥在 `~/.tauri/vivin-updater.key`，密码在 `~/.tauri/vivin-updater.password`。在 GitHub 仓库 **Settings → Secrets and variables → Actions** 中新建两个 secret：`TAURI_SIGNING_PRIVATE_KEY`（私钥文件的全部内容）和 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`（密码）。之后把两份文件备份到密码管理器。
2. 若要更换密钥：运行 `pnpm tauri signer generate -w ~/.tauri/vivin-updater.key`，把新的 `.pub` 内容写入 `plugins.updater.pubkey` 并更新 secrets。已安装的旧版本只认旧公钥，需要用户手动安装一次新版本。

每次发版：

1. 同步修改 `package.json`、`src-tauri/Cargo.toml` 和 `src-tauri/tauri.conf.json` 中的版本号并提交。
2. 推送 tag：`git tag v0.2.0 && git push origin v0.2.0`。`.github/workflows/release.yml` 会核对三个版本号与 tag 一致，创建 Release 草稿，再构建 macOS（Apple Silicon、Intel）和 Windows 安装包、带签名的更新包及 `latest.json`，上传到该草稿。
3. 在 GitHub Releases 中检查草稿、填写更新说明并点击发布。发布后，已安装的应用才会检查到新版本；更新说明会显示在 Release 页面。

本地 `pnpm tauri build` 默认不生成更新包，不需要私钥。要在本地验证更新包，先设置 `TAURI_SIGNING_PRIVATE_KEY` 与 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`，再附加 `--config src-tauri/tauri.release.conf.json`。

## 发布清单

1. **版本号：**见上文“每次发版”。
2. **macOS：**使用 Developer ID Application 证书签名（`APPLE_SIGNING_IDENTITY`），并通过 `APPLE_ID`、`APPLE_PASSWORD`（App 专用密码）、`APPLE_TEAM_ID` 公证；分别构建 Apple Silicon 与 Intel 包，确认 dmg 打开后 Gatekeeper 不再拦截。
3. **Windows：**使用代码签名证书签名 NSIS 安装包，避免 SmartScreen 警告；在实机上验证安装、升级覆盖安装、卸载，以及自定义窗口按钮、`Ctrl` 快捷键、回收站删除、资源管理器定位和打印。
4. **桌面行为：**在 `pnpm tauri dev` 或安装包中核对：外部编辑器修改文件后自动加载、未保存时生成冲突副本、删除进入废纸篓／回收站、版本历史恢复、导出 HTML、打印／存储为 PDF、关闭窗口前保存、日志目录可打开、MCP 连接可用。
5. **更新验证：**先安装上一个版本，发布新版本后在“设置 → 关于”中检查更新，确认能下载、自动保存文档、安装并重启到新版本。在 GitHub Release 中写明变更与已知问题。
