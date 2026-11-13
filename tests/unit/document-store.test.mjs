import assert from 'node:assert/strict';
import test from 'node:test';
import { createDocumentStore } from '../../src/features/documents/document-store.ts';
import { AppError } from '../../src/lib/app-error.ts';

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

function fakeDisk(files) {
  const disk = new Map(Object.entries(files).map(([path, content]) => [path, content]));
  const revisions = new Map([...disk.keys()].map((path) => [path, 1]));
  const calls = { saves: [], copies: [] };
  const read = (path) => ({
    path,
    content: disk.get(path),
    revision: String(revisions.get(path)),
  });
  const api = {
    readDocument: async (path) => read(path),
    reloadDocument: async (path) => read(path),
    async saveDocument(document, snapshot) {
      calls.saves.push({ ...document, snapshot });
      if (String(revisions.get(document.path)) !== document.revision)
        throw new AppError('revision_conflict', '文档已被其他操作修改');
      disk.set(document.path, document.content);
      revisions.set(document.path, revisions.get(document.path) + 1);
      return read(document.path);
    },
    publishDraft: async () => '',
    readDocumentRevisions: async (paths) =>
      Object.fromEntries(paths.map((path) => [path, String(revisions.get(path))])),
    async saveConflictCopy(path, content, label) {
      const copy = path.replace(/\.md$/, `（${label}）.md`);
      calls.copies.push({ path: copy, content });
      disk.set(copy, content);
      revisions.set(copy, 1);
      return read(copy);
    },
    setDirtyDraft: async () => {},
  };
  const externalWrite = (path, content) => {
    disk.set(path, content);
    revisions.set(path, revisions.get(path) + 1);
  };
  return { api, disk, calls, externalWrite };
}

function storeFor(fake, overrides = {}) {
  const events = { copies: [], errors: [], copyFailures: [] };
  const store = createDocumentStore({
    api: fake.api,
    publishDrafts: false,
    isLocked: () => false,
    autoFormat: () => false,
    format: async (content) => content.trim() + '\n',
    conflictLabel: () => '冲突副本',
    onConflictCopy: (copy, source) => events.copies.push({ copy: copy.path, source }),
    onConflictCopyFailed: (path, error) => events.copyFailures.push({ path, error }),
    onError: (error) => events.errors.push(error),
    delays: { marks: 0, draft: 0, save: 1 },
    ...overrides,
  });
  return { store, events };
}

test('edits are saved against the revision they were based on', async () => {
  const fake = fakeDisk({ 'a.md': '# A\n' });
  const { store } = storeFor(fake);
  await store.open('a.md');
  store.setContent('a.md', '# A\n\n新内容\n');
  assert.equal(store.saveState('a.md'), 'unsaved');
  await store.saveAll();
  assert.equal(fake.disk.get('a.md'), '# A\n\n新内容\n');
  assert.equal(fake.calls.saves[0].revision, '1');
  assert.equal(store.saveState('a.md'), 'saved');
  assert.equal(store.dirty.value, false);
});

test('panes opening the same document share one state and read it once', async () => {
  const fake = fakeDisk({ 'a.md': 'A' });
  let reads = 0;
  const api = { ...fake.api, readDocument: async (path) => (reads++, fake.api.readDocument(path)) };
  const { store } = storeFor({ ...fake, api });
  const [left, right] = [await store.open('a.md'), await store.open('a.md')];
  assert.equal(left, right);
  assert.equal(reads, 1);
});

test('locked documents ignore edits', async () => {
  const fake = fakeDisk({ 'locked.md': 'L' });
  const { store } = storeFor(fake, { isLocked: (path) => path === 'locked.md' });
  await store.open('locked.md');
  store.setContent('locked.md', 'changed');
  await store.saveAll();
  assert.equal(store.docs.value['locked.md'].content, 'L');
  assert.equal(fake.calls.saves.length, 0);
});

test('an external change to a clean document reloads it without a conflict copy', async () => {
  const fake = fakeDisk({ 'a.md': 'old' });
  const { store, events } = storeFor(fake);
  await store.open('a.md');
  fake.externalWrite('a.md', 'from disk');
  await store.checkRevisions(['a.md']);
  assert.equal(store.docs.value['a.md'].content, 'from disk');
  assert.deepEqual(events.copies, []);
});

