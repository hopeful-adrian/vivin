# vivin 产品化改造方案

**目标：**在保持“普通文件夹 + 普通 `.md`”这一核心承诺的前提下，补齐技术底座、数据安全、常用功能、交互与视觉一致性，使 vivin 达到可以对外发布的桌面应用水准。最终打包、签名和安装验收由维护者完成。

**范围：**以 macOS / Windows 桌面端为准。不做多窗口、多项目同开、云同步、协作和移动端。

**基线：**`ddef8d6`，`pnpm check`、`pnpm test:markdown`、`cargo test` 全部通过。

**状态：**阶段一至阶段五的代码均已完成，`pnpm check`、`pnpm test:unit`、`pnpm test:markdown`、`pnpm build`、`cargo fmt --check`、`cargo clippy`、`cargo test` 通过，回归页截图验收完成。剩余由维护者完成：签名与公证、安装和升级、Windows 实机，以及在 `pnpm tauri dev` 或安装包中核对真实的文件监听、回收站、导出和打印（见 `docs/development.md` 的发布清单）。

与方案的差异：
- 共享状态使用功能目录中的模块级单例（`use-*.ts`），没有采用 `provide/inject`。应用只有一个窗口和一个项目，单例更直接；项目切换时通过 `onProjectReset` 统一清理。
- 右键菜单写在 `project-sidebar.vue` 内，没有单独拆出 `entry-context-menu.vue`；术语悬停与编辑合并在 `terms/use-terms.ts`。
- 新增 `commands/command-palette.vue`、`settings/settings-dialog.vue`、`workspace/welcome-view.vue`、`workspace/use-native-events.ts`、`terms/term-dialog.vue`。

## 全局约束

- 遵循 `AGENTS.md`：Vue 3 + TypeScript 严格类型、Oxlint/Oxfmt、`kebab-case` 文件名、composable 以 `use` 开头。
- 正文只写普通 Markdown。版本历史、冲突副本以外的应用数据都放在 `.vivin/`，不写入正文。
- 所有新增写命令都在 Rust 侧完成路径边界、锁定和版本校验。前端不直接接触任意磁盘路径；导出目标路径由 Rust 打开系统保存对话框获得。
- 新依赖须说明用途并更新锁文件；Tauri capability 只加必需权限。
- 不自动提交，每个阶段结束后跑 `pnpm check`、`pnpm test:markdown`、`pnpm test:unit`、`cargo test`、`cargo fmt --check`，界面改动用回归页截图验收。

## 产品决策（默认值）

| 问题 | 决定 |
| --- | --- |
| 外部修改与未保存内容冲突 | 磁盘版本照常加载；本地未保存内容自动另存为同目录的“冲突副本”文档并提示，可一键打开 |
| 删除 | 移到系统回收站（废纸篓）；回收站不可用时，二次确认后才永久删除 |
| 版本历史 | 保存时按文档留快照（同一文档至少间隔 10 分钟，AI 写入和格式化前强制留一份），每篇最多 50 份，存 `.vivin/history/` |
| 导出 | HTML（图片内联，可离线打开）、PDF（系统打印面板“存储为 PDF”）、复制为富文本 |
| 视图模式名称 | 改称“排版”，与源代码相对，避免被理解为只读 |
| 自动更新 | 使用 `tauri-plugin-updater` 应用内更新：推送 `v*` tag 自动构建 Release 草稿和 `latest.json`，维护者发布后已安装应用提示“更新并重启”，安装前保存全部文档 |
| 多窗口 | 不做 |

## 阶段一：技术底座

### 1.1 结构化错误码（Rust → 前端）

- 新建 `src-tauri/src/error.rs`：`AppError { code: ErrorCode, message: String }`，`Serialize` 为 `{ code, message }`，实现 `From<std::io::Error>`、`From<String>`、`Display`。
- `ErrorCode`：`no_project`、`invalid_path`、`not_found`、`locked`、`revision_conflict`、`already_exists`、`invalid_input`、`unsupported`、`trash_unavailable`、`state`、`io`。
- 所有 Tauri 命令改为 `Result<T, AppError>`；MCP 侧通过 `Display` 继续返回文字。
- 前端 `src/lib/app-error.ts`：`parseAppError(unknown): AppError`、`isRevisionConflict()`、`localizedErrorMessage(error, locale)`（按错误码提供英文文案，缺省回退到原文）。去掉所有 `/修改|冲突|版本/` 正则。
- 测试：Rust 侧断言冲突、锁定、越界分别返回对应错误码；前端单测 `parseAppError` 对字符串、对象、`Error` 三种输入。

