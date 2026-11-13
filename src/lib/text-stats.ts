export interface TextStats {
  /** CJK characters count one each; other scripts count by word. */
  words: number;
  /** Visible non-whitespace characters, counted by code point. */
  characters: number;
  minutes: number;
}

const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const cjkAll = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
const latinWord = /[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu;

/** Removes Markdown syntax that readers do not see, keeping the visible text. */
export function visibleText(markdown: string): string {
  return markdown
    .replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^ {0,3}(?:```|~~~).*$/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*\[[^\]]+\]:\s+\S.*$/gm, '')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/^ {0,3}#{1,6}\s+/gm, '')
    .replace(/^ {0,3}>\s?/gm, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/gm, '')
    .replace(/^ {0,3}(?:[-*_]\s*){3,}$/gm, '')
    .replace(/^\s*\|?(?:\s*:?-+:?\s*\|)+\s*:?-*:?\s*$/gm, '')
    .replace(/[*_~`|]/g, '');
}

export function textStats(markdown: string): TextStats {
  const text = visibleText(markdown);
  const cjkCount = text.match(cjkAll)?.length ?? 0;
  let latinCount = 0;
  for (const match of text.replace(cjkAll, ' ').matchAll(latinWord))
    if (!cjk.test(match[0])) latinCount++;
  let characters = 0;
  for (const character of text) if (!/\s/u.test(character)) characters++;
  const words = cjkCount + latinCount;
  return {
    words,
    characters,
    minutes: words ? Math.max(1, Math.round(cjkCount / 400 + latinCount / 220)) : 0,
  };
}
