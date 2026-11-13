<script setup lang="ts">
import {
  BookOpenText,
  Bookmark,
  ChevronDown,
  ChevronRight,
  CodeXml,
  FilePlus2,
  FileText,
  Folder,
  Languages,
  ListTree,
  LoaderCircle,
  LockKeyhole,
  Moon,
  MoreHorizontal,
  PanelLeft,
  Palette,
  PanelsTopLeft,
  Pencil,
  Plus,
  Save,
  Search,
  Sun,
  Trash2,
  Undo2,
  X,
  WandSparkles,
} from '@lucide/vue';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from 'vue';
import AppTitlebar from './components/app-titlebar.vue';
import AppTooltip from './components/app-tooltip.vue';
import EmptyPanel from './components/empty-panel.vue';
import LoadingState from './components/loading-state.vue';
import DocumentFind from './components/document-find.vue';
import type { SearchRange } from './lib/document-search';
import MarkdownOutlinePanel from './components/markdown-outline-panel.vue';
import { annotationMarks, resolveAnnotation } from './lib/annotation-anchor';
import { createTextMatcher } from './lib/text-matcher';
import { parseRecentProjects, rememberRecentProject } from './lib/recent-projects';
import { formatDocument } from './lib/format-document';
import { documentThemes, type DocumentTheme } from './lib/editor-theme';
import {
  chooseProject,
  createDirectory,
  createDocument,
  createProject,
  deleteAnnotation,
  deleteEntry,
  deleteTerm,
  errorMessage,
  getProjectData,
  listProjectTree,
  listResources,
  moveEntry,
  nativeAvailable,
  openProject,
  openProjectReference,
  openProjectResource,
  publishDraft,
  readDocument,
  readDocumentRevision,
  reloadDocument,
  revealProjectEntry,
  getPlatform,
  saveDocument,
  searchDocuments,
  setDirtyDraft,
  setLocked,
  setPinned,
  setTermException,
  upsertAnnotation,
  upsertTerm,
  type Annotation,
  type AnnotationKind,
  type Document,
  type ProjectData,
  type ProjectInfo,
  type ResourceNode,
  type SearchHit,
  type Term,
  type TermException,
  type TreeNode,
} from './lib/project-api';
const MarkdownRenderedEditor = defineAsyncComponent({
  loader: () => import('./components/markdown-rendered-editor.vue'),
  loadingComponent: LoadingState,
  delay: 0,
});
const MarkdownSourceEditor = defineAsyncComponent({
  loader: () => import('./components/markdown-source-editor.vue'),
  loadingComponent: LoadingState,
  delay: 0,
});
const AnnotationMarkdown = defineAsyncComponent(
  () => import('./components/annotation-markdown.vue'),
);

type Mode = 'source' | 'rendered';
type SidePanel = 'none' | 'search' | 'terms' | 'annotations';
interface DocState extends Document {
  savedContent: string;
  conflict: boolean;
  saving: boolean;
}
interface Pane {
  id: number;
  path: string | null;
  mode: Mode;
  outlineOpen: boolean;
  filters: AnnotationKind[];
  findOpen: boolean;
  searchMatches: SearchRange[];
  activeSearchOffset?: number;
}
interface Row {
  node: TreeNode;
  depth: number;
}
interface EditorHandle {
  reveal(offset: number, length?: number, focus?: boolean): Promise<void>;
  focus(): void;
  replaceMatches(matches: SearchRange[], replacement: string): void;
  selectedText(): { quote: string; offset: number } | null;
}
interface RenderedEditorHandle {
  reveal(offset: number, length?: number): Promise<boolean>;
  focus(): void;
  replaceMatches(matches: SearchRange[], replacement: string): void;
  flush(): void;
  revealAnnotation(id: string): Promise<boolean>;
  revealHeading(offset: number): Promise<boolean>;
}
interface PendingJump {
  path: string;
  paneIndex: number;
  offset: number;
  length: number;
  annotationId?: string;
}
interface SourceRevealRequest {
  offset: number;
  length: number;
  token: number;
}
const kinds: { value: AnnotationKind; label: string; color: string }[] = [
  { value: 'todo', label: '待办', color: '#d69e16' },
  { value: 'comment', label: '批注', color: '#2f7bdd' },
  { value: 'question', label: '疑问', color: '#ea701b' },
  { value: 'error', label: '错误', color: '#e04c66' },
];
const emptyData = (): ProjectData => ({
  schemaVersion: 1,
  pinned: [],
  locked: [],
  terms: [],
  termExceptions: [],
  annotations: [],
});
let nextPaneId = 0;
const emptyPane = (): Pane => ({
  id: nextPaneId++,
  path: null,
  mode: 'rendered',
  findOpen: false,
  searchMatches: [],
  outlineOpen: false,
  filters: kinds.map((kind) => kind.value),
});
const project = ref<ProjectInfo | null>(null);
const tree = ref<TreeNode[]>([]);
const resources = ref<ResourceNode[]>([]);
const expandedResources = ref(new Set<string>());
const resourceRootExpanded = ref(true);
const data = shallowRef<ProjectData>(emptyData());
const docs = ref<Record<string, DocState>>({});
const markContents = shallowRef<Record<string, string>>({});
const panes = ref<Pane[]>([emptyPane()]);
const activePane = ref(0);
const autoFormat = ref(readPreference<unknown>('vivin.auto-format', true) !== false);
const formattingPaths = ref(new Set<string>());
const formatSnapshots = shallowRef<
  Record<string, { doc: DocState; before: string; after: string }>
>({});
const preservedFormatting = new WeakMap<DocState, string>();
const expanded = ref(new Set<string>());
const sidebar = ref(true);
const maxSidebarWidth = ref(Math.max(200, Math.min(420, window.innerWidth - 480)));
const savedSidebarWidth = readPreference<unknown>('vivin.sidebar-width', 256);
const sidebarWidth = ref(
  typeof savedSidebarWidth === 'number' && Number.isFinite(savedSidebarWidth)
    ? clampSidebarWidth(savedSidebarWidth)
    : 256,
);
const panel = ref<SidePanel>('none');
const readingPanel = computed(() => panel.value === 'terms');
const annotationFilter = ref<AnnotationKind>('todo');
const query = ref('');
const hits = ref<SearchHit[]>([]);
const searchedQuery = ref('');
const selectedAnnotation = ref<Annotation | null>(null);
const annotationPopoverAt = ref({ x: 0, y: 0 });
const annotationPopoverSize = ref({ width: 320, height: 240 });
let annotationResizeObserver: ResizeObserver | undefined;
const annotationEditing = ref(false);
const annotationEditSize = ref({ width: 420, height: 320 });
const annotationDraft = ref('');
const annotationSaving = ref(false);
const hoveredTerm = ref<{
  term: Term;
  document: string;
  offset: number | null;
  x: number;
  y: number;
} | null>(null);
const hoveredTermDetail = computed(() => {
  const definition = hoveredTerm.value?.term.definition ?? '';
  const source = definition.match(/^来源：(resources\/[^\r\n]+)$/m)?.[1] ?? null;
  return {
    source,
    body: source ? definition.replace(/^来源：resources\/[^\r\n]+\r?\n?/m, '').trim() : definition,
  };
});
const focusedTermId = ref<string | null>(null);
const context = ref<TreeNode | null>(null);
const contextAt = ref({ x: 0, y: 0 });
const more = ref(false);
const projectMenu = ref(false);
const projectSwitcher = ref(false);
const recentProjects = ref(
  parseRecentProjects(readPreference<unknown>('vivin.recent-projects', [])),
);
watch(recentProjects, (value) =>
  localStorage.setItem('vivin.recent-projects', JSON.stringify(value)),
);
const locale = ref<'zh' | 'en'>(
  readPreference<string>('vivin.locale', 'zh') === 'en' ? 'en' : 'zh',
);
const theme = ref<'light' | 'dark'>(
  readPreference<string>('vivin.theme', 'light') === 'dark' ? 'dark' : 'light',
);
const platform = ref<'macos' | 'windows' | 'linux'>('macos');
const revealLabel = computed(() =>
  platform.value === 'macos'
    ? translate('在 Finder 中显示', 'Show in Finder')
    : platform.value === 'windows'
      ? translate('在文件资源管理器中显示', 'Show in File Explorer')
      : translate('在文件管理器中显示', 'Show in file manager'),
);
const savedDocumentTheme = readPreference<unknown>('vivin.document-theme', 'frame');
const documentTheme = ref<DocumentTheme>(
  savedDocumentTheme === 'classic' || savedDocumentTheme === 'nord' ? savedDocumentTheme : 'frame',
);
watch(documentTheme, (value) =>
  localStorage.setItem('vivin.document-theme', JSON.stringify(value)),
);
const windowExpanded = ref(false);
const split = ref(50);
const busy = ref(false);
const refreshing = ref(false);
const loadingPanes = ref(new Set<number>());
const paneRequestIds = new Map<number, number>();
let refreshRequests = 0;
let refreshGeneration = 0;
const searching = ref(false);
const searchRan = ref(false);
let searchRequest = 0;
const message = ref('');
function readPreference<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback;
  } catch {
    return fallback;
  }
}
function clampSidebarWidth(width: number): number {
  return Math.round(Math.max(200, Math.min(420, window.innerWidth - 480, width)));
}
function translate(zh: string, en: string) {
  return locale.value === 'zh' ? zh : en;
}
function kindLabel(kind: AnnotationKind) {
  const english: Record<AnnotationKind, string> = {
    todo: 'Todo',
    comment: 'Comment',
    question: 'Question',
    error: 'Error',
  };
  return locale.value === 'zh'
    ? (kinds.find((item) => item.value === kind)?.label ?? kind)
    : english[kind];
}
watch(locale, (value) => localStorage.setItem('vivin.locale', JSON.stringify(value)));
watch(theme, (value) => localStorage.setItem('vivin.theme', JSON.stringify(value)));
watch(autoFormat, (value) => localStorage.setItem('vivin.auto-format', JSON.stringify(value)));
watch(sidebarWidth, (value) => localStorage.setItem('vivin.sidebar-width', JSON.stringify(value)));
const dialog = ref<{
  kind: 'text' | 'confirm';
  title: string;
  value: string;
} | null>(null);
const termDialog = ref<{ id: string | null; name: string; definition: string } | null>(null);
let dialogResolve: ((value: string | boolean | null) => void) | null = null;
function finishDialog(accepted: boolean) {
  const active = dialog.value;
  dialog.value = null;
  const resolve = dialogResolve;
  dialogResolve = null;
  if (active?.kind === 'text') resolve?.(accepted ? active.value : null);
  else resolve?.(accepted);
}
function requestText(title: string, value = ''): Promise<string | null> {
  return new Promise((resolve) => {
    dialog.value = { kind: 'text', title, value };
    dialogResolve = resolve as (value: string | boolean | null) => void;
    void nextTick(() => document.getElementById('vivin-dialog-input')?.focus());
  });
}
function confirmAction(title: string): Promise<boolean> {
  return new Promise((resolve) => {
    dialog.value = { kind: 'confirm', title, value: '' };
    dialogResolve = resolve as (value: string | boolean | null) => void;
  });
}
const findPanels = new Map<number, { focus(selection?: string): void }>();
const sourceEditors = new Map<number, EditorHandle | null>();
const renderedEditors = new Map<number, RenderedEditorHandle | null>();
const sourceEditorRefs = new Map<number, (value: unknown) => void>();
const renderedEditorRefs = new Map<number, (value: unknown) => void>();
const sourceRevealRequests = ref<(SourceRevealRequest | null)[]>([]);
let revealToken = 0;
let pendingJump: PendingJump | null = null;
const pendingHeadingJumps = new Map<number, { path: string; offset: number }>();
const headingJumpsInFlight = new Set<number>();
const draftSequences = new Map<string, number>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;
const draftTimers = new Map<string, ReturnType<typeof setTimeout>>();
const markTimers = new Map<string, ReturnType<typeof setTimeout>>();
let diskTimer: ReturnType<typeof setInterval> | undefined;
let hideTermTimer: ReturnType<typeof setTimeout> | undefined;
let hideAnnotationTimer: ReturnType<typeof setTimeout> | undefined;
let annotationAnchor: Element | null = null;
const unlisten: UnlistenFn[] = [];
let closing = false;
let closePromptActive = false;

const activePath = computed(() => panes.value[activePane.value]?.path ?? null);
const current = computed(() => (activePath.value ? docs.value[activePath.value] : null));
const saving = computed(() => Object.values(docs.value).some((doc) => doc.saving));
const rows = computed<Row[]>(() => {
  const result: Row[] = [];
  const visit = (nodes: TreeNode[], depth: number) => {
    for (const node of nodes) {
      result.push({ node, depth });
      if (node.kind === 'directory' && expanded.value.has(node.path))
        visit(node.children, depth + 1);
    }
  };
  visit(tree.value, 0);
  return result;
});
const resourceRows = computed(() => {
  const result: { node: ResourceNode; depth: number }[] = [];
  const visit = (nodes: ResourceNode[], depth: number) => {
    for (const node of nodes) {
      result.push({ node, depth });
      if (node.kind === 'directory' && expandedResources.value.has(node.path))
        visit(node.children, depth + 1);
    }
  };
  visit(resources.value, 0);
  return result;
});
const resourceCount = computed(() => {
  const countFiles = (nodes: ResourceNode[]): number =>
    nodes.reduce(
      (total, node) => total + (node.kind === 'file' ? 1 : countFiles(node.children)),
      0,
    );
  return countFiles(resources.value);
});
const hoverTerms = computed(() =>
  [...data.value.terms].sort((a, b) => b.name.length - a.name.length),
);
const dirty = computed(() =>
  Object.values(docs.value).some((doc) => doc.content !== doc.savedContent),
);
watch(dirty, (value) => {
  if (nativeAvailable()) void setDirtyDraft(value).catch(report);
});
watch(query, () => {
  hits.value = [];
  searchRan.value = false;
});

