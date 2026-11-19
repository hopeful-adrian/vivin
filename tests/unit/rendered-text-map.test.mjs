import assert from 'node:assert/strict';
import test from 'node:test';
import { renderedTextMap, sourceSliceForPositions } from '../../src/lib/rendered-text-map.ts';

test('a rendered selection of a repeated word keeps the later source offset', () => {
  const source = '见[文档](文档.md)\n\n文档说明';
  const runs = [
    { text: '见', position: 1 },
    { text: '文档', position: 2 },
    { text: '文档说明', position: 8 },
  ];
  const mapping = renderedTextMap(source, runs);
  const offset = source.lastIndexOf('文档');
  assert.ok(offset > source.indexOf('文档'));
  const from = mapping.get(offset);
  const next = mapping.get(offset + 1);
  assert.equal(typeof from, 'number');
  assert.equal(typeof next, 'number');
  const selected = sourceSliceForPositions(source, mapping, from, next + 1);
  assert.deepEqual(selected, { quote: '文档', offset });
  assert.equal(source.slice(selected.offset, selected.offset + selected.quote.length), '文档');
});

test('a selection across emphasis stores the verbatim source slice', () => {
  const source = '甲**乙**丙';
  const runs = [
    { text: '甲', position: 1 },
    { text: '乙', position: 2 },
    { text: '丙', position: 3 },
  ];
  const mapping = renderedTextMap(source, runs);
  const from = mapping.get(0);
  const last = mapping.get(source.length - 1);
  assert.equal(typeof from, 'number');
  assert.equal(typeof last, 'number');
  assert.deepEqual(sourceSliceForPositions(source, mapping, from, last + 1), {
    quote: source,
    offset: 0,
  });
});

test('the link label is not confused with the same word in the url', () => {
  const source = '见[文档](文档.md)\n\n文档说明';
  const runs = [
    { text: '见', position: 1 },
    { text: '文档', position: 2 },
    { text: '文档说明', position: 8 },
  ];
  const mapping = renderedTextMap(source, runs);
  const offset = source.indexOf('文档');
  const from = mapping.get(offset);
  const next = mapping.get(offset + 1);
  assert.deepEqual(sourceSliceForPositions(source, mapping, from, next + 1), {
    quote: '文档',
    offset,
  });
});
