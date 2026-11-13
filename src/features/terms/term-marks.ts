import { resolveAnnotation } from '../../lib/annotation-anchor.ts';
import type { Term, TermException } from '../../lib/project-api';
import { createTextMatcher } from '../../lib/text-matcher.ts';

export interface TermMark {
  id: string;
  offset: number;
  quote: string;
}

export type TermMatcher = ReturnType<typeof createTermMatcher>;

/** Longer names win over names they contain. */
export function createTermMatcher(terms: Term[]) {
  const ordered = [...terms].sort((a, b) => b.name.length - a.name.length);
  return createTextMatcher(
    ordered.map((term, priority) => ({ text: term.name, value: { term, priority } })),
  );
}

/** Non-overlapping term occurrences, skipping places the user disabled. */
export function termMarks(
  content: string,
  document: string,
  matcher: TermMatcher,
  terms: Term[],
  exceptions: TermException[],
): TermMark[] {
  const ignored = new Set<string>();
  for (const exception of exceptions) {
    if (exception.document !== document) continue;
    const term = terms.find((item) => item.id === exception.termId);
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
  const marks: TermMark[] = [];
  const candidates = matcher(content).sort(
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