function lockSource(path: string): string | null {
  let candidate = path;
  while (candidate) {
    if (data.value.locked.includes(candidate)) return candidate;
    const slash = candidate.lastIndexOf('/');
    candidate = slash < 0 ? '' : candidate.slice(0, slash);
  }
  return null;
}
function expandAll(nodes: TreeNode[]) {
  for (const node of nodes)
    if (node.kind === 'directory') {
      expanded.value.add(node.path);
      expandAll(node.children);
    }
}
async function refresh() {
  const request = ++refreshGeneration;
  refreshRequests++;
  refreshing.value = true;
  try {
    const [nextTree, nextResources, nextData] = await Promise.all([
      listProjectTree(),
      listResources(),
      getProjectData(),
    ]);
    if (request === refreshGeneration) {
      tree.value = nextTree;
      resources.value = nextResources;
      data.value = nextData;
      expandAll(nextTree);
    }
  } finally {
    refreshRequests--;
    refreshing.value = refreshRequests > 0;
  }
}
function report(error: unknown) {
  message.value = errorMessage(error);
}
function remember(doc: Document) {
  docs.value[doc.path] = {
    ...doc,
    savedContent: doc.content,
    conflict: false,
    saving: false,
  };
  markContents.value = { ...markContents.value, [doc.path]: doc.content };
}

function clearMarkTimers() {
  for (const timer of markTimers.values()) clearTimeout(timer);
  markTimers.clear();
  markContents.value = {};
}

async function switchProject(create: boolean, path?: string) {
  flushEditors();
  if (busy.value) return;
  projectMenu.value = false;
  projectSwitcher.value = false;
  if (path && path === project.value?.path) return;
  if (!nativeAvailable()) {
    message.value = translate(
      '请在桌面窗口中使用项目功能',
      'Use project features in the desktop app',
    );
    return;
  }
  if (
    dirty.value &&
    !(await confirmAction(
      translate('有未保存的内容，确定切换项目吗？', 'You have unsaved changes. Switch projects?'),
    ))
  )
    return;
  const name = create
    ? (await requestText(translate('项目名称', 'Project name')))?.trim()
    : undefined;
  if (create && !name) return;
  busy.value = true;
  try {
    const next = create
      ? await createProject(name ?? '', locale.value)
      : path
        ? await openProject(path)
        : await chooseProject(locale.value);
    if (!next) return;
    activateProject(next);
    await refresh();
    message.value = '';
  } catch (error) {
    report(error);
  } finally {
    busy.value = false;
  }
}
function activateProject(next: ProjectInfo) {
  formatSnapshots.value = {};
  pendingJump = null;
  pendingHeadingJumps.clear();
  selectedAnnotation.value = null;
  annotationEditing.value = false;
  sourceRevealRequests.value = [];
  project.value = next;
  localStorage.setItem('vivin.last-project', JSON.stringify(next.path));
  recentProjects.value = rememberRecentProject(recentProjects.value, next);
  tree.value = [];
  resources.value = [];
  data.value = emptyData();
  docs.value = {};
  clearMarkTimers();
  draftSequences.clear();
  paneRequestIds.clear();
  loadingPanes.value.clear();
  panes.value = [emptyPane()];
  activePane.value = 0;
  expanded.value.clear();
  expandedResources.value.clear();
  resourceRootExpanded.value = true;
  panel.value = 'none';
  query.value = '';
  hits.value = [];
  searchRan.value = false;
  searchRequest++;
  searching.value = false;
}
async function restoreLastProject() {
  const path = readPreference<unknown>('vivin.last-project', '');
  if (typeof path !== 'string' || !path || project.value) return;
  busy.value = true;
  try {
    const next = await openProject(path);
    activateProject(next);
    await refresh();
    message.value = '';
  } catch (error) {
    message.value = translate(
      `无法恢复上次项目：${path}。请从顶部选择正确的项目文件夹。${errorMessage(error)}`,
      `Could not reopen the last project: ${path}. Select the correct project folder from the top bar. ${errorMessage(error)}`,
    );
  } finally {
    busy.value = false;
  }
}
async function openDoc(path: string, paneIndex = activePane.value) {
  flushEditors();
  if (
    panes.value[paneIndex]?.path === path &&
    docs.value[path] &&
    !loadingPanes.value.has(paneIndex)
  ) {
    activePane.value = paneIndex;
    panel.value = 'none';
    return;
  }
  const requestId = (paneRequestIds.get(paneIndex) ?? 0) + 1;
  paneRequestIds.set(paneIndex, requestId);
  pendingHeadingJumps.delete(paneIndex);
  loadingPanes.value.add(paneIndex);
  try {
    if (!docs.value[path]) {
      const currentProject = project.value;
      const loaded = await readDocument(path);
      if (project.value !== currentProject) return;
      remember(loaded);
    }
    await nextTick();
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    if (paneRequestIds.get(paneIndex) !== requestId) return;
    const pane = panes.value[paneIndex];
    if (!pane) return;
    selectedAnnotation.value = null;
    pane.path = path;
    pane.outlineOpen = false;
    pane.mode = 'rendered';
    pane.findOpen = false;
    pane.searchMatches = [];
    pane.activeSearchOffset = undefined;
    sourceRevealRequests.value[paneIndex] = null;
    activePane.value = paneIndex;
    panel.value = 'none';
  } catch (error) {
    report(error);
  } finally {
    if (paneRequestIds.get(paneIndex) === requestId) loadingPanes.value.delete(paneIndex);
  }
}

async function openReference(sourceDocument: string, href: string) {
  try {
    const result = await openProjectReference(sourceDocument, decodeURIComponent(href));
    if (result.kind !== 'document' || !result.path) return;
    const createdSplit = panes.value.length === 1;
    if (createdSplit) toggleSplit();
    await openDoc(result.path, 1);
    if (createdSplit && panes.value[1]?.path === result.path) panes.value[1].mode = 'rendered';
  } catch (error) {
    report(error);
  }
}

async function openResource(path: string) {
  try {
    await openProjectResource(path);
  } catch (error) {
    report(error);
  }
}

async function jumpTo(path: string, offset: number, length = 0, annotationId?: string) {
  await openDoc(path);
  const paneIndex = activePane.value;
  const pane = panes.value[paneIndex];
  if (!pane) return;
  if (!annotationId) {
    pane.findOpen = false;
    pane.searchMatches = length ? [{ offset, length }] : [];
    pane.activeSearchOffset = offset;
  }
  if (pane.mode === 'source') {
    pendingJump = null;
    sourceRevealRequests.value[paneIndex] = {
      offset,
      length,
      token: ++revealToken,
    };
    return;
  }
  pendingJump = { path, paneIndex, offset, length, annotationId };
  await nextTick();
  void revealPendingJump(paneIndex);
}

async function revealPendingJump(index: number) {
  const jump = pendingJump;
  if (!jump || jump.paneIndex !== index || panes.value[index]?.path !== jump.path) return;
  if (panes.value[index]?.mode === 'rendered') {
    const editor = renderedEditors.get(panes.value[index]?.id ?? -1);
    if (!editor) return;
    const found = jump.annotationId
      ? (await editor.revealAnnotation(jump.annotationId)) ||
        (await editor.reveal(jump.offset, jump.length))
      : await editor.reveal(jump.offset, jump.length);
    if (pendingJump !== jump) return;
    if (found) {
      pendingJump = null;
      return;
    }
    if (!found)
      message.value = translate(
        '无法定位这个位置，请重试',
        'Could not locate this position. Try again.',
      );
    pendingJump = null;
  }
}

function closeFind(index: number) {
  const pane = panes.value[index];
  if (!pane) return;
  pane.findOpen = false;
  pane.searchMatches = [];
  pane.activeSearchOffset = undefined;
  if (pane.mode === 'source') sourceEditors.get(pane.id)?.focus();
  else renderedEditors.get(pane.id)?.focus();
}
async function openFind() {
  flushEditors();
  const pane = panes.value[activePane.value];
  if (!pane?.path) return;
  const selection =
    pane.mode === 'source' ? sourceEditors.get(pane.id)?.selectedText()?.quote : undefined;
  pane.findOpen = true;
  await nextTick();
  findPanels.get(pane.id)?.focus(selection);
}
function setSearchHighlights(index: number, matches: SearchRange[], active: number) {
  const pane = panes.value[index];
  if (!pane) return;
  pane.searchMatches = matches;
  pane.activeSearchOffset = matches[active]?.offset;
}
function navigateFind(index: number, match: SearchRange) {
  const pane = panes.value[index];
  if (!pane) return;
  if (pane.mode === 'source')
    void sourceEditors.get(pane.id)?.reveal(match.offset, match.length, false);
  else void renderedEditors.get(pane.id)?.reveal(match.offset, match.length);
}
function replaceFind(index: number, matches: SearchRange[], replacement: string) {
  const pane = panes.value[index];
  if (!pane?.path || lockSource(pane.path)) return;
  if (pane.mode === 'source') sourceEditors.get(pane.id)?.replaceMatches(matches, replacement);
  else renderedEditors.get(pane.id)?.replaceMatches(matches, replacement);
}

function toggleOutline(index: number) {
  const pane = panes.value[index];
  if (!pane?.path || !docs.value[pane.path]) return;
  activePane.value = index;
  pane.outlineOpen = !pane.outlineOpen;
}

async function jumpToHeading(index: number, offset: number) {
  const pane = panes.value[index];
  if (!pane?.path) return;
  activePane.value = index;
  if (pane.mode === 'source') {
    sourceRevealRequests.value[index] = { offset, length: 0, token: ++revealToken };
    return;
  }
  pendingHeadingJumps.set(index, { path: pane.path, offset });
  await nextTick();
  void revealPendingHeading(index);
}

async function revealPendingHeading(index: number) {
  if (headingJumpsInFlight.has(index)) return;
  const jump = pendingHeadingJumps.get(index);
  if (!jump || panes.value[index]?.path !== jump.path) return;
  const editor = renderedEditors.get(panes.value[index]?.id ?? -1);
  if (!editor) return;
  headingJumpsInFlight.add(index);
  try {
    const found = await editor.revealHeading(jump.offset);
    if (pendingHeadingJumps.get(index) !== jump) return;
    pendingHeadingJumps.delete(index);
    if (!found)
      message.value = translate(
        '无法定位这个标题，请重试',
        'Could not locate this heading. Try again.',
      );
  } finally {
    headingJumpsInFlight.delete(index);
    if (pendingHeadingJumps.has(index)) void revealPendingHeading(index);
  }
}

