import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';

// Isolated in-memory native boundary for repeatable UI regression checks.
// No user files or credentials are read; all changes disappear on reload.
window.isTauri = true;
if (!new URLSearchParams(location.search).has('restore'))
  localStorage.setItem('vivin.last-project', JSON.stringify('/fixture'));
localStorage.setItem('vivin.locale', JSON.stringify('zh'));
localStorage.setItem('vivin.theme', JSON.stringify('light'));
localStorage.setItem('vivin.auto-format', 'false');
const quote = '批注锚点';
const markdown = `# 编辑器验收\n\n${quote} 和普通正文。\n\n## 第二节\n\n可以直接编辑 **粗体** 和列表。\n\n- 第一项\n- 第二项\n\n`;
const originals = {
  '普通.md':
    markdown +
    Array.from(
      { length: 40 },
      (_, i) => `## 第 ${i + 3} 节\n\n段落内容，用于滚动位置回归。\n\n`,
    ).join(''),
  '锁定.md': '# 锁定文件\n\n锁定正文 cat cat。\n',
  '术语匹配.md':
    Array.from({ length: 6 }, (_, index) => `${'#'.repeat(index + 1)} 采购计划\n\n`).join('') +
    '采购计划\n========\n\n采购计划\n--------\n\n> # 采购计划\n\n正文中的采购计划应显示解释，**采购计划**也应匹配。\n\n' +
    '| 采购计划 | 状态 |\n| --- | --- |\n| 采购计划 | 草稿 |\n',
  '定位回归.md':
    '[重复](重复)\n\n重复\n\n跨段\n\n锚点\n\n```mermaid\nflowchart LR\n  A[开始] --> B[结束]\n```\n',
  '特殊语法.md':
    '---\ntitle: 特殊语法\n---\n\n# 保留语法\n\n正文 **可以编辑**。\n\n<div>原始 HTML</div>\n\n[参考链接][ref] 与脚注[^note]。\n\n[ref]: https://example.com\n\n[^note]: 脚注正文\n',
  '长文.md':
    '# 长文验收\n\n' +
    Array.from(
      { length: 500 },
      (_, i) => `## 长文 ${i}\n\n${'可直接编辑的长文内容。'.repeat(20)}\n\n`,
    ).join(''),
};
const documents = structuredClone(originals);
let data = {
  schemaVersion: 1,
  pinned: [],
  locked: ['锁定.md'],
  terms: [{ id: 'procurement', name: '采购计划', definition: '项目采购计划术语解释。' }],
  termExceptions: [],
  annotations: [
    {
      id: 'question-1',
      document: '普通.md',
      kind: 'question',
      quote: '普通正文',
      offset: markdown.indexOf('普通正文'),
      contextBefore: ' 和',
      contextAfter: '。',
      note: '这是一条简短的疑问说明。',
    },
    ...['重复', '跨段\n\n锚点'].map((anchorQuote, index) => ({
      id: `navigation-${index}`,
      document: '定位回归.md',
      kind: 'comment',
      quote: anchorQuote,
      offset: originals['定位回归.md'].lastIndexOf(anchorQuote),
      contextBefore: originals['定位回归.md'].slice(
        0,
        originals['定位回归.md'].lastIndexOf(anchorQuote),
      ),
      contextAfter: originals['定位回归.md'].slice(
        originals['定位回归.md'].lastIndexOf(anchorQuote) + anchorQuote.length,
      ),
      note: '定位回归',
    })),
    {
      id: 'note-1',
      document: '普通.md',
      kind: 'comment',
      quote,
      offset: markdown.indexOf(quote),
      contextBefore: '\n\n',
      contextAfter: ' 和普通正文。',
      note:
        '# Markdown 批注\n\n这是 **粗体** 与 `代码`。\n\n- 一条列表\n\n<script>alert("unsafe")</script>\n\n' +
        '更多说明。\n\n'.repeat(80),
    },
  ],
};
const saved = new Map();
let revision = 1;
const result = document.getElementById('result');
const report = (message) => {
  result.textContent = message;
};
window.addEventListener('error', (event) => report(`ERROR: ${event.message}`));
window.addEventListener('unhandledrejection', (event) => report(`ERROR: ${String(event.reason)}`));
mockWindows('main');
mockIPC(
  (command, args) => {
    if (command === 'get_platform')
      return new URLSearchParams(location.search).get('platform') ?? 'macos';
    if (command === 'plugin:dialog|open') return '/fixture-other';
    if (command === 'open_project')
      return {
        name: args.path === '/fixture-other' ? '另一个验收项目' : '验收项目',
        path: args.path,
      };
    if (command === 'list_project_tree')
      return Object.keys(documents).map((path) => ({
        name: path,
        path,
        kind: 'document',
        children: [],
        pinned: false,
        lockSource: data.locked.includes(path) ? path : null,
      }));
    if (command === 'list_resources') return [];
    if (command === 'get_project_data') return structuredClone(data);
    if (command === 'search_documents') {
      const term = args.query.trim();
      return term
        ? Object.entries(documents).flatMap(([path, text]) => {
            const hits = [];
            let from = 0;
            while (from < text.length) {
              const offset = text.indexOf(term, from);
              if (offset < 0) break;
              hits.push({
                path,
                offset,
                excerpt: text.slice(Math.max(0, offset - 40), offset + term.length + 40),
              });
              from = offset + term.length;
            }
            return hits;
          })
        : [];
    }
    if (command === 'read_document' || command === 'reload_document')
      return { path: args.path, content: documents[args.path], revision: String(revision) };
    if (command === 'read_document_revision') return String(revision);
    if (command === 'save_document') {
      if (args.expectedRevision !== String(revision)) throw new Error('文档已被其他操作修改');
      documents[args.path] = args.content;
      saved.set(args.path, args.content);
      return { path: args.path, content: args.content, revision: String(revision) };
    }
    if (command === 'upsert_annotation') {
      data.annotations = data.annotations.map((item) =>
        item.id === args.annotation.id ? args.annotation : item,
      );
      return args.annotation;
    }
    if (command === 'delete_annotation') {
      data.annotations = data.annotations.filter((item) => item.id !== args.id);
      return;
    }
    if (command === 'publish_draft') return String(revision);
    if (command === 'set_dirty_draft' || command === 'reveal_project_entry') return;
    if (command.startsWith('plugin:window|is_')) return false;
    if (command.startsWith('plugin:')) return;
    throw new Error(`Unexpected command: ${command}`);
  },
  { shouldMockEvents: true },
);
await import('../../src/main.ts');
let snapshot;
document.getElementById('capture').onclick = () => {
  const editor = Array.from(
    document.querySelectorAll('.rendered-editor, .source-editor .cm-editor'),
  ).at(-1);
  const selection = getSelection();
  snapshot = {
    editor,
    top: editor?.scrollTop,
    anchor: selection?.anchorNode,
    offset: selection?.anchorOffset,
  };
  report(`记录 scroll=${snapshot.top}`);
};
document.getElementById('verify').onclick = () => {
  const editor = Array.from(
    document.querySelectorAll('.rendered-editor, .source-editor .cm-editor'),
  ).at(-1);
  const selection = getSelection();
  report(
    `保留: instance=${snapshot?.editor === editor}, scroll=${Math.abs((snapshot?.top ?? 0) - (editor?.scrollTop ?? 0)) < 2}, selection=${snapshot?.anchor === selection?.anchorNode && snapshot?.offset === selection?.anchorOffset}, top=${editor?.scrollTop}`,
  );
};
document.getElementById('disk').onclick = () => {
  documents['普通.md'] = '# 磁盘自动加载成功\n\n磁盘新内容。\n';
  revision++;
  report('等待自动加载磁盘内容');
};
document.getElementById('saved').onclick = () => {
  const text = saved.get('特殊语法.md') ?? '';
  report(
    `保存: ${JSON.stringify(Object.fromEntries(saved))}; 特殊语法保留=${['title: 特殊语法', '<div>原始 HTML</div>', '[参考链接][ref]', '[^note]: 脚注正文', '[ref]: https://example.com'].every((part) => text.includes(part))}`,
  );
};
document.getElementById('size').onclick = () => {
  const card = document.querySelector('#vivin-annotation-popover')?.getBoundingClientRect();
  const canvas = document.querySelector('.markdown-canvas')?.getBoundingClientRect();
  report(
    card && canvas
      ? `尺寸合格=${card.width <= (canvas.width * 2) / 3 + 1 && card.height <= (canvas.height * 2) / 3 + 1}; card=${Math.round(card.width)}x${Math.round(card.height)} canvas=${Math.round(canvas.width)}x${Math.round(canvas.height)}`
      : '请先悬停批注',
  );
};
