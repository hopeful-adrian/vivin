<div align="center">
  <img src="public/vivin-logo.svg" alt="vivin" width="280">

  <p><strong>把 Markdown、资料和写作上下文留在自己的文件夹里。</strong></p>

  <p>一款面向 macOS 与 Windows 的本地优先 Markdown 桌面应用。</p>

  <p>
    <a href="https://github.com/hope-z-y/vivin/actions/workflows/desktop-build.yml"><img src="https://github.com/hope-z-y/vivin/actions/workflows/desktop-build.yml/badge.svg" alt="Desktop build"></a>
    <img src="https://img.shields.io/badge/Tauri-2-24C8D8?logo=tauri&logoColor=white" alt="Tauri 2">
    <img src="https://img.shields.io/badge/Vue-3-42B883?logo=vuedotjs&logoColor=white" alt="Vue 3">
  </p>
</div>

## vivin 是什么

vivin 将一个普通文件夹作为写作项目。正文始终是可由其他编辑器打开的 `.md` 文件；图片、参考资料、术语和标注也保存在项目文件夹中。复制或同步这个文件夹，就能带走项目内容。应用的语言、明暗模式和 Markdown 主题等个人偏好保存在本机。

## 功能

- **两种编辑模式：**源代码模式使用 CodeMirror，视图模式使用 Milkdown Crepe，两种模式都可以直接编辑同一份 Markdown；支持标题、列表、待办、引用、代码块、表格、图片和公式。frontmatter、原始 HTML、引用链接和脚注等需要保留的语法以可编辑原文块显示，避免保存时丢失内容。锁定文件在两种模式中均不可修改。
- **官方 Markdown 主题：**顶部的主题选择器提供当前 Crepe 版本全部三个主题家族：Frame、Crepe（经典）和 Nord。主题与界面的浅色／深色模式独立选择，分别使用官方的六套对应样式，不覆盖正文的字体、标题或配色；仅在窄画布中适配内容区边距。切换主题和明暗模式都保留编辑器实例、光标、撤销历史及滚动位置。
- **目录与分栏：**目录在当前 Markdown 左侧展开，点击标题后保持显示；拖动右侧边界可调整宽度并记住偏好，也可聚焦边界后用左右方向键调整。最多打开两栏，每栏可独立选择文档和模式；同一文档共享内容。双栏中的任一栏都可以关闭，单栏不显示关闭按钮。长文也直接进入可编辑视图，并对屏幕外的内容使用浏览器渲染优化。
- **外部修改自动加载：**打开的文件在磁盘上变化后自动加载新版本，不需要点击重新加载。磁盘版本优先，当前未保存编辑会被替换；版本校验防止旧的自动保存覆盖磁盘新内容。
- **格式化文档：**默认在已修改文档保存时自动整理 Markdown 标题、列表、表格和空行，可在文档工具栏关闭；工具栏按钮或 `⌘/Ctrl+Shift+F` 可手动格式化，随后可用“撤销格式化”按钮恢复。格式化前检查语法树等价性，保留 frontmatter、代码与公式内容；无法安全格式化时保留原文，继续正常保存。
- **阅读图表：**Mermaid 使用适配浅色和深色模式的统一配色、中文无衬线字体与简洁连线；预览中可点击“放大查看”，排版编辑中点击图表可打开查看器，支持 10%–300% 缩放、直接输入缩放比例、适应宽度和按 Esc 关闭。文档中显式指定的 Mermaid 样式仍会保留。
- **整理项目：**创建、重命名、移动和删除文档或目录；固定常用条目，锁定文档或目录以防误改。目录锁定会作用于其下内容。
- **最近项目：**点击左上角项目名称，直接切换最近打开的项目；本机自动保留最近 12 个项目的名称和路径，重启后仍可使用。可从列表中移除记录，或选择其他文件夹；移除记录不会删除项目文件。
- **查找与批注：**顶部搜索当前项目的 Markdown 文档，点击结果在当前模式中定位并高亮；`⌘F`（Windows：`Ctrl+F`）打开当前栏右上方的悬浮查找框，不挤占正文空间；支持大小写、全字匹配、上一个／下一个（`Shift+Enter`／`Enter`）、单次和全部替换，按 `Esc` 关闭。锁定文件可查找但不能替换；为选中文字添加待办、批注、疑问或错误标注，并通过侧栏和文档缩略条定位；疑问使用橘色标识，缩略条悬停时仅加长对应横线。悬停批注后才加载 Markdown 内容，渲染在后台线程运行并使用有上限的缓存；浮层左上角显示带对应颜色的待办、批注、疑问或错误类型标记，并保留内容与编辑、删除图标，大小不超过当前 Markdown 画布宽高的三分之二；编辑说明时保留预览尺寸，并在画布允许时至少提供 420 × 320 像素的编辑浮层。
- **统一术语：**为项目术语添加解释，仅在正文中匹配并悬停查看，跳过各级标题；可以对单个出现位置关闭解释。
- **管理资料与图片：**在侧栏浏览 `resources/` 中的参考文件，并交由系统默认程序打开；粘贴或拖入图片后，图片会保存到项目的 `attachments/`，正文使用相对路径引用。
- **本机 AI 协作：**运行中的应用提供带令牌的本机 MCP 接口。AI 操作遵守项目路径边界、锁定状态和文档版本检查，不再维护 AI 修改记录或项目写作规则。
- **桌面窗口：**macOS 使用系统原生的关闭、最小化和全屏按钮，支持系统全屏快捷键；Esc 只关闭搜索或弹层，不退出窗口全屏。Windows 保留自定义窗口按钮。
- **界面偏好：**提供中文和英文界面；明暗模式与 Markdown 主题分别设置。可点击的图标使用手形光标，悬停或键盘聚焦时展示功能提示。项目和文件支持在 macOS Finder、Windows 文件资源管理器中定位。

