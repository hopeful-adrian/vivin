import type { SearchRange } from '../../lib/document-search';

export interface SourceEditorHandle {
  reveal(offset: number, length?: number, focus?: boolean): Promise<void>;
  focus(): void;
  replaceMatches(matches: SearchRange[], replacement: string): void;
  selectedText(): { quote: string; offset: number } | null;
}

export interface RenderedEditorHandle {
  reveal(offset: number, length?: number): Promise<boolean>;
  focus(): void;
  replaceMatches(matches: SearchRange[], replacement: string): void;
  flush(): void;
  revealAnnotation(id: string): Promise<boolean>;
  revealHeading(offset: number): Promise<boolean>;
}

/** Live editor instances keyed by pane id. */
export const sourceEditors = new Map<number, SourceEditorHandle>();
export const renderedEditors = new Map<number, RenderedEditorHandle>();

/** Rendered editors debounce serialization; flush before reading or saving content. */
export function flushEditors() {
  for (const editor of renderedEditors.values()) editor.flush();
}
