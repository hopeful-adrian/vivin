import { decodeNamedCharacterReference } from 'decode-named-character-reference';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { preserveMarkdownBlocks, type MarkdownNode } from './markdown-preserve.ts';

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

export interface RenderedTextRun {
  text: string;
  position: number;
  atomic?: boolean;
}

/** Map visible characters to Markdown offsets; syntax stays outside text highlights. */
export function renderedTextMap(source: string, runs: RenderedTextRun[]): Map<number, number> {
  const raw = runs[0];
  if (runs.length === 1 && raw?.text === source) {
    return new Map(
      Array.from({ length: source.length }, (_, index) => [index, raw.position + index]),
    );
  }
  const tree: MarkdownNode = parser.parse(source);
  preserveMarkdownBlocks(tree, source);
  const visible = runs.map((run) => run.text).join('');
  const positions = runs.flatMap((run) =>
    Array.from({ length: run.text.length }, (_, index) => run.position + (run.atomic ? 0 : index)),
  );
  const mapping = new Map<number, number>();
  let visibleFrom = 0;
  let sourceFrom = 0;
  const visit = (node: MarkdownNode) => {
    if (node.children) {
      node.children.forEach(visit);
      return;
    }
    if (!node.value || node.type === 'definition') return;
    const at = visible.indexOf(node.value, visibleFrom);
    if (at < 0) return;
    let from = node.position?.start.offset ?? sourceFrom;
    const end = node.position?.end.offset ?? source.length;
    if (node.type === 'code') {
      from +=
        source.slice(from, end).match(/^ {0,3}(?:`{3,}|~{3,})[^\r\n]*(?:\r?\n|$)/)?.[0].length ?? 0;
    }
    const exact = source.indexOf(node.value, from);
    if (exact >= from && exact + node.value.length <= end) {
      for (let index = 0; index < node.value.length; index++) {
        const position = positions[at + index];
        if (position !== undefined) mapping.set(exact + index, position);
      }
    } else {
      let index = 0;
      while (from < end && index < node.value.length) {
        const remaining = source.slice(from, end);
        const entity =
          node.type === 'text' ? remaining.match(/^&(#x[\da-f]+|#\d+|[\da-z]+);/i) : null;
        let decoded: string | undefined;
        if (entity?.[1]) {
          const name = entity[1];
          if (name.startsWith('#')) {
            const point =
              name[1]?.toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
            decoded = point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '\ufffd';
          } else decoded = decodeNamedCharacterReference(name) || undefined;
        }
        const escaped =
          node.type === 'text' && /^\\[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/.test(remaining);
        const value = decoded ?? (escaped ? source[from + 1] : source[from]) ?? '';
        const width = decoded && entity ? entity[0].length : escaped ? 2 : 1;
        if (node.value.startsWith(value, index)) {
          for (let unit = 0; unit < width; unit++) {
            const position = positions[at + index + Math.min(unit, value.length - 1)];
            if (position !== undefined) mapping.set(from + unit, position);
          }
          index += value.length;
        }
        from += width;
      }
    }
    sourceFrom = end;
    visibleFrom = at + node.value.length;
  };
  visit(tree);
  return mapping;
}

export function renderedRanges(
  mapping: Map<number, number>,
  offset: number,
  length: number,
): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  for (let index = offset; index < offset + length; index++) {
    const position = mapping.get(index);
    if (position === undefined) continue;
    const last = ranges[ranges.length - 1];
    if (last && position >= last.from && position < last.to) continue;
    if (last?.to === position) last.to++;
    else ranges.push({ from: position, to: position + 1 });
  }
  return ranges;
}

/** Source slice covered by a rendered selection. Positions are editor positions. */
export function sourceSliceForPositions(
  source: string,
  mapping: Map<number, number>,
  from: number,
  to: number,
): { quote: string; offset: number } | null {
  if (to <= from) return null;
  const hits: number[] = [];
  for (const [offset, position] of mapping) {
    if (position >= from && position < to) hits.push(offset);
  }
  if (!hits.length) return null;
  hits.sort((left, right) => left - right);
  const start = hits[0];
  const last = hits[hits.length - 1];
  if (start === undefined || last === undefined) return null;
  const end = last + 1;
  for (let index = start; index < end; index++) {
    const position = mapping.get(index);
    if (position !== undefined && (position < from || position >= to)) return null;
  }
  const quote = source.slice(start, end);
  return quote ? { quote, offset: start } : null;
}

export function nearestRenderedPosition(
  mapping: Map<number, number>,
  offset: number,
): number | undefined {
  let position: number | undefined;
  let distance = Infinity;
  for (const [raw, rendered] of mapping) {
    if (Math.abs(raw - offset) < distance) {
      position = rendered;
      distance = Math.abs(raw - offset);
    }
  }
  return position;
}