function sourceEditorRef(id: number) {
  let callback = sourceEditorRefs.get(id);
  if (!callback) {
    callback = (value) => sourceEditors.set(id, value as EditorHandle | null);
    sourceEditorRefs.set(id, callback);
  }
  return callback;
}
function renderedEditorRef(id: number) {
  let callback = renderedEditorRefs.get(id);
  if (!callback) {
    callback = (value) => {
      renderedEditors.set(id, value as RenderedEditorHandle | null);
      const index = panes.value.findIndex((pane) => pane.id === id);
      if (value && index >= 0) {
        void revealPendingJump(index);
        void revealPendingHeading(index);
      }
    };
    renderedEditorRefs.set(id, callback);
  }
  return callback;
}
function flushEditors() {
  for (const editor of renderedEditors.values()) editor?.flush();
}
function setMode(index: number, mode: Mode) {
  const pane = panes.value[index];
  if (!pane || pane.mode === mode) return;
  renderedEditors.get(pane.id)?.flush();
  activePane.value = index;
  pane.mode = mode;
}
async function formatOne(path: string, manual = false) {
  if (manual) flushEditors();
  const doc = docs.value[path];
  if (!doc || doc.conflict || lockSource(path) || formattingPaths.value.has(path)) return;
  const original = doc.content;
  const revision = doc.revision;
  formattingPaths.value.add(path);
  try {
    const formatted = await formatDocument(original);
    if (
      docs.value[path] !== doc ||
      doc.content !== original ||
      doc.revision !== revision ||
      doc.conflict ||
      lockSource(path)
    )
      return;
    setContent(path, formatted);
    if (formatted !== original) {
      formatSnapshots.value = {
        ...formatSnapshots.value,
        [path]: { doc, before: original, after: formatted },
      };
    }
    if (manual)
      message.value =
        formatted === original
          ? translate('文档格式已规范', 'Document is already formatted.')
          : translate(
              '已格式化，可使用工具栏撤销格式化',
              'Formatted. Use the toolbar to undo formatting.',
            );
  } catch (error) {
    message.value =
      translate('为保留原文，已跳过格式化：', 'Formatting skipped to preserve the source: ') +
      String(error);
  } finally {
    formattingPaths.value.delete(path);
  }
}
function canUndoFormat(path: string) {
  const snapshot = formatSnapshots.value[path];
  const doc = docs.value[path];
  return (
    !!snapshot &&
    snapshot.doc === doc &&
    snapshot.after === doc?.content &&
    !doc.conflict &&
    !lockSource(path)
  );
}
function undoFormat(path: string) {
  const snapshot = formatSnapshots.value[path];
  if (!snapshot || !canUndoFormat(path)) return;
  preservedFormatting.set(snapshot.doc, snapshot.before);
  setContent(path, snapshot.before);
  message.value = translate('已撤销格式化', 'Formatting undone.');
}
function setContent(path: string, content: string) {
  const doc = docs.value[path];
  if (!doc || lockSource(path) || doc.content === content) return;
  doc.content = content;
  const previousMarkTimer = markTimers.get(path);
  if (previousMarkTimer) clearTimeout(previousMarkTimer);
  markTimers.set(
    path,
    setTimeout(() => {
      markTimers.delete(path);
      if (docs.value[path] !== doc) return;
      markContents.value = { ...markContents.value, [path]: doc.content };
    }, 250),
  );
  if (nativeAvailable()) {
    const previousTimer = draftTimers.get(path);
    if (previousTimer) clearTimeout(previousTimer);
    const sequence = (draftSequences.get(path) ?? 0) + 1;
    draftSequences.set(path, sequence);
    draftTimers.set(
      path,
      setTimeout(() => {
        draftTimers.delete(path);
        if (docs.value[path] !== doc || doc.content !== content) return;
        void publishDraft(path, content, doc.revision, sequence).catch((error) => {
          if (draftSequences.get(path) !== sequence) return;
          if (docs.value[path] !== doc) return;
          if (/修改|冲突|版本/.test(errorMessage(error))) void reload(path, doc).catch(report);
          else report(error);
        });
      }, 750),
    );
  }
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void saveAll();
  }, 1400);
}
async function saveOne(path: string) {
  const doc = docs.value[path];
  if (!doc || doc.saving || doc.conflict || doc.content === doc.savedContent || lockSource(path))
    return;
  if (formattingPaths.value.has(path)) return;
  doc.saving = true;
  if (autoFormat.value && preservedFormatting.get(doc) !== doc.content) await formatOne(path);
  if (docs.value[path] !== doc || doc.conflict || lockSource(path)) {
    doc.saving = false;
    return;
  }
  const draftTimer = draftTimers.get(path);
  if (draftTimer) clearTimeout(draftTimer);
  draftTimers.delete(path);
  draftSequences.set(path, (draftSequences.get(path) ?? 0) + 1);
  const submitted = doc.content;
  try {
    const saved = await saveDocument({ path, content: submitted, revision: doc.revision });
    doc.revision = saved.revision;
    doc.savedContent = submitted;
    if (doc.content !== submitted && nativeAvailable()) {
      const sequence = (draftSequences.get(path) ?? 0) + 1;
      draftSequences.set(path, sequence);
      void publishDraft(path, doc.content, saved.revision, sequence).catch((error) => {
        if (draftSequences.get(path) === sequence) report(error);
      });
    }
  } catch (error) {
    if (/修改|冲突|版本/.test(errorMessage(error))) await reload(path, doc).catch(report);
    else report(error);
  } finally {
    doc.saving = false;
  }
}
async function saveAll() {
  flushEditors();
  await Promise.all(Object.keys(docs.value).map(saveOne));
}
let checkingDisk = false;
async function checkDisk() {
  if (!project.value || checkingDisk) return;
  checkingDisk = true;
  const currentProject = project.value;
  try {
    for (const doc of Object.values(docs.value)) {
      if (doc.saving) continue;
      const expectedRevision = doc.revision;
      try {
        const revision = await readDocumentRevision(doc.path);
        if (project.value !== currentProject) return;
        if (docs.value[doc.path] !== doc || doc.saving || doc.revision !== expectedRevision)
          continue;
        if (doc.conflict || revision !== expectedRevision) await reload(doc.path, doc);
      } catch {
        // A temporary missing file during an external atomic save is retried.
      }
    }
  } finally {
    checkingDisk = false;
  }
}
async function reload(path: string, expected = docs.value[path]) {
  if (!expected || docs.value[path] !== expected) return;
  const currentProject = project.value;
  expected.conflict = true;
  const draftTimer = draftTimers.get(path);
  if (draftTimer) clearTimeout(draftTimer);
  draftTimers.delete(path);
  draftSequences.set(path, (draftSequences.get(path) ?? 0) + 1);
  const loaded = await reloadDocument(path);
  if (project.value !== currentProject || docs.value[path] !== expected) return;
  formatSnapshots.value = Object.fromEntries(
    Object.entries(formatSnapshots.value).filter(([key]) => key !== path),
  );
  remember(loaded);
}
async function addDoc(directory = '') {
  const name = await requestText(
    translate('文档名称', 'Document name'),
    translate('未命名.md', 'Untitled.md'),
  );
  if (!name) return;
  try {
    const created = await createDocument(directory, name.endsWith('.md') ? name : `${name}.md`);
    remember(created);
    await refresh();
    await openDoc(created.path);
  } catch (error) {
    report(error);
  }
}
async function addDir(directory = '') {
  const name = await requestText(translate('目录名称', 'Folder name'));
  if (!name) return;
  try {
    await createDirectory(directory, name);
    await refresh();
  } catch (error) {
    report(error);
  }
}
function showContext(event: MouseEvent, node: TreeNode) {
  context.value = node;
  contextAt.value = {
    x: Math.min(event.clientX, window.innerWidth - 180),
    y: Math.min(event.clientY, window.innerHeight - 250),
  };
}
async function showInFinder(path?: string) {
  context.value = null;
  projectMenu.value = false;
  more.value = false;
  try {
    await revealProjectEntry(path ?? null);
  } catch (error) {
    report(error);
  }
}
async function action(kind: 'rename' | 'move' | 'delete' | 'pin' | 'lock') {
  flushEditors();
  const node = context.value;
  context.value = null;
  if (!node) return;
  try {
    if (kind === 'rename' || kind === 'move') {
      const slash = node.path.lastIndexOf('/');
      const parent = slash < 0 ? '' : node.path.slice(0, slash);
      const destination =
        kind === 'move'
          ? await requestText(
              translate('目标目录（根目录留空）', 'Destination folder (blank for root)'),
              parent,
            )
          : parent;
      const name =
        kind === 'rename'
          ? await requestText(translate('新名称', 'New name'), node.name)
          : node.name;
      if (destination === null || !name) return;
      const next = await moveEntry(node.path, destination, name);
      for (const [path, doc] of Object.entries(docs.value))
        if (path === node.path || path.startsWith(`${node.path}/`)) {
          const newPath = next + path.slice(node.path.length);
          delete docs.value[path];
          docs.value[newPath] = { ...doc, path: newPath };
        }
      for (const pane of panes.value)
        if (pane.path === node.path || pane.path?.startsWith(`${node.path}/`))
          pane.path = next + pane.path.slice(node.path.length);
    } else if (kind === 'delete') {
      if (
        !(await confirmAction(
          translate(
            `确定删除“${node.name}”及其内容吗？`,
            `Delete “${node.name}” and its contents?`,
          ),
        ))
      )
        return;
      await deleteEntry(node.path);
      for (const path of Object.keys(docs.value))
        if (path === node.path || path.startsWith(`${node.path}/`)) delete docs.value[path];
      for (const pane of panes.value)
        if (pane.path === node.path || pane.path?.startsWith(`${node.path}/`)) pane.path = null;
    } else if (kind === 'pin') await setPinned(node.path, !node.pinned);
    else await setLocked(node.path, node.lockSource !== node.path);
    await refresh();
  } catch (error) {
    report(error);
  }
}
async function runSearch() {
  if (!query.value.trim()) {
    hits.value = [];
    searchRan.value = false;
    return;
  }
  searching.value = true;
  panel.value = 'search';
  hits.value = [];
  const request = ++searchRequest;
  const term = query.value;
  try {
    const found = await searchDocuments(term);
    if (request === searchRequest && term === query.value) {
      hits.value = found;
      searchedQuery.value = term.trim();
      searchRan.value = true;
    }
  } catch (error) {
    report(error);
  } finally {
    if (request === searchRequest) searching.value = false;
  }
}

async function termAction(term?: Term) {
  termDialog.value = {
    id: term?.id ?? null,
    name: term?.name ?? '',
    definition: term?.definition ?? '',
  };
  await nextTick();
  document.getElementById('vivin-term-name')?.focus();
}
async function saveTermDialog() {
  const draft = termDialog.value;
  if (!draft || !draft.name.trim()) return;
  try {
    await upsertTerm(draft.id, draft.name, draft.definition);
    termDialog.value = null;
    await refresh();
  } catch (error) {
    report(error);
  }
}
async function removeTerm(id: string) {
  if (!(await confirmAction(translate('删除这个术语吗？', 'Delete this term?')))) return;
  try {
    await deleteTerm(id);
    await refresh();
  } catch (error) {
    report(error);
  }
}
function count(kind: AnnotationKind) {
  return data.value.annotations.filter((annotation) => annotation.kind === kind).length;
}
function locate(annotation: Annotation, content: string): number | null {
  return resolveAnnotation(content, annotation);
}
const annotationsById = computed(
  () => new Map(data.value.annotations.map((annotation) => [annotation.id, annotation])),
);
const annotationMarksByDocument = computed(() => {
  const marks: Record<string, ReturnType<typeof annotationMarks>> = {};
  for (const pane of panes.value) {
    if (!pane.path || marks[pane.path]) continue;
    marks[pane.path] = annotationMarks(
      markContents.value[pane.path] ?? docs.value[pane.path]?.content ?? '',
      data.value.annotations.filter((item) => item.document === pane.path),
    );
  }
  return marks;
});
function positionAnnotationPopover() {
  if (!annotationAnchor?.isConnected || !selectedAnnotation.value) return;
  const rect = annotationAnchor.getBoundingClientRect();
  const canvas = annotationAnchor
    .closest('section[data-pane-index]')
    ?.querySelector('.markdown-canvas');
  if (!canvas) return;
  const bounds = canvas.getBoundingClientRect();
  annotationPopoverSize.value = {
    width: Math.floor((bounds.width * 2) / 3),
    height: Math.floor((bounds.height * 2) / 3),
  };
  const card = document.getElementById('vivin-annotation-popover');
  const width = Math.min(card?.offsetWidth ?? 200, annotationPopoverSize.value.width);
  const height = Math.min(card?.offsetHeight ?? 120, annotationPopoverSize.value.height);
  annotationPopoverAt.value = {
    x: Math.max(bounds.left, Math.min(rect.left, bounds.right - width)),
    y: Math.max(
      bounds.top,
      Math.min(
        rect.bottom + 8 + height <= bounds.bottom ? rect.bottom + 8 : rect.top - height - 8,
        bounds.bottom - height,
      ),
    ),
  };
}
watch(selectedAnnotation, async (annotation) => {
  annotationResizeObserver?.disconnect();
  if (!annotation) return;
  await nextTick();
  positionAnnotationPopover();
  const card = document.getElementById('vivin-annotation-popover');
  const canvas = annotationAnchor
    ?.closest('section[data-pane-index]')
    ?.querySelector('.markdown-canvas');
  annotationResizeObserver = new ResizeObserver(positionAnnotationPopover);
  if (card) annotationResizeObserver.observe(card);
  if (canvas) annotationResizeObserver.observe(canvas);
});
function showAnnotationPopover(annotation: Annotation, element: Element) {
  if (hideAnnotationTimer) clearTimeout(hideAnnotationTimer);
  if (annotationEditing.value) return;
  if (selectedAnnotation.value?.id === annotation.id) return;
  annotationAnchor = element;
  const rect = element.getBoundingClientRect();
  annotationPopoverAt.value = {
    x: Math.max(12, Math.min(rect.left, window.innerWidth - 332)),
    y: rect.bottom + 8,
  };
  selectedAnnotation.value = annotation;
  annotationDraft.value = annotation.note;
  hoveredTerm.value = null;
  void nextTick(positionAnnotationPopover);
}
watch(annotationEditing, () => void nextTick(positionAnnotationPopover));
function keepAnnotationPopover() {
  if (hideAnnotationTimer) clearTimeout(hideAnnotationTimer);
  hideAnnotationTimer = undefined;
}
function scheduleHideAnnotationPopover() {
  if (annotationEditing.value) return;
  if (hideAnnotationTimer) clearTimeout(hideAnnotationTimer);
  hideAnnotationTimer = setTimeout(() => {
    selectedAnnotation.value = null;
    hideAnnotationTimer = undefined;
  }, 180);
}
function handleAnnotationHover(event: MouseEvent) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const mark = target.closest('[data-annotation-id]');
  const id = mark?.getAttribute('data-annotation-id');
  const annotation = annotationsById.value.get(id ?? '');
  if (annotation && mark) showAnnotationPopover(annotation, mark);
  else if (selectedAnnotation.value && !hideAnnotationTimer) scheduleHideAnnotationPopover();
}
function handleEditorClick(event: MouseEvent) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const mark = target.closest('[data-annotation-id]');
  const id = mark?.getAttribute('data-annotation-id');
  const annotation = annotationsById.value.get(id ?? '');
  if (annotation && mark) showAnnotationPopover(annotation, mark);
}

