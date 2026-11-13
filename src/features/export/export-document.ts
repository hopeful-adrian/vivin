import type { Element, ElementContent, Root } from 'hast';
import { fromHtml } from 'hast-util-from-html';
import { toHtml } from 'hast-util-to-html';
import katexCss from 'katex/dist/katex.min.css?raw';
import { t } from '../../lib/i18n';
import { markdownTree } from '../../lib/markdown-preview';
import { renderMermaidSvg } from '../../lib/mermaid-preview';
import { exportHtml, printDocument, readProjectImage } from '../../lib/project-api';
import { notify, report } from '../ui/use-toast';

const documentCss = `
:root { color-scheme: light; }
body { margin: 0; background: #fff; color: #1f2937; }
.vivin-export { box-sizing: border-box; max-width: 780px; margin: 0 auto; padding: 48px 32px 64px;
  font: 16px/1.75 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
.vivin-export h1, .vivin-export h2, .vivin-export h3, .vivin-export h4 { color: #111827; line-height: 1.3; margin: 1.6em 0 0.6em; }
.vivin-export h1 { font-size: 2em; } .vivin-export h2 { font-size: 1.5em; } .vivin-export h3 { font-size: 1.25em; }
.vivin-export p, .vivin-export ul, .vivin-export ol, .vivin-export blockquote, .vivin-export table, .vivin-export pre { margin: 0 0 1em; }
.vivin-export a { color: #2563eb; }
.vivin-export blockquote { margin-left: 0; padding: 0 1em; color: #4b5563; border-left: 4px solid #d1d5db; }
.vivin-export code { font: 0.9em/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: #f3f4f6; padding: 0.1em 0.3em; border-radius: 4px; }
.vivin-export pre { overflow-x: auto; padding: 12px 16px; background: #f6f8fa; border-radius: 8px; }
.vivin-export pre code { padding: 0; background: none; }
.vivin-export table { border-collapse: collapse; }
.vivin-export th, .vivin-export td { border: 1px solid #d1d5db; padding: 6px 12px; }
.vivin-export img, .vivin-export svg { max-width: 100%; height: auto; }
.vivin-export hr { border: 0; border-top: 1px solid #e5e7eb; margin: 2em 0; }
.vivin-export .mermaid-export { margin: 1.4em 0; text-align: center; }
@media print { .vivin-export { max-width: none; padding: 0; } .vivin-export pre, .vivin-export img, .vivin-export table { break-inside: avoid; } }
`;

function textOf(node: Element): string {
  return node.children.map((child) => ('value' in child ? child.value : '')).join('');
}

function classes(node: Element): string[] {
  const value = node.properties.className;
  return Array.isArray(value) ? value.map(String) : [];
}

/** Inlines project images and renders Mermaid diagrams so the result works offline. */
async function inlineAssets(tree: Root, document: string) {
  const tasks: Promise<void>[] = [];
  const visit = (parent: Root | Element) => {
    parent.children.forEach((node, index) => {
      if (node.type !== 'element') return;
      if (node.tagName === 'img') {
        const source = String(node.properties.src ?? '');
        if (source && !/^(?:https?:|data:)/i.test(source))
          tasks.push(
            readProjectImage(document, decodeURIComponent(source))
              .then((url) => {
                node.properties.src = url;
              })
              .catch(() => {}),
          );
        return;
      }
      const code = node.tagName === 'pre' ? node.children[0] : undefined;
      if (code?.type === 'element' && classes(code).includes('language-mermaid')) {
        tasks.push(
          renderMermaidSvg(textOf(code), false)
            .then((svg) => {
              const figure: ElementContent = {
                type: 'element',
                tagName: 'div',
                properties: { className: ['mermaid-export'] },
                children: fromHtml(svg, { fragment: true }).children.filter(
                  (child): child is ElementContent => child.type !== 'doctype',
                ),
              };
              parent.children[index] = figure;
            })
            .catch(() => {}),
        );
        return;
      }
      visit(node);
    });
  };
  visit(tree);
  await Promise.all(tasks);
}

function documentTitle(path: string, markdown: string): string {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '');
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (character) => `&#${character.charCodeAt(0)};`);
}

async function renderBody(path: string, markdown: string): Promise<string> {
  const tree = markdownTree(markdown);
  await inlineAssets(tree, path);
  return toHtml(tree);
}

export async function buildHtmlDocument(path: string, markdown: string): Promise<string> {
  const body = await renderBody(path, markdown);
  const math = body.includes('class="katex');
  return `<!doctype html>
<html lang="${document.documentElement.lang || 'zh-CN'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="vivin">
<title>${escapeHtml(documentTitle(path, markdown))}</title>
<style>${documentCss}${math ? katexCss : ''}</style>
</head>
<body><article class="vivin-export">${body}</article></body>
</html>
`;
}

export async function exportDocumentHtml(path: string, markdown: string) {
  try {
    const html = await buildHtmlDocument(path, markdown);
    const name = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '') || 'document';
    const saved = await exportHtml(`${name}.html`, html);
    if (saved) notify(t(`已导出到 ${saved}`, `Exported to ${saved}`), 'success');
  } catch (error) {
    report(error);
  }
}

/** Prints only the document; the system print panel also offers “Save as PDF”. */
export async function printMarkdown(path: string, markdown: string) {
  try {
    const body = await renderBody(path, markdown);
    let root = document.getElementById('vivin-print-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'vivin-print-root';
      document.body.append(root);
    }
    root.innerHTML = `<style>${documentCss}</style><article class="vivin-export">${body}</article>`;
    await printDocument();
  } catch (error) {
    report(error);
  }
}

export async function copyRichText(path: string, markdown: string) {
  try {
    const html = renderBody(path, markdown);
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': html.then((value) => new Blob([value], { type: 'text/html' })),
        'text/plain': new Blob([markdown], { type: 'text/plain' }),
      }),
    ]);
    notify(t('已复制为富文本，可粘贴到其他应用', 'Copied as rich text'), 'success');
  } catch (error) {
    report(error);
  }
}
