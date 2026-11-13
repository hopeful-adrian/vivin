import assert from 'node:assert/strict';
import test from 'node:test';
import { createTermMatcher, termMarks } from '../../src/features/terms/term-marks.ts';
import { parsePreferences, preferenceKeys } from '../../src/features/settings/preferences.ts';
import { fuzzyMatch, rankPaths } from '../../src/lib/fuzzy-match.ts';
import { textStats } from '../../src/lib/text-stats.ts';

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
    [preferenceKeys.autoFormat]: false,
    [preferenceKeys.sidebarWidth]: 'wide',
    [preferenceKeys.editorScale]: 1.2,
    [preferenceKeys.newPaneMode]: 'source',
  };
  assert.deepEqual(
    parsePreferences((key) => stored[key] ?? null),
    {
      locale: 'en',
      appearance: 'light',
      documentTheme: 'nord',
      autoFormat: false,
      sidebarWidth: 256,
      editorScale: 1.2,
      newPaneMode: 'source',
      checkUpdates: true,
    },
  );
});