const matchTerms = computed(() =>
  createTextMatcher(
    hoverTerms.value.map((term, priority) => ({ text: term.name, value: { term, priority } })),
  ),
);

function termOffsets(content: string, term: string): number[] {
  if (!term) return [];
  const offsets: number[] = [];
  let from = 0;
  while (from < content.length) {
    const found = content.indexOf(term, from);
    if (found < 0) break;
    offsets.push(found);
    from = found + term.length;
  }
  return offsets;
}

function termMarksFor(path: string) {
  const content = markContents.value[path] ?? docs.value[path]?.content ?? '';
  const ignored = new Set<string>();
  for (const exception of data.value.termExceptions) {
    if (exception.document !== path) continue;
    const term = data.value.terms.find((item) => item.id === exception.termId);
    if (!term) continue;
    const offset = resolveAnnotation(content, {
      ...exception,
      kind: 'comment',
      quote: term.name,
      note: '',
    });
    if (offset !== null) ignored.add(`${term.id}:${offset}`);
  }
  const occupied: { start: number; end: number }[] = [];
  const lastEndByTerm = new Map<string, number>();
  const marks: { id: string; offset: number; quote: string }[] = [];
  const candidates = matchTerms
    .value(content)
    .sort(
      (left, right) => left.value.priority - right.value.priority || left.offset - right.offset,
    );
  for (const {
    value: { term },
    offset,
    length,
  } of candidates) {
    const end = offset + length;
    if (offset < (lastEndByTerm.get(term.id) ?? 0)) continue;
    lastEndByTerm.set(term.id, end);
    if (ignored.has(`${term.id}:${offset}`)) continue;
    let left = 0;
    let right = occupied.length;
    while (left < right) {
      const middle = (left + right) >>> 1;
      if ((occupied[middle]?.start ?? 0) < offset) left = middle + 1;
      else right = middle;
    }
    if ((occupied[left - 1]?.end ?? 0) > offset || (occupied[left]?.start ?? Infinity) < end)
      continue;
    occupied.splice(left, 0, { start: offset, end });
    marks.push({ id: term.id, offset, quote: term.name });
  }
  return marks;
}
const termMarksByDocument = computed(() => {
  const marks: Record<string, ReturnType<typeof termMarksFor>> = {};
  for (const pane of panes.value)
    if (pane.path && !marks[pane.path]) marks[pane.path] = termMarksFor(pane.path);
  return marks;
});

function showTermHover(event: MouseEvent, pane: Pane) {
  const target = event.target;
  if (!(target instanceof Element) || !pane.path) {
    scheduleHideTerm();
    return;
  }
  const mark = target.closest<HTMLElement>('[data-term-id][data-term-offset]');
  if (!mark || target.closest('[data-annotation-id]')) {
    scheduleHideTerm();
    return;
  }
  const term = hoverTerms.value.find((item) => item.id === mark.dataset.termId);
  const offset = Number(mark.dataset.termOffset);
  if (!term || !Number.isInteger(offset)) {
    scheduleHideTerm();
    return;
  }
  keepTerm();
  if (
    hoveredTerm.value?.term.id === term.id &&
    hoveredTerm.value?.document === pane.path &&
    hoveredTerm.value?.offset === offset
  )
    return;
  const rect = mark.getBoundingClientRect();
  hoveredTerm.value = { term, document: pane.path, offset, x: rect.left, y: rect.bottom + 6 };
  void nextTick(() => {
    if (hoveredTerm.value?.term.id !== term.id || hoveredTerm.value.offset !== offset) return;
    const card = document.getElementById('vivin-term-popover');
    if (!card) return;
    hoveredTerm.value = {
      ...hoveredTerm.value,
      x: Math.max(12, Math.min(rect.left, window.innerWidth - card.offsetWidth - 12)),
      y:
        rect.bottom + 6 + card.offsetHeight <= window.innerHeight - 12
          ? rect.bottom + 6
          : Math.max(12, rect.top - card.offsetHeight - 6),
    };
  });
}

function scheduleHideTerm() {
  if (!hoveredTerm.value) return;
  if (hideTermTimer) clearTimeout(hideTermTimer);
  hideTermTimer = setTimeout(() => {
    hoveredTerm.value = null;
    hideTermTimer = undefined;
  }, 220);
}
function keepTerm() {
  if (hideTermTimer) clearTimeout(hideTermTimer);
  hideTermTimer = undefined;
}
async function disableTermHere() {
  const hover = hoveredTerm.value;
  if (!hover || hover.offset === null) return;
  try {
    await setTermException(hover.document, hover.term.id, hover.offset, true);
    await refresh();
    hoveredTerm.value = null;
  } catch (error) {
    report(error);
  }
}
async function restoreTermException(exception: TermException) {
  try {
    await setTermException(
      exception.document,
      exception.termId,
      exception.offset,
      false,
      exception.id,
    );
    await refresh();
  } catch (error) {
    report(error);
  }
}
function viewTerm(term: Term) {
  focusedTermId.value = term.id;
  panel.value = 'terms';
  hoveredTerm.value = null;
  void nextTick(() =>
    document.getElementById(`term-${term.id}`)?.scrollIntoView({ block: 'center' }),
  );
}
function requestEditorAnnotation(
  paneIndex: number,
  kind: AnnotationKind,
  selected: { quote: string; offset: number },
) {
  activePane.value = paneIndex;
  void addAnnotation(kind, selected);
}

