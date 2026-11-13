<div align="center">
  <img src="public/vivin-logo.svg" alt="vivin" width="280">

  <p><strong>把 Markdown、资料和写作上下文留在自己的文件夹里。</strong></p>

  <p>一款面向 macOS 与 Windows 的本地优先 Markdown 桌面应用。</p>

  <p>
    <a href="https://github.com/hopeful-adrian/vivin/actions/workflows/desktop-build.yml"><img src="https://github.com/hopeful-adrian/vivin/actions/workflows/desktop-build.yml/badge.svg" alt="Desktop build"></a>
    <img src="https://img.shields.io/badge/Tauri-2-24C8D8?logo=tauri&logoColor=white" alt="Tauri 2">
    <img src="https://img.shields.io/badge/Vue-3-42B883?logo=vuedotjs&logoColor=white" alt="Vue 3">
  </p>
</div>

## vivin 是什么

vivin 将一个普通文件夹作为写作项目。正文始终是可由其他编辑器打开的 `.md` 文件；图片、参考资料、术语和标注也保存在项目文件夹中。复制或同步这个文件夹，就能带走项目内容。应用的语言、明暗模式和 Markdown 主题等个人偏好保存在本机。

## 功能

- **两种编辑模式：**“排版”模式使用 Milkdown Crepe，“源代码”模式使用 CodeMirror，两种模式都可以直接编辑同一份 Markdown（`⌘/Ctrl+/` 切换）；支持标题、列表、待办、引用、代码块、表格、图片和公式。frontmatter、原始 HTML、引用链接和脚注等需要保留的语法以可编辑原文块显示，避免保存时丢失内容。锁定文件在两种模式中均不可修改。
- **官方 Markdown 主题：**在设置中可选当前 Crepe 版本全部三个主题家族：Frame、Crepe（经典）和 Nord。主题与界面的浅色／深色／跟随系统独立选择，分别使用官方的六套对应样式；深色模式下界面外壳、侧栏和源代码编辑器也采用所选主题的官方深色底色。正文字号可在 90%–130% 之间调整，同时作用于两种模式。切换主题和明暗模式都保留编辑器实例、光标、撤销历史及滚动位置。
- **目录与分栏：**目录在当前 Markdown 左侧展开，点击标题后保持显示；拖动右侧边界可调整宽度并记住偏好，也可聚焦边界后用左右方向键调整。最多打开两栏（`⌘/Ctrl+\`），每栏可独立选择文档和模式，新分栏的默认模式可在设置中指定；同一文档共享内容。双栏中的任一栏都可以关闭，单栏不显示关闭按钮。长文也直接进入可编辑视图，并对屏幕外的内容使用浏览器渲染优化。
- **保存状态与统计：**文档工具栏显示“已保存／正在保存／未保存／保存失败（可重试）”；分栏底部显示字数（中文按字、英文按词）、字符数和预计阅读时长，有选区时显示选中字数。关闭窗口前会保存全部修改，仍有无法保存的内容时先确认。
- **外部修改与冲突副本：**应用通过系统文件监听感知项目变化，打开的文件在磁盘上变化后自动加载新版本；网络盘或同步盘监听不可靠时，每 15 秒和窗口重新获得焦点时还会再核对一次。若此时本地有未保存内容，会先把这些内容另存为同目录下的“冲突副本”文档，再加载磁盘版本，提示中可一键打开副本。
- **版本历史：**保存时自动保留旧版本（同一文档至少间隔 10 分钟；格式化、恢复版本和 AI 修改前必定保留），每篇最多 50 份，存放在项目的 `.vivin/history/`。在文档“更多”菜单打开“版本历史”可预览任一版本并恢复；恢复前的内容也会留一份，可以再恢复回来。移动或重命名文档时历史随之迁移。
- **格式化文档：**默认在已修改文档保存时自动整理 Markdown 标题、列表、表格和空行，可在设置中关闭；工具栏按钮或 `⌘/Ctrl+Shift+F` 可手动格式化，随后可用“撤销格式化”按钮恢复。格式化前检查语法树等价性，保留 frontmatter、代码与公式内容；无法安全格式化时保留原文，继续正常保存。
- **导出：**文档“更多”菜单可导出为 HTML（图片内联，可离线打开）、打印或通过系统打印面板存储为 PDF，以及复制为富文本粘贴到其他应用。
- **快速打开与命令面板：**`⌘/Ctrl+P` 按文件名模糊匹配并优先列出最近打开的文档，`⌘/Ctrl+Enter` 在旁边分栏打开；也可直接转为全文搜索。`⌘/Ctrl+K`（或在快速打开中输入 `>`）列出全部命令及快捷键。完整快捷键见“设置 → 快捷键”。
- **专注模式：**`⌘/Ctrl+Shift+.` 隐藏侧栏和面板，工具栏、状态栏和标注缩略条淡出，正文居中；按 Esc 退出。
- **阅读图表：**Mermaid 使用适配浅色和深色模式的统一配色、中文无衬线字体与简洁连线；预览中可点击“放大查看”，排版编辑中点击图表可打开查看器，支持 10%–300% 缩放、直接输入缩放比例、适应宽度和按 Esc 关闭。文档中显式指定的 Mermaid 样式仍会保留。
- **整理项目：**通过右键菜单创建、重命名、移动文档或目录，也可以把条目拖到其他目录或根目录；删除时移到系统废纸篓（Windows 为回收站），回收站不可用时二次确认后才永久删除。固定常用条目，锁定文档或目录以防误改，目录锁定会作用于其下内容，锁定内容不能拖动或删除。窗口较窄时侧栏自动收起，加宽后恢复。
- **欢迎页与最近项目：**未打开项目时显示“新建项目”“打开文件夹”和最近项目；项目中还没有打开文档时，列出最近打开的文档。点击左上角项目名称，可直接切换最近打开的项目；本机自动保留最近 12 个项目的名称和路径，重启后仍可使用。可从列表中移除记录，或选择其他文件夹；移除记录不会删除项目文件。
- **查找与批注：**`⌘/Ctrl+Shift+H` 搜索当前项目的 Markdown 文档，结果中高亮命中文字，点击结果在当前模式中定位并高亮；`⌘F`（Windows：`Ctrl+F`）打开当前栏右上方的悬浮查找框，不挤占正文空间；支持大小写、全字匹配、上一个／下一个（`Shift+Enter`／`Enter`）、单次和全部替换，按 `Esc` 关闭。锁定文件可查找但不能替换；为选中文字添加待办、批注、疑问或错误标注，并通过侧栏和文档缩略条定位；疑问使用橘色标识，缩略条悬停时仅加长对应横线。悬停批注后才加载 Markdown 内容，渲染在后台线程运行并使用有上限的缓存；浮层左上角显示带对应颜色的待办、批注、疑问或错误类型标记，并保留内容与编辑、删除图标，大小不超过当前 Markdown 画布宽高的三分之二；编辑说明时保留预览尺寸，并在画布允许时至少提供 420 × 320 像素的编辑浮层。
- **统一术语：**为项目术语添加解释，仅在正文中匹配并悬停查看，跳过各级标题；可以对单个出现位置关闭解释。侧栏底部的“项目资料”区汇总术语和四类标注的数量，点击即可打开对应列表。
- **管理资料与图片：**在侧栏浏览 `resources/` 中的参考文件，并交由系统默认程序打开；粘贴或拖入图片后，图片会保存到项目的 `attachments/`，正文使用相对路径引用。
- **本机 AI 协作：**运行中的应用提供带令牌的本机 MCP 接口。AI 操作遵守项目路径边界、锁定状态和文档版本检查，不再维护 AI 修改记录或项目写作规则。
- **桌面窗口：**macOS 使用系统原生的关闭、最小化和全屏按钮，支持系统全屏快捷键；Esc 只关闭搜索或弹层，不退出窗口全屏。Windows 保留自定义窗口按钮。
- **设置：**`⌘/Ctrl+,` 打开设置，包括界面语言（中文／英文）、外观、Markdown 主题、正文字号、自动格式化、新分栏打开方式和快捷键列表。“关于”页显示版本号，可检查更新、打开日志文件夹，并查看本机 AI 连接地址与配置文件位置。可点击的图标使用手形光标，悬停或键盘聚焦时展示功能提示。项目和文件支持在 macOS Finder、Windows 文件资源管理器中定位。
- **应用内更新与日志：**启动后每天最多检查一次 GitHub Releases 上的正式版本（可在设置中关闭），有新版本时可一键下载、校验签名并重启更新，更新前自动保存全部文档，不上传任何内容；详见下文“更新”。运行日志写入系统日志目录并按大小滚动，界面中未捕获的错误也会记录下来，反馈问题时可附上。

## 开始使用

### 获取应用

正式版本发布在 [GitHub Releases](https://github.com/hopeful-adrian/vivin/releases)，提供 macOS Apple Silicon、macOS Intel 和 Windows x64 安装包；也可以按下文从源码构建。安装包目前尚未经过 Apple 公证和 Windows 代码签名，首次打开时可能受到系统的安装限制。推送到 `main` 的每次提交由 [Desktop build 工作流](https://github.com/hopeful-adrian/vivin/actions/workflows/desktop-build.yml) 构建，结果仅作为 Actions artifacts 保存，不会推送给已安装的应用。

### 更新

安装后，vivin 启动时每天最多检查一次新版本（可在“设置 → 关于”中关闭），也可以在那里手动检查。发现新版本时会提示“更新并重启”：应用在后台下载更新包，下载完成后先保存全部文档，再安装并重启。更新包使用 vivin 的更新签名校验，签名不符时不会安装。只有在 GitHub Releases 中正式发布的版本才会推送，普通提交、草稿和预发布版不会触发更新。

### 创建项目

1. 打开 vivin，在欢迎页点击 **新建项目**，或用 **打开文件夹**（`⌘/Ctrl+O`）打开已有文件夹；之后点击左上角项目名称，可从最近项目直接切换，也可选择其他项目文件夹。
2. 在左侧新建 `.md` 文档或目录（`⌘/Ctrl+N`），开始写作。文档工具栏可切换排版与源代码模式、打开目录；顶栏可分栏、切换明暗和打开设置。
3. 将参考文件放进项目的 `resources/`。图片可直接粘贴或拖进编辑器。

一个项目文件夹大致如下：

```text
我的项目/
├── 文章.md              # 普通 Markdown 文件
├── attachments/        # 从编辑器导入的图片
├── resources/          # 参考文件
└── .vivin/             # 固定、锁定、术语、标注和版本历史（history/）
```

应用不会创建或管理项目写作规则；已有的 `AGENTS.md` 作为普通 Markdown 文档处理。本源码仓库的 [`AGENTS.md`](AGENTS.md) 仍是贡献者和编码代理的开发约定。`resources/` 文件可浏览和打开，但不会被解析或纳入 Markdown 全文搜索。

### 连接本机 AI 客户端

vivin 运行时在 `http://127.0.0.1:38419/mcp` 提供 MCP Streamable HTTP 接口。首次运行会在应用配置目录生成 `bridge.json`，其中包含连接 URL 和令牌。客户端需在请求中发送 `Authorization: Bearer <token>`。请勿将令牌或配置文件提交到仓库。