test('an external change keeps unsaved edits in a conflict copy and loads the disk version', async () => {
  const fake = fakeDisk({ 'notes/a.md': 'base' });
  const { store, events } = storeFor(fake);
  await store.open('notes/a.md');
  store.setContent('notes/a.md', 'my unsaved edit');
  fake.externalWrite('notes/a.md', 'external edit');
  await store.checkRevisions();
  assert.equal(store.docs.value['notes/a.md'].content, 'external edit');
  assert.equal(store.saveState('notes/a.md'), 'saved');
  assert.deepEqual(fake.calls.copies, [
    { path: 'notes/a（冲突副本）.md', content: 'my unsaved edit' },
  ]);
  assert.deepEqual(events.copies, [{ copy: 'notes/a（冲突副本）.md', source: 'notes/a.md' }]);
});

test('a save that hits a revision conflict preserves the local text as a copy', async () => {
  const fake = fakeDisk({ 'a.md': 'base' });
  const { store, events } = storeFor(fake);
  await store.open('a.md');
  fake.externalWrite('a.md', 'external');
  store.setContent('a.md', 'mine');
  await store.saveAll();
  assert.equal(fake.disk.get('a.md'), 'external');
  assert.equal(fake.calls.copies[0].content, 'mine');
  assert.equal(store.docs.value['a.md'].content, 'external');
  assert.equal(events.errors.length, 0);
});

test('when the conflict copy fails the edits stay in the editor on the new revision', async () => {
  const fake = fakeDisk({ 'a.md': 'base' });
  const api = {
    ...fake.api,
    saveConflictCopy: async () => {
      throw new AppError('io', '磁盘已满');
    },
  };
  const { store, events } = storeFor({ ...fake, api });
  await store.open('a.md');
  store.setContent('a.md', 'mine');
  fake.externalWrite('a.md', 'external');
  await store.checkRevisions();
  const doc = store.docs.value['a.md'];
  assert.equal(doc.content, 'mine');
  assert.equal(doc.savedContent, 'external');
  assert.equal(doc.revision, '2');
  assert.equal(events.copyFailures.length, 1);
});

test('save failures other than conflicts are reported and marked for retry', async () => {
  const fake = fakeDisk({ 'a.md': 'base' });
  const api = {
    ...fake.api,
    saveDocument: async () => {
      throw new AppError('io', '无法写入');
    },
  };
  const { store, events } = storeFor({ ...fake, api });
  await store.open('a.md');
  store.setContent('a.md', 'mine');
  await store.saveAll();
  assert.equal(store.saveState('a.md'), 'failed');
  assert.equal(store.docs.value['a.md'].content, 'mine');
  assert.equal(events.errors[0].code, 'io');
});

test('manual formatting can be undone and requests a history snapshot', async () => {
  const fake = fakeDisk({ 'a.md': '  # A  ' });
  const { store } = storeFor(fake);
  await store.open('a.md');
  assert.equal(await store.formatOne('a.md', true), 'formatted');
  assert.equal(store.docs.value['a.md'].content, '# A\n');
  assert.equal(store.canUndoFormat('a.md'), true);
  await store.saveAll();
  assert.equal(fake.calls.saves.at(-1).snapshot, 'format');
  assert.equal(store.undoFormat('a.md'), true);
  assert.equal(store.docs.value['a.md'].content, '  # A  ');
});

test('restoring a version saves it with a forced history snapshot', async () => {
  const fake = fakeDisk({ 'a.md': 'current' });
  const { store } = storeFor(fake);
  await store.open('a.md');
  assert.equal(await store.restoreVersion('a.md', 'older'), true);
  assert.equal(fake.disk.get('a.md'), 'older');
  assert.equal(fake.calls.saves.at(-1).snapshot, 'restore');
});

test('moving a folder keeps open documents and their unsaved edits', async () => {
  const fake = fakeDisk({ 'notes/a.md': 'A' });
  const { store } = storeFor(fake);
  const doc = await store.open('notes/a.md');
  store.setContent('notes/a.md', 'edited');
  store.remapPaths('notes', 'archive/notes');
  assert.equal(store.docs.value['notes/a.md'], undefined);
  assert.equal(store.docs.value['archive/notes/a.md'], doc);
  assert.equal(doc.path, 'archive/notes/a.md');
  assert.equal(doc.content, 'edited');
  store.dropPaths('archive');
  assert.deepEqual(Object.keys(store.docs.value), []);
  await tick();
});
