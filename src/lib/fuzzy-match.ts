export interface FuzzyResult {
  score: number;
  /** UTF-16 indexes of matched characters in the candidate. */
  positions: number[];
}

function isBoundary(text: string, index: number): boolean {
  if (index === 0) return true;
  const previous = text[index - 1] ?? '';
  return /[\s/\\_.-]/.test(previous) || (/[a-z]/.test(previous) && /[A-Z]/.test(text[index] ?? ''));
}

/** Subsequence match that rewards consecutive runs, word starts and the file name. */
export function fuzzyMatch(query: string, candidate: string): FuzzyResult | null {
  const needle = query.replace(/\s+/g, '').toLowerCase();
  if (!needle) return { score: 0, positions: [] };
  const haystack = candidate.toLowerCase();
  const nameStart = candidate.lastIndexOf('/') + 1;
  const positions: number[] = [];
  let score = 0;
  let from = 0;
  let previous = -2;
  for (const character of needle) {
    let found = haystack.indexOf(character, from);
    if (found < 0) return null;
    // Prefer a later word-start occurrence when the next one is not consecutive.
    if (found !== previous + 1) {
      for (
        let at = found;
        at >= 0 && at < haystack.length;
        at = haystack.indexOf(character, at + 1)
      )
        if (isBoundary(candidate, at)) {
          found = at;
          break;
        }
    }
    score += 1;
    if (found === previous + 1) score += 4;
    if (isBoundary(candidate, found)) score += 3;
    if (found >= nameStart) score += 2;
    positions.push(found);
    previous = found;
    from = found + 1;
  }
  if (haystack.slice(nameStart).startsWith(needle)) score += 10;
  score -= Math.min(10, candidate.length / 20);
  return { score, positions };
}

export interface RankedPath extends FuzzyResult {
  path: string;
}

/** Empty queries list recent documents first; matches get a small recency bonus. */
export function rankPaths(query: string, paths: string[], recent: string[] = []): RankedPath[] {
  const recency = new Map(recent.map((path, index) => [path, recent.length - index]));
  const ranked: RankedPath[] = [];
  for (const path of paths) {
    const match = fuzzyMatch(query, path);
    if (!match) continue;
    ranked.push({ path, ...match, score: match.score + (recency.get(path) ?? 0) * 0.5 });
  }
  return ranked.sort(
    (left, right) =>
      right.score - left.score ||
      (recency.get(right.path) ?? 0) - (recency.get(left.path) ?? 0) ||
      left.path.localeCompare(right.path),
  );
}
