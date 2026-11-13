import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRecentProjects, rememberRecentProject } from '../src/lib/recent-projects.ts';

test('recent projects survive serialization and reopening refreshes the name and order', () => {
  let projects = rememberRecentProject([], { name: '项目甲', path: '/work/a' });
  projects = rememberRecentProject(projects, { name: '项目乙', path: '/work/b' });
  projects = parseRecentProjects(JSON.parse(JSON.stringify(projects)));
  assert.deepEqual(rememberRecentProject(projects, { name: '项目甲新名称', path: '/work/a' }), [
    { name: '项目甲新名称', path: '/work/a' },
    { name: '项目乙', path: '/work/b' },
  ]);
});

test('invalid stored records are ignored without losing valid projects or merging equal names', () => {
  assert.deepEqual(parseRecentProjects({ path: '/not-an-array' }), []);
  assert.deepEqual(
    parseRecentProjects([
      null,
      {},
      { name: ' ', path: '/work/empty' },
      { name: '无路径', path: 1 },
      { name: '同名项目', path: '/work/a' },
      { name: '重复路径', path: '/work/a' },
      { name: '同名项目', path: '/work/b' },
    ]),
    [
      { name: '同名项目', path: '/work/a' },
      { name: '同名项目', path: '/work/b' },
    ],
  );
});

test('the history retains the twelve most recently opened paths', () => {
  let projects = [];
  for (let index = 0; index < 15; index++)
    projects = rememberRecentProject(projects, { name: `项目 ${index}`, path: `/work/${index}` });
  assert.equal(projects.length, 12);
  assert.equal(projects[0].path, '/work/14');
  assert.equal(projects.at(-1).path, '/work/3');
});