`project_context` 返回当前项目路径；修改文档时需提供当前文档版本，不再要求规则版本。接口只处理已打开的项目，并执行路径边界、锁定和版本冲突检查。端口被占用时，编辑器仍可使用，但 MCP 服务需要在释放端口并重启应用后才能连接。

## 从源码运行

需要 Node.js 22.12+、pnpm 10+、Rust stable，以及对应平台的 [Tauri 2 前置环境](https://v2.tauri.app/start/prerequisites/)。

```bash
git clone https://github.com/hopeful-adrian/vivin.git
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
pnpm test:unit      # 文档状态、冲突副本、快速打开排序、偏好校验等领域规则
cd src-tauri && cargo test
```

交互回归可运行 `pnpm dev` 后打开 `http://localhost:1420/tests/ui/editor.html`，使用隔离的内存项目验证主题、分栏、批注、版本历史、冲突副本和自动重新加载；不会读写用户项目。可附加查询参数：`platform=windows` 检查 Windows 文案与窗口按钮，`locale=en` 切换英文，`theme=dark` 与 `documentTheme=classic|nord` 检查深色主题。

运行 `pnpm tauri build` 可按当前平台生成桌面包；macOS 可指定 `--bundles app,dmg`，Windows 可指定 `--bundles nsis`。工程采用 Vue 3、TypeScript、Vite、Tailwind CSS 4、Milkdown Crepe、CodeMirror 6 和 Tauri 2 / Rust。目录职责与开发约定见 [开发说明](docs/development.md)。

## 当前状态与参与贡献

项目仍处于早期阶段。macOS Apple Silicon 已进行本机验证；Windows 构建已配置在 CI 中，但尚未完成 Windows 实机验收。对外发行前还需要签名、公证及安装和升级测试。欢迎通过 [Issues](https://github.com/hopeful-adrian/vivin/issues) 反馈问题，或提交 Pull Request。修改前请阅读 [开发说明](docs/development.md) 和仓库 [开发约定](AGENTS.md)，并运行与改动相关的检查。

## 许可证

本项目采用 [MIT License](LICENSE)。