### 1.2 拆分 `project.rs`

改为 `src-tauri/src/project/` 模块：

| 文件 | 职责 |
| --- | --- |
| `mod.rs` | 对外导出，`ProjectSession`（根目录、写锁、草稿） |
| `paths.rs` | `checked_relative`、`checked_member`、`checked_document`、`safe_project_directory`、`relative_key` |
| `documents.rs` | 读取、保存、版本号、草稿、重新加载、冲突副本 |
| `entries.rs` | 新建、移动、删除（回收站）、固定、锁定 |
| `tree.rs` | 文档树与资源树 |
| `search.rs` | 全文搜索、批量版本查询 |
| `assets.rs` | 图片导入与读取、资源导入与打开、引用打开 |
| `annotations.rs` | 术语、术语例外、标注 |
| `history.rs` | 版本历史 |
| `export.rs` | 导出与打印 |
| `watcher.rs` | 文件监听 |

`ai.rs` 中重复的创建/移动/删除逻辑改为调用 `entries.rs` 的同一实现，保证两条入口规则一致。

### 1.3 用文件监听取代每 2.5 秒轮询

- 新依赖 `notify`（跨平台文件系统事件）。打开项目时递归监听根目录，忽略 `.vivin/`；事件在 Rust 侧合并 300ms 后发出：
  - `vivin://documents-changed { paths: string[] }`：`.md` 内容变化；
  - `vivin://project-changed`：新建、删除、重命名。
- 新命令 `read_document_revisions(paths) -> Record<path, revision | null>`，一次查询全部打开文档。
- 前端收到事件只检查相关文档；保留 15 秒一次的批量兜底检查，应对网络盘等监听不可靠的场景。

### 1.4 拆分 `App.vue`

目标：`App.vue` 只负责布局编排，状态与逻辑进入 composable，界面块进入组件。共享状态通过类型化的 `provide/inject` 传递。

| 新文件 | 内容 |
| --- | --- |
| `src/lib/i18n.ts` | 全局 `locale`、`t(zh, en)`，组件不再各自接收 `locale` 属性拼文案 |
| `src/features/settings/use-preferences.ts` | 所有本机偏好的读取、校验、持久化 |
| `src/features/documents/document-store.ts` | 文档状态、编辑、草稿、保存、重新加载、冲突副本、格式化与撤销；依赖以接口注入，可在 Node 中测试 |
| `src/features/project/use-project.ts` | 项目、文档树、资源、项目数据、刷新、切换、最近项目、文件操作 |
| `src/features/workspace/use-panes.ts` | 分栏、活动栏、跳转、查找、目录、编辑器引用 |
| `src/features/annotations/use-annotations.ts` | 标注浮层、创建、编辑、删除 |
| `src/features/terms/term-marks.ts`、`use-term-hover.ts` | 术语匹配（纯函数）与悬停 |
| `src/features/workspace/app-header.vue` | 顶栏 |
| `src/features/project/project-sidebar.vue`、`entry-context-menu.vue` | 侧栏与右键菜单 |
| `src/features/workspace/document-pane.vue` | 单个分栏（工具栏、编辑器、缩略条、状态栏） |
| `src/features/workspace/side-panel.vue` | 搜索、术语、标注、历史面板 |
| `src/features/annotations/annotation-popover.vue`、`src/features/terms/term-popover.vue` | 浮层 |
| `src/components/app-dialog.vue`、`app-toast.vue` | 通用对话框与提示 |

### 1.5 测试

- 新增 `pnpm test:unit`（Node 内置测试运行器）：文档状态（保存、版本冲突、锁定、外部修改生成冲突副本、双栏共用一份内容）、术语匹配、字数统计、错误解析、快速打开排序、偏好校验。
- Rust：错误码、回收站、版本历史（节流、上限、移动后跟随）、冲突副本命名、监听事件分类。

### 1.6 打包体积

`vite build` 后检查分包，确保 Mermaid、KaTeX、导出模块只在用到时加载，首屏只含外壳与当前编辑器。

## 阶段二：数据安全

