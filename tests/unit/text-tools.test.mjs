import assert from 'node:assert/strict';
import test from 'node:test';
import { createTermMatcher, termMarks } from '../../src/features/terms/term-marks.ts';
import {
  defaultPreferences,
  parsePreferences,
  preferenceKeys,
  validFontFamily,
} from '../../src/features/settings/preferences.ts';
import { fuzzyMatch, rankPaths } from '../../src/lib/fuzzy-match.ts';
import { textStats } from '../../src/lib/text-stats.ts';
import {
  parseWorkspaceSession,
  rememberWorkspaceSession,
  sessionLimit,
} from '../../src/lib/workspace-session.ts';

test('word count treats CJK characters and Latin words separately and skips syntax', () => {
  assert.deepEqual(textStats('# 标题\n\n中文 **写作** and English words.\n'), {
    words: 9,
    characters: 22,
    minutes: 1,
  });
  assert.equal(textStats('[链接](https://example.com/very/long)').words, 2);
  assert.equal(textStats('---\ntitle: 元数据\n---\n\n正文').words, 2);
  assert.deepEqual(textStats(''), { words: 0, characters: 0, minutes: 0 });
});

test('quick open prefers file-name and word-start matches, then recent files', () => {
  assert.equal(fuzzyMatch('xyz', 'notes/plan.md'), null);
  const ranked = rankPaths('plan', ['archive/planning-old.md', 'notes/plan.md', 'pl/a/n.md']);
  assert.equal(ranked[0].path, 'notes/plan.md');
  assert.deepEqual(
    rankPaths('', ['a.md', 'b.md', 'c.md'], ['c.md', 'b.md']).map((item) => item.path),
    ['c.md', 'b.md', 'a.md'],
  );
});

test('longer terms win and disabled occurrences are skipped', () => {
  const terms = [
    { id: 'plan', name: '计划', definition: '' },
    { id: 'buy', name: '采购计划', definition: '' },
  ];
  const content = '采购计划和计划。计划';
  const exceptions = [
    {
      id: 'x',
      document: 'a.md',
      termId: 'plan',
      offset: 8,
      contextBefore: '采购计划和计划。',
      contextAfter: '',
    },
  ];
  assert.deepEqual(
    termMarks(content, 'a.md', createTermMatcher(terms), terms, exceptions)
      .map((mark) => [mark.id, mark.offset])
      .sort((a, b) => a[1] - b[1]),
    [
      ['buy', 0],
      ['plan', 5],
    ],
  );
});

test('stored preferences are validated one by one', () => {
  const stored = {
    [preferenceKeys.locale]: 'en',
    [preferenceKeys.appearance]: 'purple',
    [preferenceKeys.documentTheme]: 'nord',
    [preferenceKeys.sidebarWidth]: 'wide',
    [preferenceKeys.fontSize]: 18,
    [preferenceKeys.fontFamily]: 'Songti SC',
    [preferenceKeys.lineHeight]: 'tall',
    [preferenceKeys.selectionColor]: '#FACC15',
    [preferenceKeys.newPaneMode]: 'source',
    [preferenceKeys.formatOnSave]: false,
    [preferenceKeys.indentWidth]: 3,
    [preferenceKeys.statusItems]: ['readingTime', 'unknown', 'words'],
  };
  assert.deepEqual(
    parsePreferences((key) => stored[key] ?? null),
    {
      ...defaultPreferences,
      locale: 'en',
      documentTheme: 'nord',
      fontSize: 18,
      fontFamily: 'Songti SC',
      selectionColor: '#facc15',
      newPaneMode: 'source',
      formatOnSave: false,
      statusItems: ['words', 'readingTime'],
    },
  );
});

test('the old percentage text size maps to the nearest pixel size', () => {
  const read = (scale) => (key) => (key === 'vivin.editor-scale' ? scale : null);
  assert.equal(parsePreferences(read(1)).fontSize, 16);
  assert.equal(parsePreferences(read(1.1)).fontSize, 18);
  assert.equal(parsePreferences(read(1.3)).fontSize, 20);
  assert.equal(parsePreferences(read('big')).fontSize, 16);
});

test('annotation colors keep valid hex values and ignore the rest', () => {
  const parsed = parsePreferences((key) =>
    key === preferenceKeys.annotationColors
      ? { todo: '#ABCDEF', comment: 'red', question: '#123', error: '#112233' }
      : null,
  );
  assert.deepEqual(parsed.annotationColors, {
    ...defaultPreferences.annotationColors,
    todo: '#abcdef',
    error: '#112233',
  });
});

test('font family names that could escape the CSS value are refused', () => {
  assert.equal(validFontFamily('PingFang SC'), true);
  assert.equal(validFontFamily('宋体-简'), true);
  for (const name of ['', 'A"; color: red', "x'y", 'a{b}', 'a\\b', 'a\nb', 'x'.repeat(121)])
    assert.equal(validFontFamily(name), false, JSON.stringify(name));
  assert.equal(
    parsePreferences((key) => (key === 'vivin.editor-font-family' ? 'Bad;font' : null)).fontFamily,
    '',
  );
});

test('reading time follows the configured pace', () => {
  const text = '字'.repeat(1200);
  assert.equal(textStats(text).minutes, 3);
  assert.equal(textStats(text, 300).minutes, 4);
  assert.equal(textStats(text, 600).minutes, 2);
});

test('workspace sessions are validated and capped per project', () => {
  assert.deepEqual(
    parseWorkspaceSession({
      panes: [
        { path: 'a.md', mode: 'source' },
        { path: null, mode: 'odd' },
        { path: 'c.md', mode: 'rendered' },
      ],
      active: 9,
      split: 90,
    }),
    {
      panes: [
        { path: 'a.md', mode: 'source' },
        { path: null, mode: 'rendered' },
      ],
      active: 1,
      split: 75,
    },
  );
  assert.equal(parseWorkspaceSession({ panes: [{ path: 3 }] }), null);
  assert.equal(parseWorkspaceSession({ panes: [] }), null);

  const session = { panes: [{ path: 'a.md', mode: 'rendered' }], active: 0, split: 50 };
  const store = Object.fromEntries(
    Array.from({ length: sessionLimit + 3 }, (_, index) => [`/p${index}`, session]),
  );
  store['/broken'] = { panes: 'x' };
  const next = rememberWorkspaceSession(store, '/p5', { ...session, split: 40 });
  assert.equal(Object.keys(next)[0], '/p5');
  assert.equal(next['/p5'].split, 40);
  assert.equal(Object.keys(next).length, sessionLimit);
  assert.equal('/broken' in next, false);
});
