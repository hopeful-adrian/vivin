import type { Element, ElementContent, Root, RootContent } from 'hast';
import { fromHtml } from 'hast-util-from-html';
import katex from 'katex';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkRehype, {
    handlers: {
      // Unsupported HTML remains readable without executing document markup.
      html: (_state, node) => ({
        type: 'element',
        tagName: 'pre',
        properties: {},
        children: [{ type: 'text', value: node.value }],
        position: node.position,
      }),
    },
  })
  .use(rehypeSanitize, {
    ...defaultSchema,
    // remark-rehype already prefixes the generated footnote IDs. Raw HTML is
    // rendered as text, so a second prefix would only break fragment links.
    clobberPrefix: '',
    attributes: {
      ...defaultSchema.attributes,
      code: [['className', /^language-./, 'math-inline', 'math-display']],
    },
  })
  // KaTeX generates trusted markup only after document HTML has been sanitized.
  .use(renderMath);

function renderMath() {
  return (tree: Root) => {
    function visit(parent: Root | Element) {
      for (let index = 0; index < parent.children.length; index++) {
        const node = parent.children[index];
        if (node?.type !== 'element') continue;
        const code =
          node.tagName === 'pre' && node.children[0]?.type === 'element' ? node.children[0] : node;
        const classes = code.properties.className;
        if (
          Array.isArray(classes) &&
          classes.some(
            (value) =>
              value === 'math-inline' || value === 'math-display' || value === 'language-math',
          )
        ) {
          const value = code.children
            .map((child) => (child.type === 'text' ? child.value : ''))
            .join('');
          try {
            const html = katex.renderToString(value, {
              displayMode: node.tagName === 'pre' || classes.includes('math-display'),
              throwOnError: false,
              trust: false,
            });
            // Use the DOM-independent parser: browser DOMParser is unavailable
            // in the preview worker. Only KaTeX-generated HTML reaches here.
            const replacements = fromHtml(html, { fragment: true }).children.filter(
              (child): child is ElementContent => child.type !== 'doctype',
            );
            for (const replacement of replacements) replacement.position = node.position;
            parent.children.splice(index, 1, ...replacements);
            index += replacements.length - 1;
          } catch {
            /* Invalid formulas remain readable as source. */
          }
        } else visit(node);
      }
    }
    visit(tree);
  };
}

/** Sanitized HTML tree of a whole document, as shown in previews. */
export function markdownTree(markdown: string): Root {
  return processor.runSync(processor.parse(markdown)) as Root;
}

export interface PreviewSection {
  id: number;
  start: number;
  end: number;
  nodes: RootContent[];
  estimatedHeight: number;
}

export function previewSections(markdown: string, targetLength = 3_500): PreviewSection[] {
  // Parse the full document once so references and footnotes work across sections.
  const tree = processor.runSync(processor.parse(markdown)) as Root;
  const sections: PreviewSection[] = [];
  let nodes: RootContent[] = [];
  let start = 0;
  function finish(end: number) {
    if (!nodes.length) return;
    const source = markdown.slice(start, end);
    sections.push({
      id: sections.length,
      start,
      end,
      nodes,
      estimatedHeight: Math.max(
        80,
        source
          .split('\n')
          .reduce((height, line) => height + Math.max(12, Math.ceil(line.length / 55) * 28), 0),
      ),
    });
    nodes = [];
    start = end;
  }
  for (const node of tree.children) {
    const offset = node.position?.start.offset;
    if (offset !== undefined && offset - start >= targetLength) finish(offset);
    if (node.type === 'element' && /^h[1-6]$/.test(node.tagName)) {
      node.properties['data-source-offset'] = offset;
    }
    nodes.push(node);
  }
  finish(markdown.length);
  return sections;
}