1. **冲突副本：**外部修改到达时，若本地有未保存内容，调用 `save_conflict_copy(path, content)`，生成 `原名（冲突副本 2026-11-13 0945）.md`，再加载磁盘版本；提示里提供“打开副本”。
2. **回收站：**新依赖 `trash`。`delete_entry` 改为移到系统回收站，同时清理固定、锁定、标注；失败返回 `trash_unavailable`，前端二次确认后调用 `delete_entry(path, permanent: true)`。MCP 删除走同一实现。
3. **版本历史：**`.vivin/history/index.json` 记录 `path → [{ id, createdAt, size, reason }]`，快照存为 `<id>.md`。命令 `list_document_history`、`read_document_history`。移动和重命名时同步改索引；删除不清历史。侧栏面板列出版本，可预览，“恢复此版本”作为一次普通编辑写回，可再撤销。

## 阶段三：功能与交互

1. **保存状态：**分栏工具栏显示“已保存 / 正在保存 / 未保存 / 保存失败（重试）”。
2. **状态栏：**分栏底部显示字数（中文按字、英文按词）、字符数、预计阅读时长；有选区时显示选中字数。
3. **快速打开（`⌘/Ctrl+P`）与命令面板（`⌘/Ctrl+K`）：**按文件名模糊匹配，最近打开优先；命令覆盖新建、分栏、切换模式、格式化、导出、设置、主题、专注模式、快捷键说明。
4. **导出：**HTML、PDF（打印）、复制为富文本，入口在文档工具栏“更多”和命令面板。
5. **欢迎页：**无项目时显示“新建项目”“打开文件夹”两个主按钮和最近项目列表。
6. **设置（`⌘/Ctrl+,`）：**外观（浅色 / 深色 / 跟随系统、Markdown 主题、正文字号）、编辑（自动格式化、新分栏打开方式）、语言、快捷键、关于（版本、检查更新、日志目录、MCP 连接信息）。
7. **菜单互斥：**全部弹出菜单由一个 `openMenu` 状态管理，打开一个自动关闭其他，点击空白或按 Esc 关闭。
8. **提示分级：**成功 / 信息 / 警告 / 错误四类，成功和信息自动消失，可带操作按钮（重试、打开副本、撤销等）。
9. **文件树拖拽移动：**拖到目录或根目录即移动，锁定内容不可拖。
10. **专注模式（`⌘/Ctrl+Shift+.`）：**隐藏侧栏、面板和次要工具栏，Esc 退出。
11. **可发现性：**侧栏底部“项目资料”区放术语与四类标注计数，空状态说明如何添加；新分栏默认使用当前栏的模式。
12. **窄窗口：**窗口宽度不足时自动收起侧栏，加宽后恢复。

## 阶段四：视觉一致性

1. 深色模式下分栏底色、源代码编辑器底色与当前 Markdown 主题的官方深色背景一致，外壳使用官方 surface 色。
2. 顶栏精简为：侧栏开关、项目切换、搜索（同时是快速打开入口）、分栏、明暗、设置、更多。语言和 Markdown 主题移入设置与命令面板。
3. 侧栏分组标题加大、加深，分组间距统一；“项目资料”区与文件树视觉分隔。
4. 欢迎页、关于页使用 vivin 标志与统一强调色。

## 阶段五：发布准备（打包验收由维护者完成）

1. **日志：**接入 `tauri-plugin-log`，写入系统日志目录并按大小滚动；前端未捕获错误同步写入；设置中可打开日志目录。
2. **检查更新：**启动后（每日最多一次）与手动触发时查询 GitHub Releases 最新版本，有新版时提示并打开下载页。CSP 仅放行 `https://api.github.com`。
3. **发布清单：**在 `docs/development.md` 增加签名、公证、版本号、更新清单、Windows 实机验收步骤。

## 验证

- 每阶段：`pnpm check`、`pnpm test:markdown`、`pnpm test:unit`、`pnpm build`、`cargo fmt --check`、`cargo clippy`（如可用）、`cargo test`。
- 界面：回归页 `tests/ui/editor.html` 截图核对浅色 / 深色、单栏 / 双栏、欢迎页、设置、命令面板、历史、冲突提示；回归页模拟层补齐新增命令。
- `pnpm tauri dev` 下核对文件监听、回收站、导出、打印。
- 未覆盖：签名与公证、安装与升级、Windows 实机。