## 开始使用

### 获取应用

目前没有签名的正式发行版。仓库的 [Desktop build 工作流](https://github.com/hope-z-y/vivin/actions/workflows/desktop-build.yml) 会构建 macOS Apple Silicon、macOS Intel 和 Windows x64 安装包，并将结果保存为 GitHub Actions artifacts；也可以按下文从源码构建。未签名的构建产物可能受到操作系统的安装限制。

### 创建项目

1. 打开 vivin，点击顶部 **+**，选择 **新建项目**，或用 **打开项目文件夹** 打开已有文件夹；点击左上角项目名称，可从最近项目直接切换，也可选择其他项目文件夹。
2. 在左侧新建 `.md` 文档或目录，开始写作。顶部可切换视图与源代码模式、打开左侧目录或分栏。
3. 将参考文件放进项目的 `resources/`。图片可直接粘贴或拖进编辑器。

一个项目文件夹大致如下：

```text
我的项目/
├── 文章.md              # 普通 Markdown 文件
├── attachments/        # 从编辑器导入的图片
├── resources/          # 参考文件
└── .vivin/             # 固定、锁定、术语和标注
```

应用不会创建或管理项目写作规则；已有的 `AGENTS.md` 作为普通 Markdown 文档处理。本源码仓库的 [`AGENTS.md`](AGENTS.md) 仍是贡献者和编码代理的开发约定。`resources/` 文件可浏览和打开，但不会被解析或纳入 Markdown 全文搜索。

### 连接本机 AI 客户端

vivin 运行时在 `http://127.0.0.1:38419/mcp` 提供 MCP Streamable HTTP 接口。首次运行会在应用配置目录生成 `bridge.json`，其中包含连接 URL 和令牌。客户端需在请求中发送 `Authorization: Bearer <token>`。请勿将令牌或配置文件提交到仓库。

`project_context` 返回当前项目路径；修改文档时需提供当前文档版本，不再要求规则版本。接口只处理已打开的项目，并执行路径边界、锁定和版本冲突检查。端口被占用时，编辑器仍可使用，但 MCP 服务需要在释放端口并重启应用后才能连接。

## 从源码运行

需要 Node.js 22.12+、pnpm 10+、Rust stable，以及对应平台的 [Tauri 2 前置环境](https://v2.tauri.app/start/prerequisites/)。

```bash
git clone https://github.com/hope-z-y/vivin.git
cd vivin
pnpm install --frozen-lockfile
pnpm tauri dev
```

检查与构建：

```bash
pnpm check          # 类型、Lint 和格式检查
pnpm build          # 前端构建
pnpm test:segments  # Markdown 分段测试
pnpm test:outline   # 大纲测试
pnpm test:markdown  # Markdown 保留语法、大纲、渲染与格式化测试
cd src-tauri && cargo test
```

交互回归可运行 `pnpm dev` 后打开 `http://localhost:1420/tests/ui/editor.html`，使用隔离的内存项目验证主题、分栏、批注和自动重新加载；不会读写用户项目。附加 `?platform=windows` 可检查 Windows 文案。

运行 `pnpm tauri build` 可按当前平台生成桌面包；macOS 可指定 `--bundles app,dmg`，Windows 可指定 `--bundles nsis`。工程采用 Vue 3、TypeScript、Vite、Tailwind CSS 4、Milkdown Crepe、CodeMirror 6 和 Tauri 2 / Rust。目录职责与开发约定见 [开发说明](docs/development.md)。

## 当前状态与参与贡献

项目仍处于早期阶段。macOS Apple Silicon 已进行本机验证；Windows 构建已配置在 CI 中，但尚未完成 Windows 实机验收。对外发行前还需要签名、公证及安装和升级测试。欢迎通过 [Issues](https://github.com/hope-z-y/vivin/issues) 反馈问题，或提交 Pull Request。修改前请阅读 [开发说明](docs/development.md) 和仓库 [开发约定](AGENTS.md)，并运行与改动相关的检查。

## 许可证

本项目采用 [MIT License](LICENSE)。