async function addAnnotation(
  kind: AnnotationKind,
  selectedOverride?: { quote: string; offset: number },
) {
  const path = activePath.value;
  const doc = current.value;
  if (!path || !doc || lockSource(path)) return;
  const pane = panes.value[activePane.value];
  let selected =
    selectedOverride ??
    (pane?.mode === 'source'
      ? sourceEditors.get(panes.value[activePane.value]?.id ?? -1)?.selectedText()
      : null);
  if (!selected && pane?.mode === 'rendered') {
    const selection = window.getSelection();
    const range = selection && !selection.isCollapsed ? selection.getRangeAt(0) : null;
    const rendered = Array.from(
      document.querySelectorAll(`[data-pane-index="${activePane.value}"] .rendered-editor`),
    ).find((element) => range && element.contains(range.commonAncestorContainer));
    if (range && rendered) {
      const quote = selection?.toString() ?? '';
      const walker = document.createTreeWalker(rendered, NodeFilter.SHOW_TEXT);
      let allText = '';
      let startAt = -1;
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node === range.startContainer) startAt = allText.length + range.startOffset;
        allText += node.textContent ?? '';
      }
      const segment = rendered.closest<HTMLElement>('[data-segment-start]');
      const segmentStart = Number(segment?.dataset.segmentStart ?? 0);
      const segmentEnd = Number(segment?.dataset.segmentEnd ?? doc.content.length);
      const raw = termOffsets(doc.content.slice(segmentStart, segmentEnd), quote);
      const visible = termOffsets(allText, quote);
      const rank = visible.indexOf(startAt);
      if (quote && rank >= 0 && raw.length === visible.length && raw[rank] !== undefined)
        selected = { quote, offset: segmentStart + raw[rank] };
      else if (quote && raw.length === 1) selected = { quote, offset: segmentStart + raw[0]! };
    }
  }
  if (!selected?.quote) {
    message.value = translate('请先在文档中选择要标注的文字', 'Select text in the document first');
    return;
  }
  const { quote, offset } = selected;
  if (doc.content.slice(offset, offset + quote.length) !== quote) {
    message.value = translate(
      '无法准确定位选中文字，请切换原文模式重试',
      'Cannot locate the selection. Try source mode.',
    );
    return;
  }
  const note = await requestText(translate('标注说明（可留空）', 'Annotation note (optional)'), '');
  if (note === null) return;
  try {
    await upsertAnnotation({
      id: '',
      document: path,
      kind,
      quote,
      offset,
      note,
      contextBefore: doc.content.slice(Math.max(0, offset - 32), offset),
      contextAfter: doc.content.slice(offset + quote.length, offset + quote.length + 32),
    });
    await refresh();
  } catch (error) {
    report(error);
  }
}
function startAnnotationEdit() {
  const annotation = selectedAnnotation.value;
  if (!annotation) return;
  keepAnnotationPopover();
  annotationDraft.value = annotation.note;
  const card = document.getElementById('vivin-annotation-popover');
  annotationEditSize.value = {
    width: Math.max(420, card?.offsetWidth ?? 0),
    height: Math.max(320, card?.offsetHeight ?? 0),
  };
  annotationEditing.value = true;
  void nextTick(() => document.getElementById('vivin-annotation-note')?.focus());
}
async function updateAnnotation(annotation: Annotation) {
  if (annotationSaving.value) return;
  annotationSaving.value = true;
  try {
    const updated = await upsertAnnotation({
      ...annotation,
      note: annotationDraft.value,
    });
    if (selectedAnnotation.value?.id === annotation.id) selectedAnnotation.value = updated;
    annotationEditing.value = false;
    await refresh();
  } catch (error) {
    report(error);
  } finally {
    annotationSaving.value = false;
  }
}
async function removeAnnotation(annotation: Annotation) {
  if (!(await confirmAction(translate('删除这个标注吗？', 'Delete this annotation?')))) return;
  try {
    await deleteAnnotation(annotation.id);
    selectedAnnotation.value = null;
    annotationEditing.value = false;
    await refresh();
  } catch (error) {
    report(error);
  }
}
function closePane(index: number) {
  flushEditors();
  if (panes.value.length <= 1) return;
  selectedAnnotation.value = null;
  panes.value.splice(index, 1);
  sourceRevealRequests.value.splice(index, 1);
  pendingJump = null;
  pendingHeadingJumps.clear();
  paneRequestIds.clear();
  loadingPanes.value.clear();
  activePane.value = Math.max(0, activePane.value - (index <= activePane.value ? 1 : 0));
}
function toggleSplit() {
  if (panes.value.length === 2) closePane(activePane.value);
  else panes.value.push({ ...emptyPane(), path: activePath.value, mode: 'source' });
}
function resize(event: PointerEvent) {
  const handle = event.currentTarget;
  if (!(handle instanceof HTMLElement)) return;
  const host = handle.parentElement;
  if (!host) return;
  handle.setPointerCapture(event.pointerId);
  const move = (next: PointerEvent) => {
    const rect = host.getBoundingClientRect();
    split.value = Math.max(25, Math.min(75, (100 * (next.clientX - rect.left)) / rect.width));
  };
  const stop = () => {
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', stop);
    handle.removeEventListener('pointercancel', stop);
    handle.removeEventListener('lostpointercapture', stop);
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', stop);
  handle.addEventListener('pointercancel', stop);
  handle.addEventListener('lostpointercapture', stop);
}
function resizeSidebar(event: PointerEvent) {
  const handle = event.currentTarget;
  if (!(handle instanceof HTMLElement)) return;
  const sidebarElement = handle.parentElement;
  if (!sidebarElement) return;
  handle.setPointerCapture(event.pointerId);
  const move = (next: PointerEvent) => {
    sidebarWidth.value = clampSidebarWidth(
      next.clientX - sidebarElement.getBoundingClientRect().left,
    );
  };
  const stop = () => {
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', stop);
    handle.removeEventListener('pointercancel', stop);
    handle.removeEventListener('lostpointercapture', stop);
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', stop);
  handle.addEventListener('pointercancel', stop);
  handle.addEventListener('lostpointercapture', stop);
}
function clampSidebarOnWindowResize() {
  maxSidebarWidth.value = Math.max(200, Math.min(420, window.innerWidth - 480));
  sidebarWidth.value = clampSidebarWidth(sidebarWidth.value);
}
function shortcut(event: KeyboardEvent) {
  // Leave macOS's native Control-Command-F fullscreen shortcut to the system.
  if (
    platform.value === 'macos' &&
    event.ctrlKey &&
    event.metaKey &&
    event.key.toLowerCase() === 'f'
  )
    return;
  if (event.key === 'Escape' && platform.value === 'macos') {
    event.preventDefault();
  }
  if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'f') {
    event.preventDefault();
    const path = panes.value[activePane.value]?.path;
    if (path) void formatOne(path, true);
    return;
  }
  if (event.key === 'Escape' && dialog.value) {
    event.preventDefault();
    event.stopPropagation();
    finishDialog(false);
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    void saveAll();
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
    event.preventDefault();
    event.stopPropagation();
    void openFind();
    return;
  }
  if (event.key === 'Escape') {
    const modal = document.querySelector<HTMLDialogElement>('dialog[open]');
    if (modal) {
      event.preventDefault();
      event.stopPropagation();
      modal.close();
      return;
    }
  }
  if (event.key === 'Escape' && panes.value[activePane.value]?.findOpen) {
    event.preventDefault();
    event.stopPropagation();
    closeFind(activePane.value);
    return;
  }
  if (event.key === 'Escape') {
    context.value = null;
    more.value = false;
    projectMenu.value = false;
    projectSwitcher.value = false;
    for (const pane of panes.value) pane.outlineOpen = false;
  }
}
onMounted(() => {
  window.addEventListener('keydown', shortcut, true);
  window.addEventListener('scroll', positionAnnotationPopover, true);
  window.addEventListener('resize', clampSidebarOnWindowResize);
  if (nativeAvailable()) {
    void getPlatform()
      .then((value) => {
        platform.value = value;
      })
      .catch(report);
    const currentWindow = getCurrentWindow();
    const syncWindowSize = async () => {
      windowExpanded.value =
        (await currentWindow.isFullscreen()) || (await currentWindow.isMaximized());
    };
    void syncWindowSize();
    void currentWindow.onResized(() => void syncWindowSize()).then((stop) => unlisten.push(stop));
    void restoreLastProject();
    void currentWindow
      .onCloseRequested(async (event) => {
        if (closing) return;
        flushEditors();
        if (!dirty.value && !closePromptActive) return;
        event.preventDefault();
        if (closePromptActive) return;
        closePromptActive = true;
        try {
          if (
            !(await confirmAction(
              translate(
                '有未保存的内容，保存后关闭窗口吗？',
                'You have unsaved changes. Save and close?',
              ),
            ))
          )
            return;
          await saveAll();
          if (
            dirty.value &&
            !(await confirmAction(
              translate(
                '部分内容仍未保存，确定丢弃并关闭吗？',
                'Some changes are still unsaved. Discard and close?',
              ),
            ))
          )
            return;
          closing = true;
          try {
            await currentWindow.close();
          } catch (error) {
            closing = false;
            report(error);
          }
        } finally {
          closePromptActive = false;
        }
      })
      .then((stop) => unlisten.push(stop));
    void listen<ProjectInfo>('vivin://project-opened', (event) => {
      activateProject(event.payload);
      void refresh();
    }).then((stop) => unlisten.push(stop));
    void listen('vivin://project-closed', () => {
      localStorage.setItem('vivin.last-project', JSON.stringify(''));
      project.value = null;
      tree.value = [];
      resources.value = [];
      expandedResources.value.clear();
      resourceRootExpanded.value = true;
      data.value = emptyData();
      docs.value = {};
      clearMarkTimers();
      draftSequences.clear();
      paneRequestIds.clear();
      loadingPanes.value.clear();
      panes.value = [emptyPane()];
      activePane.value = 0;
      panel.value = 'none';
      hits.value = [];
      searchRan.value = false;
      searchRequest++;
      searching.value = false;
    }).then((stop) => unlisten.push(stop));
    void listen<{ document: Document }>('vivin://document-written', (event) => {
      void reload(event.payload.document.path).catch(report);
    }).then((stop) => unlisten.push(stop));
    void listen<string>('vivin://document-changed', (event) => {
      void reload(event.payload).catch(report);
    }).then((stop) => unlisten.push(stop));
    void listen('vivin://project-changed', () => {
      if (project.value) void refresh();
    }).then((stop) => unlisten.push(stop));
    void listen<{ from: string; to: string }>('vivin://entry-moved', (event) => {
      const { from, to } = event.payload;
      for (const [path, doc] of Object.entries(docs.value))
        if (path === from || path.startsWith(`${from}/`)) {
          const next = to + path.slice(from.length);
          delete docs.value[path];
          docs.value[next] = { ...doc, path: next };
        }
      for (const pane of panes.value)
        if (pane.path === from || pane.path?.startsWith(`${from}/`))
          pane.path = to + pane.path.slice(from.length);
    }).then((stop) => unlisten.push(stop));
    void listen<{ path: string }>('vivin://entry-deleted', (event) => {
      const path = event.payload.path;
      for (const key of Object.keys(docs.value))
        if (key === path || key.startsWith(`${path}/`)) delete docs.value[key];
      for (const pane of panes.value)
        if (pane.path === path || pane.path?.startsWith(`${path}/`)) pane.path = null;
    }).then((stop) => unlisten.push(stop));
  }
  diskTimer = setInterval(() => {
    void checkDisk();
  }, 2500);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', shortcut, true);
  window.removeEventListener('scroll', positionAnnotationPopover, true);
  annotationResizeObserver?.disconnect();
  window.removeEventListener('resize', clampSidebarOnWindowResize);
  if (saveTimer) clearTimeout(saveTimer);
  for (const timer of draftTimers.values()) clearTimeout(timer);
  if (diskTimer) clearInterval(diskTimer);
  if (hideTermTimer) clearTimeout(hideTermTimer);
  if (hideAnnotationTimer) clearTimeout(hideAnnotationTimer);
  for (const stop of unlisten) stop();
});
</script>

<template>
  <div
    :class="[
      'app-shell flex flex-col overflow-hidden bg-[#f3f6fa] text-slate-900',
      windowExpanded || platform === 'macos'
        ? 'h-screen rounded-none'
        : 'm-2 h-[calc(100vh-16px)] rounded-xl shadow-[0_4px_14px_-3px_rgb(15_23_42_/_18%)]',
      theme === 'dark' ? 'theme-dark' : '',
    ]"
    :data-document-theme="documentTheme"
    @click="
      context = null;
      projectMenu = false;
      projectSwitcher = false;
      more = false;
    "
  >
    <AppTitlebar
      :sidebar-open="sidebar"
      :sidebar-width="sidebarWidth"
      :platform="platform"
      :locale="locale"
    >
      <template #sidebar-control>
        <button
          class="rounded-md p-1.5 text-slate-600 hover:bg-slate-200/70"
          :title="translate('切换侧栏', 'Toggle sidebar')"
          @click.stop="sidebar = !sidebar"
        >
          <PanelLeft :size="18" />
        </button>
      </template>
      <div class="relative flex min-w-0 items-center gap-2">
        <button
          class="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-sm font-semibold hover:bg-slate-200/70 disabled:opacity-50"
          :title="translate('切换项目', 'Switch project')"
          :aria-label="translate('切换项目', 'Switch project')"
          aria-haspopup="menu"
          :aria-expanded="projectSwitcher"
          :disabled="busy"
          @click.stop="
            projectSwitcher = !projectSwitcher;
            projectMenu = false;
            more = false;
          "
        >
          <span class="truncate">{{ project?.name || 'vivin' }}</span>
          <ChevronDown :size="14" class="shrink-0 text-slate-500" />
        </button>
        <div
          v-if="projectSwitcher"
          class="absolute left-0 top-9 z-50 w-80 max-w-[calc(100vw-32px)] rounded-xl bg-white p-1 text-sm shadow-lg"
          role="menu"
          :aria-label="translate('最近项目', 'Recent projects')"
          @click.stop
        >
          <p class="px-3 py-2 text-xs font-medium text-slate-500">
            {{ translate('最近项目', 'Recent projects') }}
          </p>
          <div class="max-h-72 overflow-y-auto">
            <p v-if="!recentProjects.length" class="px-3 py-3 text-xs text-slate-400">
              {{
                translate(
                  '打开的项目会自动保存在这里',
                  'Opened projects will appear here automatically',
                )
              }}
            </p>
            <div
              v-for="recent in recentProjects"
              :key="recent.path"
              class="group flex items-center"
            >
              <button
                class="min-w-0 flex-1 rounded-lg px-3 py-2 text-left hover:bg-slate-100 disabled:opacity-50"
                :class="recent.path === project?.path ? 'text-blue-700' : ''"
                :aria-current="recent.path === project?.path ? 'true' : undefined"
                :title="recent.path"
                :disabled="busy"
                role="menuitem"
                @click.stop="switchProject(false, recent.path)"
              >
                <span class="block truncate font-medium">{{ recent.name }}</span>
                <span class="block truncate text-[11px] text-slate-400">{{ recent.path }}</span>
              </button>
              <button
                class="mr-1 shrink-0 rounded p-1.5 text-slate-400 hover:bg-slate-100"
                :aria-label="translate('从最近项目中移除', 'Remove from recent projects')"
                role="menuitem"
                @click.stop="
                  recentProjects = recentProjects.filter((item) => item.path !== recent.path)
                "
              >
                <X :size="14" />
              </button>
            </div>
          </div>
          <div class="mt-1 border-t border-slate-100 pt-1">
            <button
              class="block w-full rounded-lg px-3 py-2 text-left hover:bg-slate-100"
              role="menuitem"
              @click.stop="switchProject(false)"
            >
              {{ translate('打开项目文件夹…', 'Open project folder…') }}
            </button>
            <button
              class="block w-full rounded-lg px-3 py-2 text-left hover:bg-slate-100"
              role="menuitem"
              @click.stop="switchProject(true)"
            >
              {{ translate('新建项目…', 'New project…') }}
            </button>
          </div>
        </div>
        <LoaderCircle
          v-if="busy || refreshing"
          :size="15"
          class="animate-spin text-blue-600"
          :title="translate('正在加载项目', 'Loading project')"
        />
      </div>
      <div class="flex shrink-0 items-center gap-1.5 text-slate-600">
        <div class="relative shrink-0">
          <button
            :title="translate('新建或打开项目', 'Create or open project')"
            :aria-label="translate('新建或打开项目', 'Create or open project')"
            class="rounded-md p-1 text-slate-600 hover:bg-slate-200/70"
            @click.stop="
              projectMenu = !projectMenu;
              projectSwitcher = false;
              more = false;
            "
          >
            <Plus :size="17" />
          </button>
          <div
            v-if="projectMenu"
            class="absolute right-0 top-8 z-40 w-44 rounded-xl bg-white p-1 text-sm shadow-lg"
            role="menu"
          >
            <button
              class="block w-full rounded-lg px-3 py-2 text-left hover:bg-slate-100"
              role="menuitem"
              @click.stop="switchProject(true)"
            >
              {{ translate('新建项目', 'New project') }}
            </button>
            <button
              class="block w-full rounded-lg px-3 py-2 text-left hover:bg-slate-100"
              role="menuitem"
              @click.stop="switchProject(false)"
            >
              {{ translate('打开项目文件夹', 'Open project folder') }}
            </button>
          </div>
        </div>
        <template v-if="project">
          <label
            class="mr-2 flex w-44 items-center gap-2 rounded-lg bg-white/80 px-2.5 py-1.5 lg:w-60"
          >
            <Search
              :size="16"
              class="shrink-0 text-slate-400"
              :title="translate('搜索文档', 'Search documents')"
            />
            <input
              id="vivin-search"
              v-model="query"
              class="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-slate-400"
              :placeholder="
                translate('搜索文档、标题或内容…', 'Search documents, titles, or content…')
              "
              :aria-label="translate('搜索文档', 'Search documents')"
              @focus="panel = 'search'"
              @keydown.enter.prevent="runSearch"
            />
          </label>
          <button
            :title="translate('分栏', 'Split view')"
            class="rounded-md p-1.5 hover:bg-slate-200/70"
            @click.stop="toggleSplit"
          >
            <PanelsTopLeft :size="17" />
          </button>
          <button
            :title="translate('保存', 'Save')"
            class="rounded-md p-1.5 hover:bg-slate-200/70"
            @click.stop="saveAll"
          >
            <LoaderCircle v-if="saving" :size="17" class="animate-spin" />
            <Save v-else :size="17" />
          </button>
        </template>
        <label
          class="flex items-center gap-1 rounded-md px-1.5 py-1 text-slate-600"
          :title="translate('Markdown 主题', 'Markdown theme')"
        >
          <Palette :size="17" />
          <select
            v-model="documentTheme"
            class="max-w-24 cursor-pointer border-0 bg-transparent text-xs outline-none focus:ring-0 focus-visible:bg-slate-200/70"
            :aria-label="translate('Markdown 主题', 'Markdown theme')"
          >
            <option v-for="item in documentThemes" :key="item.value" :value="item.value">
              {{ item.label }}
            </option>
          </select>
        </label>
        <button
          class="rounded-md p-1.5 hover:bg-slate-200/70"
          :title="translate('切换语言', 'Switch language')"
          :aria-label="translate('切换语言', 'Switch language')"
          @click.stop="locale = locale === 'zh' ? 'en' : 'zh'"
        >
          <Languages :size="17" />
        </button>
        <button
          class="rounded-md p-1.5 hover:bg-slate-200/70"
          :title="
            theme === 'dark'
              ? translate('切换到浅色模式', 'Switch to light mode')
              : translate('切换到深色模式', 'Switch to dark mode')
          "
          :aria-label="translate('切换明暗模式', 'Toggle appearance')"
          @click.stop="theme = theme === 'dark' ? 'light' : 'dark'"
        >
          <Sun v-if="theme === 'dark'" :size="17" /><Moon v-else :size="17" />
        </button>
        <template v-if="project">
          <div class="relative">
            <button
              :title="translate('更多', 'More')"
              class="rounded-md p-1.5 hover:bg-slate-200/70"
              @click.stop="
                more = !more;
                projectMenu = false;
                projectSwitcher = false;
              "
            >
              <MoreHorizontal :size="18" />
            </button>
            <div
              v-if="more"
              class="absolute right-0 top-9 z-30 w-40 rounded-xl bg-white p-1 text-sm shadow-lg"
            >
              <button
                class="w-full rounded-lg px-3 py-2 text-left hover:bg-slate-100"
                @click.stop="showInFinder()"
              >
                {{ revealLabel }}</button
              ><button
                class="w-full rounded-lg px-3 py-2 text-left hover:bg-slate-100"
                @click.stop="
                  more = false;
                  panel = 'terms';
                "
              >
                {{ translate('项目术语', 'Project terms') }}
              </button>
            </div>
          </div>
        </template>
      </div>
    </AppTitlebar>
    <div class="flex min-h-0 flex-1">
      <aside
        v-if="sidebar"
        class="relative flex shrink-0 flex-col bg-[#f3f6fa]"
        :style="{ width: `${sidebarWidth}px` }"
      >
        <div
          class="group absolute inset-y-0 right-0 z-10 flex w-2 touch-none cursor-col-resize items-center justify-center"
          role="separator"
          aria-orientation="vertical"
          :aria-label="translate('调整侧栏宽度', 'Resize sidebar')"
          :aria-valuenow="sidebarWidth"
          :aria-valuemin="200"
          :aria-valuemax="maxSidebarWidth"
          tabindex="0"
          @pointerdown.prevent.stop="resizeSidebar"
          @keydown.left.prevent="sidebarWidth = clampSidebarWidth(sidebarWidth - 16)"
          @keydown.right.prevent="sidebarWidth = clampSidebarWidth(sidebarWidth + 16)"
        >
          <div
            class="h-full w-px bg-slate-300 opacity-0 group-hover:opacity-100 group-focus:opacity-100"
          />
        </div>
        <div
          class="flex items-center justify-between px-4 pb-2 pt-4 text-xs font-semibold text-slate-500"
        >
          <span>{{ translate('项目文件', 'Project files') }}</span>
          <div class="flex gap-1">
            <button
              v-if="project"
              :title="translate('新建目录', 'New folder')"
              class="rounded p-1 hover:bg-slate-200"
              @click.stop="addDir()"
            >
              <Folder :size="15" /></button
            ><button
              v-if="project"
              :title="translate('新建文档', 'New document')"
              class="rounded p-1 hover:bg-slate-200"
              @click.stop="addDoc()"
            >
              <FilePlus2 :size="15" />
            </button>
          </div>
        </div>
        <p v-if="!project" class="mx-5 mt-1 text-xs leading-5 text-slate-400">
          {{
            translate(
              '点击右上角 + 新建或打开项目',
              'Use + at the top right to create or open a project',
            )
          }}
        </p>
        <div v-if="project" class="min-h-0 flex-1 overflow-y-auto">
          <div class="px-3 py-2">
            <div v-if="refreshing && rows.length === 0" class="space-y-3 px-3 py-2" role="status">
              <div
                v-for="line in 3"
                :key="line"
                class="h-3 animate-pulse rounded bg-slate-200/70"
              />
              <span class="sr-only">{{
                translate('正在加载项目文件', 'Loading project files')
              }}</span>
            </div>
            <div v-else-if="!refreshing && rows.length === 0" class="px-2 pb-5 pt-4 text-center">
              <img
                src="/empty-project-files.svg"
                alt=""
                class="mx-auto mb-2 h-28 w-40 object-contain"
              />
              <p class="text-xs font-medium text-slate-600">
                {{ translate('这里还没有文档', 'No documents yet') }}
              </p>
              <p class="mt-1 text-[11px] leading-5 text-slate-400">
                {{ translate('新建一篇，开始写作', 'Create one to start writing') }}
              </p>
            </div>
            <button
              v-for="row in rows"
              :key="row.node.path"
              :title="row.node.name"
              :class="[
                'flex w-full items-center gap-1 rounded-md py-1.5 pr-2 text-left text-sm',
                activePath === row.node.path
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'hover:bg-slate-200/70',
              ]"
              :style="{ paddingLeft: `${row.depth * 16 + 8}px` }"
              @click.stop="
                row.node.kind === 'directory'
                  ? expanded.has(row.node.path)
                    ? expanded.delete(row.node.path)
                    : expanded.add(row.node.path)
                  : openDoc(row.node.path)
              "
              @contextmenu.prevent.stop="showContext($event, row.node)"
            >
              <component
                :is="expanded.has(row.node.path) ? ChevronDown : ChevronRight"
                v-if="row.node.kind === 'directory'"
                :size="14"
              /><span v-else class="w-3.5" /><Folder
                v-if="row.node.kind === 'directory'"
                :size="16"
                class="shrink-0"
              /><FileText v-else :size="16" class="shrink-0" /><span
                class="min-w-0 flex-1 truncate"
                >{{ row.node.name }}</span
              ><Bookmark
                v-if="row.node.pinned"
                :size="12"
                fill="currentColor"
                :title="translate('已固定', 'Pinned')"
              /><LockKeyhole
                v-if="row.node.lockSource"
                :size="12"
                :class="row.node.lockSource === row.node.path ? '' : 'opacity-45'"
                :title="
                  row.node.lockSource === row.node.path
                    ? translate('直接锁定', 'Locked directly')
                    : translate(
                        `由 ${row.node.lockSource} 锁定`,
                        `Locked by ${row.node.lockSource}`,
                      )
                "
              />
            </button>
          </div>
          <div class="px-3 py-3">
            <div
              class="flex items-center justify-between px-2 text-xs font-semibold text-slate-500"
            >
              <span>{{ translate('资源库', 'Resources') }}</span>
            </div>
            <button
              class="mt-1 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-200/70"
              :title="translate('展开或收起资源库', 'Expand or collapse resources')"
              :aria-expanded="resourceRootExpanded"
              @click.stop="resourceRootExpanded = !resourceRootExpanded"
            >
              <component :is="resourceRootExpanded ? ChevronDown : ChevronRight" :size="14" />
              <Folder :size="16" class="fill-blue-600 text-blue-600" />
              <span class="min-w-0 flex-1 truncate">resources</span>
              <span class="text-xs text-slate-400">{{ resourceCount }}</span>
            </button>
            <div v-if="resourceRootExpanded">
              <div v-if="resourceRows.length === 0" class="px-4 py-2 text-center">
                <img src="/empty-list.svg" alt="" class="mx-auto mb-1 h-16 w-24" />
                <p class="text-[11px] text-slate-400">
                  {{ translate('还没有资源文件', 'No resource files') }}
                </p>
              </div>
              <div
                v-for="row in resourceRows"
                :key="row.node.path"
                :title="row.node.name"
                class="group flex items-center gap-1 rounded-md py-1 text-sm hover:bg-slate-200/70"
                :style="{ paddingLeft: `${24 + row.depth * 14}px` }"
              >
                <button
                  v-if="row.node.kind === 'directory'"
                  class="flex min-w-0 flex-1 items-center gap-1 text-left"
                  @click.stop="
                    expandedResources.has(row.node.path)
                      ? expandedResources.delete(row.node.path)
                      : expandedResources.add(row.node.path)
                  "
                >
                  <component
                    :is="expandedResources.has(row.node.path) ? ChevronDown : ChevronRight"
                    :size="13"
                  />
                  <Folder :size="15" class="shrink-0 text-blue-600" />
                  <span class="truncate">{{ row.node.name }}</span>
                </button>
                <button
                  v-else
                  class="flex min-w-0 flex-1 items-center gap-1 text-left"
                  :title="
                    translate(
                      `使用系统默认程序打开 ${row.node.name}`,
                      `Open ${row.node.name} with the default app`,
                    )
                  "
                  @click.stop="openResource(row.node.path)"
                >
                  <span class="w-3" />
                  <FileText :size="15" class="shrink-0" />
                  <span class="min-w-0 flex-1 truncate" :title="row.node.localPath">
                    {{ row.node.name }}
                  </span>
                  <span class="pr-2 text-[10px] text-slate-400">{{ row.node.fileType }}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
        <div v-if="project" class="mt-auto space-y-0.5 px-3 pb-4 pt-3">
          <button
            v-for="kind in kinds"
            :key="kind.value"
            class="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-slate-200/70"
            @click.stop="
              annotationFilter = kind.value;
              panel = 'annotations';
            "
          >
            <span class="flex items-center gap-1.5"
              ><i class="h-2 w-2 rounded-full" :style="{ background: kind.color }" />{{
                kindLabel(kind.value)
              }}</span
            ><span>{{ count(kind.value) }}</span>
          </button>
        </div>
      </aside>
      <div class="flex min-w-0 flex-1 flex-col">
        <div
          :class="windowExpanded ? 'gap-0' : 'gap-3 px-4 pb-4'"
          class="relative flex min-h-0 flex-1"
        >
          <div class="flex min-w-0 flex-1">
            <template v-for="(pane, index) in panes" :key="pane.id"
              ><div
                v-if="index === 1"
                v-show="!readingPanel"
                class="group flex w-2 shrink-0 touch-none cursor-col-resize items-center justify-center"
                @pointerdown.prevent="resize"
              >
                <div class="h-10 w-1 rounded bg-slate-300 group-hover:bg-blue-400" />
              </div>
              <section
                v-show="!readingPanel || index === activePane"
                :data-pane-index="index"
                :style="
                  panes.length === 2 && !readingPanel
                    ? { flex: `${index === 0 ? split : 100 - split} 1 0%` }
                    : {}
                "
                class="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-white rounded-2xl"
                @pointerdown="activePane = index"
                @focusin="activePane = index"
                @click.capture="handleEditorClick"
                @mousemove="
                  handleAnnotationHover($event);
                  showTermHover($event, pane);
                "
                @mouseleave="
                  scheduleHideTerm();
                  scheduleHideAnnotationPopover();
                "
              >
                <button
                  v-if="panes.length > 1"
                  class="absolute right-2 top-2 z-20 rounded-md p-1 text-slate-400 hover:bg-slate-100"
                  :title="translate('关闭分栏', 'Close pane')"
                  :aria-label="translate('关闭分栏', 'Close pane')"
                  @click.stop="closePane(index)"
                >
                  <X :size="15" />
                </button>
                <Transition name="document-switch" mode="out-in">
                  <LoadingState
                    v-if="loadingPanes.has(index)"
                    :label="translate('正在打开文档…', 'Opening document…')"
                  />
                  <div
                    v-else-if="pane.path && docs[pane.path]"
                    :key="pane.path"
                    class="flex min-h-0 flex-1 flex-col"
                  >
                    <div
                      class="document-toolbar relative shrink-0 text-sm"
                      :style="panes.length > 1 ? { paddingRight: '40px' } : undefined"
                    >
                      <span
                        :class="[
                          'min-w-0 flex-1 truncate font-medium',
                          index === activePane && panes.length === 2 ? 'text-blue-700' : '',
                        ]"
                        :title="pane.path"
                      >
                        {{ pane.path
                        }}<span
                          v-if="docs[pane.path]?.content !== docs[pane.path]?.savedContent"
                          class="ml-1 text-blue-500"
                          >•</span
                        >
                      </span>
                      <span
                        v-if="lockSource(pane.path)"
                        class="flex shrink-0 items-center gap-1 text-xs text-amber-700"
                        :title="lockSource(pane.path) ?? ''"
                        ><LockKeyhole :size="13" /><span class="hidden xl:inline">{{
                          lockSource(pane.path) === pane.path
                            ? translate('已锁定', 'Locked')
                            : translate(
                                `由 ${lockSource(pane.path)} 锁定`,
                                `Locked by ${lockSource(pane.path)}`,
                              )
                        }}</span></span
                      >
                      <div class="document-actions flex shrink-0 items-center gap-2 text-slate-500">
                        <button
                          class="rounded-md p-1.5 hover:bg-slate-100"
                          :class="pane.outlineOpen ? 'bg-blue-50 text-blue-700' : ''"
                          :title="translate('文档目录', 'Document outline')"
                          :aria-label="translate('文档目录', 'Document outline')"
                          :aria-controls="`vivin-outline-${pane.id}`"
                          :aria-expanded="pane.outlineOpen"
                          @click.stop="toggleOutline(index)"
                        >
                          <ListTree :size="17" />
                        </button>
                        <div
                          class="view-switch"
                          role="group"
                          :aria-label="translate('文档视图', 'Document view')"
                        >
                          <button
                            v-for="mode in ['source', 'rendered'] as const"
                            :key="mode"
                            class="view-switch-button disabled:opacity-40"
                            :class="pane.mode === mode ? 'is-active' : ''"
                            :title="
                              mode === 'source'
                                ? translate('源代码模式', 'Source mode')
                                : translate('视图模式', 'View mode')
                            "
                            :aria-label="
                              mode === 'source'
                                ? translate('源代码模式', 'Source mode')
                                : translate('视图模式', 'View mode')
                            "
                            :aria-pressed="pane.mode === mode"
                            @click.stop="setMode(index, mode)"
                          >
                            <CodeXml v-if="mode === 'source'" :size="14" />
                            <BookOpenText v-else :size="14" />
                            <span>{{
                              mode === 'source'
                                ? translate('源代码', 'Source')
                                : translate('视图', 'View')
                            }}</span>
                          </button>
                        </div>
                        <button
                          class="format-button"
                          :disabled="
                            !!lockSource(pane.path) ||
                            docs[pane.path]?.conflict ||
                            formattingPaths.has(pane.path)
                          "
                          :title="
                            translate(
                              '格式化文档（⌘/Ctrl+Shift+F）',
                              'Format document (⌘/Ctrl+Shift+F)',
                            )
                          "
                          :aria-label="translate('格式化文档', 'Format document')"
                          @click.stop="formatOne(pane.path!, true)"
                        >
                          <LoaderCircle
                            v-if="formattingPaths.has(pane.path)"
                            :size="16"
                            class="animate-spin"
                          /><WandSparkles v-else :size="16" />
                        </button>
                        <button
                          v-if="canUndoFormat(pane.path)"
                          class="format-button"
                          :title="translate('撤销格式化', 'Undo formatting')"
                          :aria-label="translate('撤销格式化', 'Undo formatting')"
                          @click.stop="undoFormat(pane.path!)"
                        >
                          <Undo2 :size="16" />
                        </button>
                        <label
                          class="auto-format-control"
                          :title="
                            translate(
                              '保存时自动格式化，仅处理已修改的文档',
                              'Automatically format changed documents on save',
                            )
                          "
                          @click.stop
                        >
                          <input v-model="autoFormat" type="checkbox" /><span>{{
                            translate('自动格式化', 'Auto format')
                          }}</span>
                        </label>
                      </div>
                    </div>
                    <DocumentFind
                      v-if="pane.findOpen"
                      :key="`${pane.id}:${pane.path}:find`"
                      :ref="
                        (value) => {
                          if (value)
                            findPanels.set(pane.id, value as InstanceType<typeof DocumentFind>);
                          else findPanels.delete(pane.id);
                        }
                      "
                      :content="docs[pane.path]?.content ?? ''"
                      :readonly="!!lockSource(pane.path)"
                      :locale="locale"
                      @highlights="(matches, active) => setSearchHighlights(index, matches, active)"
                      @navigate="navigateFind(index, $event)"
                      @replace="(matches, replacement) => replaceFind(index, matches, replacement)"
                      @close="closeFind(index)"
                    />
                    <div class="flex min-h-0 flex-1">
                      <MarkdownOutlinePanel
                        v-if="pane.outlineOpen"
                        :panel-id="`vivin-outline-${pane.id}`"
                        :markdown="docs[pane.path]?.content ?? ''"
                        :locale="locale"
                        @select="jumpToHeading(index, $event)"
                      />
                      <div class="markdown-canvas flex min-h-0 min-w-0 flex-1">
                        <MarkdownSourceEditor
                          v-if="pane.mode === 'source'"
                          :key="`${pane.id}:${pane.path}:source`"
                          :ref="sourceEditorRef(pane.id)"
                          :model-value="docs[pane.path]?.content ?? ''"
                          :document-path="pane.path"
                          :reveal-request="sourceRevealRequests[index] ?? undefined"
                          :annotations="annotationMarksByDocument[pane.path]"
                          :search-matches="pane.searchMatches"
                          :active-search-offset="pane.activeSearchOffset"
                          :readonly="!!lockSource(pane.path)"
                          :locale="locale"
                          class="min-w-0 flex-1"
                          @update:model-value="setContent(pane.path!, $event)"
                          @error="message = $event"
                          @annotation-request="
                            (kind, selected) => {
                              activePane = index;
                              addAnnotation(kind, selected);
                            }
                          "
                        />
                        <MarkdownRenderedEditor
                          v-else
                          :key="`${pane.id}:${pane.path}:rendered`"
                          :ref="renderedEditorRef(pane.id)"
                          :model-value="docs[pane.path]?.content ?? ''"
                          :document-path="pane.path"
                          :annotations="annotationMarksByDocument[pane.path]"
                          :search-matches="pane.searchMatches"
                          :active-search-offset="pane.activeSearchOffset"
                          :terms="termMarksByDocument[pane.path]"
                          :locale="locale"
                          :readonly="!!lockSource(pane.path)"
                          :theme="theme"
                          class="min-w-0 flex-1"
                          @update:model-value="setContent(pane.path!, $event)"
                          @error="message = $event"
                          @open-reference="openReference(pane.path!, $event)"
                          @annotation-request="
                            (kind: AnnotationKind, selected: { quote: string; offset: number }) =>
                              requestEditorAnnotation(index, kind, selected)
                          "
                          @incompatible="setMode(index, 'source')"
                        />
                      </div>
                      <div class="relative flex w-8 shrink-0 flex-col items-center py-2">
                        <div class="group relative mb-2">
                          <button
                            :title="translate('筛选缩略图标注', 'Filter annotation minimap')"
                            class="rounded p-1 hover:bg-slate-100"
                          >
                            <ChevronDown :size="13" />
                          </button>
                          <div
                            class="absolute right-6 top-0 z-20 hidden w-24 rounded-lg bg-white p-1 text-xs shadow-lg group-hover:block"
                          >
                            <button
                              v-for="kind in kinds"
                              :key="kind.value"
                              class="block w-full rounded px-2 py-1 text-left hover:bg-slate-100"
                              @click.stop="
                                pane.filters = pane.filters.includes(kind.value)
                                  ? pane.filters.filter((value) => value !== kind.value)
                                  : [...pane.filters, kind.value]
                              "
                            >
                              {{ pane.filters.includes(kind.value) ? '✓' : '　' }}
                              {{ kindLabel(kind.value) }}
                            </button>
                          </div>
                        </div>
                        <button
                          v-for="mark in (annotationMarksByDocument[pane.path] ?? []).filter(
                            (item) => pane.filters.includes(item.kind),
                          )"
                          :key="mark.id"
                          :aria-label="`${kindLabel(mark.kind)}: ${mark.quote}`"
                          class="annotation-minimap-mark group absolute left-1 flex h-5 w-6 -translate-y-1/2 items-center justify-center focus-visible:outline-2 focus-visible:outline-blue-500"
                          :style="{
                            top: `${Math.max(12, Math.min(95, (100 * mark.offset) / Math.max(1, docs[pane.path]?.content.length ?? 1)))}%`,
                          }"
                          @click.stop="jumpTo(pane.path, mark.offset, mark.length, mark.id)"
                        >
                          <span
                            class="h-[3px] w-3.5 rounded-full transition-[width] group-hover:w-5 group-focus-visible:w-5"
                            :style="{
                              background: kinds.find((kind) => kind.value === mark.kind)?.color,
                            }"
                          />
                        </button>
                      </div>
                    </div>
                  </div>
                  <div v-else class="flex flex-1 items-center justify-center px-8 text-center">
                    <div class="max-w-xs">
                      <img
                        src="/empty-writing.svg"
                        alt=""
                        class="mx-auto mb-5 h-44 w-60 object-contain"
                      />
                      <h1 class="text-lg font-semibold tracking-tight">
                        {{
                          !project
                            ? translate('开始写作', 'Start writing')
                            : rows.length === 0
                              ? translate('项目里还没有文档', 'No documents in this project')
                              : translate('选择一篇文档', 'Choose a document')
                        }}
                      </h1>
                      <p class="mt-2 text-sm leading-6 text-slate-400">
                        {{
                          !project
                            ? translate(
                                '点击右上角的 +，新建项目或打开已有文件夹。',
                                'Use + at the top right to create a project or open an existing folder.',
                              )
                            : rows.length === 0
                              ? translate(
                                  '新建一篇 Markdown 文档，内容会保存在项目文件夹中。',
                                  'Create a Markdown document. It will be saved in the project folder.',
                                )
                              : translate(
                                  '从左侧项目文件中选择文档，或新建一篇。',
                                  'Choose a document on the left, or create one.',
                                )
                        }}
                      </p>
                      <button
                        v-if="project && rows.length === 0"
                        class="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
                        @click.stop="addDoc()"
                      >
                        {{ translate('新建文档', 'New document') }}
                      </button>
                    </div>
                  </div>
                </Transition>
              </section></template
            >
          </div>
          <div v-if="busy" class="absolute inset-0 z-20 flex bg-[#f3f6fa]/85" aria-busy="true">
            <LoadingState :label="translate('正在打开项目…', 'Opening project…')" />
          </div>
          <aside
            v-if="panel !== 'none' && project"
            :class="[readingPanel ? 'min-w-0 flex-1 ml-2.5' : 'w-80 shrink-0 ml-2.5']"
            class="flex flex-col overflow-hidden bg-white rounded-2xl"
          >
            <div
              :class="readingPanel ? 'h-11 px-6 font-medium' : 'h-12 px-4 font-semibold'"
              class="flex shrink-0 items-center justify-between text-sm"
            >
              <span>{{
                panel === 'search'
                  ? translate('项目搜索', 'Project search')
                  : panel === 'terms'
                    ? translate('项目术语', 'Project terms')
                    : translate('项目标注', 'Project annotations')
              }}</span
              ><button
                class="rounded p-1 hover:bg-slate-100"
                :title="translate('关闭面板', 'Close panel')"
                @click.stop="panel = 'none'"
              >
                <X :size="16" />
              </button>
            </div>
            <div v-if="panel === 'search'" class="min-h-0 overflow-y-auto p-3">
              <form class="flex gap-2" @submit.prevent="runSearch">
                <input
                  v-model="query"
                  autofocus
                  :placeholder="translate('搜索 Markdown 正文', 'Search Markdown content')"
                  class="min-w-0 flex-1 rounded-lg bg-slate-100 px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-200"
                /><button class="rounded bg-blue-600 px-3 text-xs text-white">
                  {{ translate('搜索', 'Search') }}
                </button>
              </form>
              <LoadingState v-if="searching" :label="translate('正在搜索…', 'Searching…')" />
              <EmptyPanel
                v-else-if="!query.trim()"
                :label="
                  translate(
                    '输入关键词，搜索当前项目的 Markdown 文档。',
                    'Enter keywords to search Markdown documents in this project.',
                  )
                "
              />
              <EmptyPanel
                v-else-if="!searchRan"
                :label="
                  translate(
                    '按回车或点击搜索查看结果。',
                    'Press Enter or click Search to see results.',
                  )
                "
              />
              <EmptyPanel
                v-else-if="searchRan && hits.length === 0"
                :label="translate('没有找到匹配的内容。', 'No matching content found.')"
              />
              <button
                v-for="hit in hits"
                :key="`${hit.path}:${hit.offset}`"
                class="mt-3 block w-full rounded-lg p-2 text-left hover:bg-slate-50"
                @click.stop="jumpTo(hit.path, hit.offset, searchedQuery.length)"
              >
                <div class="text-xs font-medium text-blue-600">
                  {{ hit.path }}
                </div>
                <div class="mt-1 line-clamp-2 text-xs text-slate-600">
                  {{ hit.excerpt }}
                </div>
              </button>
            </div>
            <div v-else-if="panel === 'terms'" class="min-h-0 flex-1 overflow-y-auto px-8 py-7">
              <div class="reading-page mx-auto max-w-[860px]">
                <div class="flex flex-wrap items-start justify-between gap-4">
                  <h1>{{ translate('项目术语', 'Project terms') }}</h1>
                  <button
                    class="mt-8 flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-blue-600 hover:bg-blue-50"
                    :title="translate('新建术语', 'New term')"
                    @click.stop="termAction()"
                  >
                    <Plus :size="16" />{{ translate('新建术语', 'New term') }}
                  </button>
                </div>
                <EmptyPanel
                  v-if="data.terms.length === 0"
                  :label="
                    translate(
                      '还没有术语。新建后，在文档中悬停同名词语即可查看解释。',
                      'No terms yet. Create one, then hover over matching words in a document.',
                    )
                  "
                />
                <section
                  v-for="term in data.terms"
                  :id="`term-${term.id}`"
                  :key="term.id"
                  class="group mb-10 scroll-mt-10"
                >
                  <div class="flex items-start justify-between gap-4">
                    <h2 :class="focusedTermId === term.id ? 'text-blue-700' : ''">
                      {{ term.name }}
                    </h2>
                    <div class="flex shrink-0 items-center gap-1 text-slate-500">
                      <button
                        class="rounded-md p-1.5 hover:bg-slate-100"
                        :title="translate('编辑术语', 'Edit term')"
                        :aria-label="translate('编辑术语', 'Edit term')"
                        @click.stop="termAction(term)"
                      >
                        <Pencil :size="15" />
                      </button>
                      <button
                        class="rounded-md p-1.5 text-rose-600 hover:bg-slate-100"
                        :title="translate('删除术语', 'Delete term')"
                        :aria-label="translate('删除术语', 'Delete term')"
                        @click.stop="removeTerm(term.id)"
                      >
                        <Trash2 :size="15" />
                      </button>
                    </div>
                  </div>
                  <p class="mt-3 whitespace-pre-wrap text-base leading-8 text-slate-600">
                    {{ term.definition }}
                  </p>
                  <div
                    v-for="exception in data.termExceptions.filter(
                      (item) => item.termId === term.id,
                    )"
                    :key="exception.id"
                    class="mt-3 text-sm leading-6 text-slate-500"
                  >
                    {{ exception.document }} ·
                    {{ translate('此处已关闭解释', 'Definition hidden here') }}
                    <button
                      class="ml-2 text-blue-600"
                      @click.stop="restoreTermException(exception)"
                    >
                      {{ translate('恢复', 'Restore') }}
                    </button>
                  </div>
                </section>
              </div>
            </div>
            <div v-else-if="panel === 'annotations'" class="min-h-0 overflow-y-auto p-3">
              <div class="mb-3 flex gap-1">
                <button
                  v-for="kind in kinds"
                  :key="kind.value"
                  :class="[
                    'rounded px-2 py-1 text-xs',
                    annotationFilter === kind.value ? 'bg-blue-600 text-white' : 'bg-slate-100',
                  ]"
                  @click.stop="annotationFilter = kind.value"
                >
                  {{ kindLabel(kind.value) }}
                </button>
              </div>
              <EmptyPanel
                v-if="!data.annotations.some((item) => item.kind === annotationFilter)"
                :label="
                  translate(
                    '暂无此类型标注。选中文档内容后可以添加。',
                    'No annotations of this type. Select text in the document to add one.',
                  )
                "
              />
              <button
                v-for="annotation in data.annotations.filter(
                  (item) => item.kind === annotationFilter,
                )"
                :key="annotation.id"
                class="mb-2 block w-full rounded-xl bg-slate-50 p-3 text-left hover:bg-slate-100"
                @click.stop="
                  jumpTo(
                    annotation.document,
                    annotation.offset,
                    annotation.quote.length,
                    annotation.id,
                  )
                "
              >
                <div class="text-xs font-medium text-blue-600">
                  {{ annotation.document }}
                </div>
                <div class="mt-1 line-clamp-2 text-sm">
                  {{ annotation.quote }}
                </div>
                <div class="mt-1 text-xs text-slate-500">
                  {{ annotation.note }}
                </div>
                <div
                  v-if="
                    docs[annotation.document] &&
                    locate(annotation, docs[annotation.document]?.content ?? '') === null
                  "
                  class="mt-1 text-xs text-amber-700"
                >
                  {{ translate('需重新定位', 'Needs relocation') }}
                </div>
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
    <div
      v-if="message"
      class="fixed right-5 bottom-5 z-[90] max-w-sm rounded-xl bg-slate-800 px-4 py-2 text-xs text-white shadow-xl"
      role="status"
    >
      {{ message
      }}<button
        class="ml-3 rounded p-0.5 hover:bg-white/20"
        :title="translate('关闭提示', 'Dismiss message')"
        @click.stop="message = ''"
      >
        <X :size="13" />
      </button>
    </div>
    <div
      v-if="context"
      class="fixed z-50 w-44 rounded-xl bg-white p-1 text-xs shadow-xl"
      :style="{ left: `${contextAt.x}px`, top: `${contextAt.y}px` }"
      @click.stop
    >
      <button
        v-if="context.kind === 'directory'"
        class="block w-full rounded px-2 py-1.5 text-left hover:bg-slate-100"
        @click="
          addDoc(context!.path);
          context = null;
        "
      >
        {{ translate('新建文档', 'New document') }}</button
      ><button
        v-if="context.kind === 'directory'"
        class="block w-full rounded px-2 py-1.5 text-left hover:bg-slate-100"
        @click="
          addDir(context!.path);
          context = null;
        "
      >
        {{ translate('新建目录', 'New folder') }}</button
      ><button
        v-if="context.kind === 'document'"
        class="block w-full rounded px-2 py-1.5 text-left hover:bg-slate-100"
        @click="action('pin')"
      >
        {{
          context.pinned ? translate('取消固定', 'Unpin') : translate('固定文档', 'Pin document')
        }}</button
      ><button
        class="block w-full rounded px-2 py-1.5 text-left hover:bg-slate-100 disabled:opacity-40"
        :disabled="!!context.lockSource && context.lockSource !== context.path"
        @click="action('lock')"
      >
        {{
          context.lockSource === context.path
            ? translate('解锁', 'Unlock')
            : translate('锁定', 'Lock')
        }}</button
      ><button
        class="block w-full rounded px-2 py-1.5 text-left hover:bg-slate-100"
        @click="showInFinder(context!.path)"
      >
        {{ revealLabel }}</button
      ><button
        class="block w-full rounded px-2 py-1.5 text-left hover:bg-slate-100"
        @click="action('rename')"
      >
        {{ translate('重命名', 'Rename') }}</button
      ><button
        class="block w-full rounded px-2 py-1.5 text-left hover:bg-slate-100"
        @click="action('move')"
      >
        {{ translate('移动到…', 'Move to…') }}</button
      ><button
        class="block w-full rounded px-2 py-1.5 text-left text-rose-600 hover:bg-rose-50"
        @click="action('delete')"
      >
        {{ translate('删除', 'Delete') }}
      </button>
    </div>
    <div
      v-if="hoveredTerm"
      id="vivin-term-popover"
      class="fixed z-40 flex max-h-[min(420px,calc(100vh-24px))] w-[420px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-xl bg-white p-3 text-sm shadow-xl"
      :style="{ left: `${hoveredTerm.x}px`, top: `${hoveredTerm.y}px` }"
      @mouseenter="keepTerm"
      @mouseleave="scheduleHideTerm"
      @click.stop
    >
      <div class="shrink-0 break-words font-semibold">{{ hoveredTerm.term.name }}</div>
      <button
        v-if="hoveredTermDetail.source"
        class="mt-1 shrink-0 break-all text-left text-xs leading-5 text-blue-600 hover:underline"
        :title="translate('使用系统默认程序打开原件', 'Open the original with the default app')"
        @click="openResource(hoveredTermDetail.source)"
      >
        {{ translate('打开原件：', 'Open source: ')
        }}{{ hoveredTermDetail.source.split('/').pop() }}
      </button>
      <p
        class="mt-1 min-h-0 flex-auto overflow-x-hidden overflow-y-auto overscroll-contain whitespace-pre-wrap break-words text-xs leading-5 text-slate-600 [overflow-wrap:anywhere]"
      >
        {{ hoveredTermDetail.body }}
      </p>
      <div class="mt-3 flex gap-3 text-xs text-blue-600">
        <button @click.stop="viewTerm(hoveredTerm!.term)">
          {{ translate('查看术语', 'View term') }}
        </button>
        <button v-if="hoveredTerm.offset !== null" @click.stop="disableTermHere">
          {{ translate('关闭此处解释', 'Hide definition here') }}
        </button>
      </div>
    </div>
    <div
      v-if="selectedAnnotation"
      id="vivin-annotation-popover"
      class="fixed z-50 flex w-max flex-col overflow-hidden rounded-lg bg-white text-sm shadow-xl ring-1 ring-slate-200/70"
      :style="{
        left: `${annotationPopoverAt.x}px`,
        top: `${annotationPopoverAt.y}px`,
        width: annotationEditing ? `${annotationEditSize.width}px` : undefined,
        height: annotationEditing ? `${annotationEditSize.height}px` : undefined,
        maxWidth: `${annotationPopoverSize.width}px`,
        maxHeight: `${annotationPopoverSize.height}px`,
      }"
      role="group"
      :aria-label="kindLabel(selectedAnnotation.kind)"
      @mouseenter="keepAnnotationPopover"
      @mouseleave="scheduleHideAnnotationPopover"
      @click.stop
    >
      <div class="flex shrink-0 items-center justify-between gap-3 px-2 pt-1">
        <span
          class="inline-flex items-center gap-1.5 rounded-md bg-slate-50 px-2 py-1 text-xs font-medium text-slate-600"
        >
          <span
            aria-hidden="true"
            class="h-1.5 w-1.5 shrink-0 rounded-full"
            :style="{
              background: kinds.find((kind) => kind.value === selectedAnnotation?.kind)?.color,
            }"
          />
          {{ kindLabel(selectedAnnotation.kind) }}
        </span>
        <div class="flex shrink-0 gap-1">
          <button
            v-if="!annotationEditing"
            class="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"
            :title="translate('编辑说明', 'Edit note')"
            :aria-label="translate('编辑说明', 'Edit note')"
            @click.stop="startAnnotationEdit"
          >
            <Pencil :size="15" />
          </button>
          <button
            class="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
            :title="translate('删除标注', 'Delete annotation')"
            :aria-label="translate('删除标注', 'Delete annotation')"
            @click.stop="removeAnnotation(selectedAnnotation!)"
          >
            <Trash2 :size="15" />
          </button>
        </div>
      </div>
      <div v-if="!annotationEditing" class="min-h-0 overflow-auto">
        <AnnotationMarkdown
          :key="selectedAnnotation.id"
          :markdown="selectedAnnotation.note || translate('无说明', 'No note')"
          :document-path="selectedAnnotation.document"
          :locale="locale"
          :theme="theme"
          @ready="nextTick(positionAnnotationPopover)"
          @open-reference="openReference(selectedAnnotation!.document, $event)"
        />
      </div>
      <div v-else class="flex min-h-0 flex-1 flex-col p-3">
        <textarea
          id="vivin-annotation-note"
          v-model="annotationDraft"
          class="min-h-0 w-full flex-1 resize-none rounded-lg bg-slate-50 p-3 text-sm leading-6 outline-none focus:ring-2 focus:ring-blue-200"
          rows="10"
          :aria-label="translate('标注说明', 'Annotation note')"
          @keydown.esc.stop="annotationEditing = false"
        />
        <div class="mt-2 flex shrink-0 justify-end gap-2 text-xs">
          <button
            class="rounded-md px-2.5 py-1.5 text-slate-500 hover:bg-slate-100"
            @click.stop="annotationEditing = false"
          >
            {{ translate('取消', 'Cancel') }}
          </button>
          <button
            class="rounded-md bg-blue-600 px-2.5 py-1.5 text-white hover:bg-blue-700 disabled:opacity-50"
            :disabled="annotationSaving"
            @click.stop="updateAnnotation(selectedAnnotation!)"
          >
            {{ translate('保存', 'Save') }}
          </button>
        </div>
      </div>
    </div>
    <div
      v-if="termDialog"
      class="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/30"
      @click.stop
    >
      <div
        class="w-[min(520px,calc(100vw-32px))] rounded-2xl bg-white p-5 shadow-2xl"
        role="dialog"
        aria-modal="true"
        :aria-label="translate('编辑项目术语', 'Edit project term')"
      >
        <h2 class="text-base font-semibold">
          {{
            termDialog.id ? translate('编辑术语', 'Edit term') : translate('新建术语', 'New term')
          }}
        </h2>
        <label class="mt-4 block text-sm text-slate-600" for="vivin-term-name">
          {{ translate('术语名称', 'Term name') }}
        </label>
        <input
          id="vivin-term-name"
          v-model="termDialog.name"
          class="mt-1 w-full rounded-lg bg-slate-100 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-200"
          @keydown.esc.stop="termDialog = null"
        />
        <label class="mt-4 block text-sm text-slate-600" for="vivin-term-definition">
          {{ translate('解释', 'Definition') }}
        </label>
        <textarea
          id="vivin-term-definition"
          v-model="termDialog.definition"
          rows="7"
          class="mt-1 w-full resize-y rounded-lg bg-slate-100 px-3 py-2 text-sm leading-6 outline-none focus:ring-2 focus:ring-blue-200"
          @keydown.esc.stop="termDialog = null"
        />
        <div class="mt-5 flex justify-end gap-2 text-sm">
          <button class="rounded-lg px-3 py-1.5 hover:bg-slate-100" @click.stop="termDialog = null">
            {{ translate('取消', 'Cancel') }}
          </button>
          <button
            class="rounded-lg bg-blue-600 px-3 py-1.5 text-white hover:bg-blue-700 disabled:opacity-40"
            :disabled="!termDialog.name.trim()"
            @click.stop="saveTermDialog"
          >
            {{ translate('保存', 'Save') }}
          </button>
        </div>
      </div>
    </div>
    <div
      v-if="dialog"
      class="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/30"
      @click.stop
    >
      <div
        class="w-[min(420px,calc(100vw-32px))] rounded-2xl bg-white p-5 shadow-2xl"
        role="dialog"
        aria-modal="true"
        :aria-label="dialog.title"
      >
        <h2 class="text-base font-semibold">{{ dialog.title }}</h2>
        <input
          v-if="dialog.kind === 'text'"
          id="vivin-dialog-input"
          v-model="dialog.value"
          class="mt-4 w-full rounded-lg bg-slate-100 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-200"
          @keydown.enter.stop="finishDialog(true)"
          @keydown.esc.stop="finishDialog(false)"
        />
        <div class="mt-5 flex justify-end gap-2 text-sm">
          <button
            class="rounded-lg px-3 py-1.5 hover:bg-slate-100"
            @click.stop="finishDialog(false)"
          >
            {{ translate('取消', 'Cancel') }}
          </button>
          <button
            class="rounded-lg bg-blue-600 px-3 py-1.5 text-white hover:bg-blue-700"
            @click.stop="finishDialog(true)"
          >
            {{ translate('确定', 'Confirm') }}
          </button>
        </div>
      </div>
    </div>
    <AppTooltip :locale="locale" />
  </div>
</template>
