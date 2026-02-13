import {
  EditorView,
  Decoration,
  ViewPlugin,
  WidgetType,
} from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import type { Range } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNodeRef } from '@lezer/common';

// Widget classes for rendering formatted content
class FormattedWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly className: string
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = this.className;
    span.textContent = this.text;
    return span;
  }

  eq(other: FormattedWidget): boolean {
    return this.text === other.text && this.className === other.className;
  }
}

class LinkWidget extends WidgetType {
  private tooltip: HTMLElement | null = null;
  private span: HTMLElement | null = null;
  private boundCleanup: (() => void) | null = null;

  constructor(
    readonly text: string,
    readonly url: string,
    readonly showUrlPreview: boolean = false
  ) {
    super();
  }

  private cleanupTooltip = () => {
    if (this.tooltip) {
      this.tooltip.remove();
      this.tooltip = null;
    }
  };

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    this.span = span;
    span.className = 'cm-live-link';
    span.textContent = this.text;
    span.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      import('@tauri-apps/plugin-opener').then(({ openUrl }) => {
        openUrl(this.url).catch(console.error);
      });
    });

    if (this.showUrlPreview) {
      span.addEventListener('mouseenter', () => {
        this.tooltip = document.createElement('div');
        this.tooltip.textContent = this.url;
        Object.assign(this.tooltip.style, {
          position: 'fixed',
          zIndex: '1000',
          padding: '6px 10px',
          borderRadius: '6px',
          fontSize: '13px',
          lineHeight: '1.4',
          whiteSpace: 'nowrap',
          maxWidth: '450px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          color: 'var(--color-fg-default)',
          backgroundColor: 'var(--color-canvas-default)',
          border: '1px solid var(--color-border-default)',
          boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
          pointerEvents: 'none',
        });
        document.body.appendChild(this.tooltip);
        const linkRect = span.getBoundingClientRect();
        const tipRect = this.tooltip.getBoundingClientRect();
        const left = linkRect.left + (linkRect.width - tipRect.width) / 2;
        const clampedLeft = Math.max(4, Math.min(left, window.innerWidth - tipRect.width - 4));
        this.tooltip.style.left = `${clampedLeft}px`;
        this.tooltip.style.top = `${linkRect.top - tipRect.height - 6}px`;
      });
      span.addEventListener('mouseleave', this.cleanupTooltip);
    }

    return span;
  }

  destroy(): void {
    this.cleanupTooltip();
    this.span = null;
  }

  eq(other: LinkWidget): boolean {
    return this.text === other.text && this.url === other.url && this.showUrlPreview === other.showUrlPreview;
  }
}

class ImageWidget extends WidgetType {
  constructor(
    readonly alt: string,
    readonly url: string
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const container = document.createElement('span');
    container.className = 'cm-live-image-container';

    const img = document.createElement('img');
    img.src = this.url;
    img.alt = this.alt;
    img.className = 'cm-live-image';
    img.onerror = () => {
      img.style.display = 'none';
      const fallback = document.createElement('span');
      fallback.className = 'cm-live-image-fallback';
      fallback.textContent = `[Image: ${this.alt}]`;
      container.appendChild(fallback);
    };

    container.appendChild(img);
    return container;
  }

  eq(other: ImageWidget): boolean {
    return this.alt === other.alt && this.url === other.url;
  }
}

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-live-checkbox';
    span.textContent = this.checked ? '\u2611' : '\u2610';
    return span;
  }

  eq(other: CheckboxWidget): boolean {
    return this.checked === other.checked;
  }
}

class BulletWidget extends WidgetType {
  constructor(
    readonly isOrdered: boolean,
    readonly orderNumber?: number
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-live-bullet';
    if (this.isOrdered && this.orderNumber !== undefined) {
      span.textContent = `${this.orderNumber}. `;
    } else {
      span.textContent = '• ';
    }
    return span;
  }

  eq(other: BulletWidget): boolean {
    return this.isOrdered === other.isOrdered &&
           this.orderNumber === other.orderNumber;
  }
}

class HorizontalRuleWidget extends WidgetType {
  toDOM(): HTMLElement {
    const hr = document.createElement('div');
    hr.className = 'cm-live-hr';
    return hr;
  }

  eq(): boolean {
    return true;
  }
}

// Hide decoration - makes text invisible but keeps it in the document
const hideDecoration = Decoration.mark({ class: 'cm-hide' });

// Styling decorations
const boldDecoration = Decoration.mark({ class: 'cm-live-bold' });
const italicDecoration = Decoration.mark({ class: 'cm-live-italic' });
const strikethroughDecoration = Decoration.mark({ class: 'cm-live-strikethrough' });
const inlineCodeDecoration = Decoration.mark({ class: 'cm-live-inline-code' });
const blockquoteDecoration = Decoration.mark({ class: 'cm-live-blockquote' });
const plainTextDecoration = Decoration.mark({ class: 'cm-live-plain-text' });

// Line-level decorations
const headingDecorations = [
  Decoration.line({ class: 'cm-live-h1' }),
  Decoration.line({ class: 'cm-live-h2' }),
  Decoration.line({ class: 'cm-live-h3' }),
  Decoration.line({ class: 'cm-live-h4' }),
  Decoration.line({ class: 'cm-live-h5' }),
  Decoration.line({ class: 'cm-live-h6' }),
];

const codeBlockLineDecoration = Decoration.line({ class: 'cm-live-code-block-line' });
const blockquoteLineDecoration = Decoration.line({ class: 'cm-live-blockquote-line' });
// List item decorations with indent levels
const listItemDecorations = [
  Decoration.line({ class: 'cm-live-list-item cm-live-list-indent-0' }),
  Decoration.line({ class: 'cm-live-list-item cm-live-list-indent-1' }),
  Decoration.line({ class: 'cm-live-list-item cm-live-list-indent-2' }),
  Decoration.line({ class: 'cm-live-list-item cm-live-list-indent-3' }),
  Decoration.line({ class: 'cm-live-list-item cm-live-list-indent-4' }),
  Decoration.line({ class: 'cm-live-list-item cm-live-list-indent-5' }),
];

// Marker styling decoration (for when cursor is on line)
const listMarkerDecoration = Decoration.mark({ class: 'cm-live-list-marker' });
const frontmatterLineDecoration = Decoration.line({ class: 'cm-live-frontmatter-line' });

interface ParsedElement {
  type: string;
  from: number;
  to: number;
  line: number;
  markerFrom?: number;
  markerTo?: number;
  text?: string;
  url?: string;
  level?: number;
  checked?: boolean;
  indentLevel?: number;
  indentFrom?: number;
  indentTo?: number;
  isOrdered?: boolean;
  orderNumber?: number;
}

function getLineNumber(view: EditorView, pos: number): number {
  return view.state.doc.lineAt(pos).number;
}

// Trim trailing unbalanced closing parentheses from a URL match
function trimUnbalancedParens(url: string): string {
  let depth = 0;
  let end = url.length;
  for (let i = 0; i < url.length; i++) {
    if (url[i] === '(') depth++;
    else if (url[i] === ')') {
      if (depth > 0) depth--;
      else {
        end = i;
        break;
      }
    }
  }
  return url.slice(0, end);
}

// Common TLDs for bare domain detection (e.g. groq.com, example.org)
const COMMON_TLDS = new Set([
  'com', 'org', 'net', 'io', 'dev', 'ai', 'co', 'app', 'edu', 'gov',
  'xyz', 'me', 'info', 'biz', 'tech', 'site', 'online', 'store', 'cloud',
  'de', 'uk', 'fr', 'jp', 'cn', 'ru', 'br', 'in', 'au', 'ca', 'nl',
  'it', 'es', 'ch', 'se', 'no', 'fi', 'dk', 'at', 'be', 'pl', 'cz',
  'pt', 'kr', 'tw', 'sg', 'hk', 'nz', 'za', 'mx', 'ar', 'cl',
]);

// Function to detect plain URLs in text that aren't already parsed as links
function findPlainUrls(view: EditorView, existingElements: ParsedElement[]): ParsedElement[] {
  const elements: ParsedElement[] = [];
  const doc = view.state.doc;
  // Match URLs with protocol, www. prefix, or bare domains (word.tld)
  const urlRegex = /(?:https?:\/\/|www\.)[^\s<>"{}|\\^`\[\]]+|(?<![.@/\\\w])(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}(?:\/[^\s<>"{}|\\^`\[\]]*)?/g;

  // Create a set of ranges that are already covered by existing elements (excluding list items)
  const coveredRanges = new Set<string>();
  for (const el of existingElements) {
    // Don't consider list items as covering content for URL detection
    if (el.type !== 'listItem') {
      for (let i = el.from; i < el.to; i++) {
        coveredRanges.add(`${el.line}-${i}`);
      }
    }
  }

  for (let lineNum = 1; lineNum <= doc.lines; lineNum++) {
    const line = doc.line(lineNum);
    const lineText = line.text;
    let match;

    while ((match = urlRegex.exec(lineText)) !== null) {
      let url = trimUnbalancedParens(match[0]);
      // Strip trailing punctuation that's likely sentence-level (,.;:!?)
      url = url.replace(/[,;:!?]+$/, '');

      const isProtocolUrl = /^https?:\/\//.test(url);
      const isWwwUrl = /^www\./i.test(url);
      const isBareDomain = !isProtocolUrl && !isWwwUrl;

      // For bare domains, validate the TLD to avoid false positives
      if (isBareDomain) {
        const dotIndex = url.indexOf('/');
        const domain = dotIndex >= 0 ? url.slice(0, dotIndex) : url;
        const tld = domain.split('.').pop()?.toLowerCase();
        if (!tld || !COMMON_TLDS.has(tld)) continue;
      }

      const startPos = line.from + match.index;
      const endPos = startPos + url.length;

      // Check if this range overlaps with any existing element
      let isCovered = false;
      for (let i = startPos; i < endPos; i++) {
        if (coveredRanges.has(`${lineNum}-${i}`)) {
          isCovered = true;
          break;
        }
      }

      if (!isCovered) {
        const href = isProtocolUrl ? url : `https://${url}`;
        elements.push({
          type: 'url',
          from: startPos,
          to: endPos,
          line: lineNum,
          text: url,
          url: href,
        });
      }
    }
  }

  return elements;
}

function parseMarkdownElements(view: EditorView): ParsedElement[] {
  const elements: ParsedElement[] = [];
  const doc = view.state.doc;

  syntaxTree(view.state).iterate({
    enter(node: SyntaxNodeRef) {
      const { from, to, name } = node;
      const line = getLineNumber(view, from);

      switch (name) {
        case 'ATXHeading1':
        case 'ATXHeading2':
        case 'ATXHeading3':
        case 'ATXHeading4':
        case 'ATXHeading5':
        case 'ATXHeading6': {
          const level = parseInt(name.slice(-1));
          // Find the header mark (# symbols)
          // Use text from the node start (not line start) to handle indented headings in list items
          let markerTo = from;
          const lineObj = doc.lineAt(from);
          const textFromNode = lineObj.text.slice(from - lineObj.from);
          const match = textFromNode.match(/^(#{1,6})\s/);
          if (match) {
            markerTo = from + match[0].length;
          }
          elements.push({
            type: 'heading',
            from,
            to,
            line,
            markerFrom: from,
            markerTo,
            level,
          });
          break;
        }

        case 'StrongEmphasis': {
          // **text** or __text__
          const text = doc.sliceString(from, to);
          const marker = text.startsWith('**') ? '**' : '__';
          elements.push({
            type: 'bold',
            from,
            to,
            line,
            markerFrom: from,
            markerTo: from + marker.length,
            text: text.slice(marker.length, -marker.length),
          });
          // Also hide end marker
          elements.push({
            type: 'boldEnd',
            from: to - marker.length,
            to,
            line,
            markerFrom: to - marker.length,
            markerTo: to,
          });
          break;
        }

        case 'Emphasis': {
          // *text* or _text_
          const text = doc.sliceString(from, to);
          const marker = text[0];
          elements.push({
            type: 'italic',
            from,
            to,
            line,
            markerFrom: from,
            markerTo: from + 1,
            text: text.slice(1, -1),
          });
          elements.push({
            type: 'italicEnd',
            from: to - 1,
            to,
            line,
            markerFrom: to - 1,
            markerTo: to,
          });
          break;
        }

        case 'Strikethrough': {
          // ~~text~~
          const text = doc.sliceString(from, to);
          elements.push({
            type: 'strikethrough',
            from,
            to,
            line,
            markerFrom: from,
            markerTo: from + 2,
            text: text.slice(2, -2),
          });
          elements.push({
            type: 'strikethroughEnd',
            from: to - 2,
            to,
            line,
            markerFrom: to - 2,
            markerTo: to,
          });
          break;
        }

        case 'InlineCode': {
          const text = doc.sliceString(from, to);
          const backticks = text.match(/^`+/)?.[0] || '`';
          elements.push({
            type: 'inlineCode',
            from,
            to,
            line,
            markerFrom: from,
            markerTo: from + backticks.length,
            text: text.slice(backticks.length, -backticks.length),
          });
          elements.push({
            type: 'inlineCodeEnd',
            from: to - backticks.length,
            to,
            line,
            markerFrom: to - backticks.length,
            markerTo: to,
          });
          break;
        }

        case 'Link': {
          // [text](url) — url may contain balanced parentheses
          const text = doc.sliceString(from, to);
          const match = text.match(/^\[([^\]]*)\]\((.*)\)$/s);
          if (match) {
            elements.push({
              type: 'link',
              from,
              to,
              line,
              text: match[1],
              url: match[2],
            });
          }
          break;
        }

        case 'Image': {
          // ![alt](url) — url may contain balanced parentheses
          const text = doc.sliceString(from, to);
          const match = text.match(/^!\[([^\]]*)\]\((.*)\)$/s);
          if (match) {
            elements.push({
              type: 'image',
              from,
              to,
              line,
              text: match[1],
              url: match[2],
            });
          }
          break;
        }

        case 'FencedCode': {
          const startLine = getLineNumber(view, from);
          const endLine = getLineNumber(view, to);
          elements.push({
            type: 'codeBlock',
            from,
            to,
            line: startLine,
          });
          // Mark fence lines
          elements.push({
            type: 'codeFenceStart',
            from,
            to: doc.lineAt(from).to,
            line: startLine,
          });
          if (endLine > startLine) {
            const endLineObj = doc.lineAt(to);
            elements.push({
              type: 'codeFenceEnd',
              from: endLineObj.from,
              to: endLineObj.to,
              line: endLine,
            });
          }
          break;
        }

        case 'Blockquote': {
          // Process blockquote lines
          let pos = from;
          while (pos < to) {
            const lineObj = doc.lineAt(pos);
            const lineText = lineObj.text;
            const quoteMatch = lineText.match(/^(\s*>+\s*)/);
            if (quoteMatch) {
              elements.push({
                type: 'blockquote',
                from: lineObj.from,
                to: lineObj.to,
                line: lineObj.number,
                markerFrom: lineObj.from,
                markerTo: lineObj.from + quoteMatch[1].length,
              });
            }
            pos = lineObj.to + 1;
          }
          break;
        }

        case 'BulletList':
        case 'OrderedList': {
          // Lists handled at ListItem level
          break;
        }

        case 'ListItem': {
          const lineObj = doc.lineAt(from);
          const lineText = lineObj.text;
          // Match bullet (-, *, +) or number (1., 2.) markers
          const bulletMatch = lineText.match(/^(\s*)([-*+]|\d+\.)\s/);
          if (bulletMatch) {
            const indentSpaces = bulletMatch[1].length;
            const marker = bulletMatch[2];
            const isOrdered = /^\d+\.$/.test(marker);
            const orderNumber = isOrdered ? parseInt(marker) : undefined;
            // Calculate indent level (typically 2 or 4 spaces per level)
            const indentLevel = Math.floor(indentSpaces / 2);

            const indentFrom = lineObj.from;
            const indentTo = lineObj.from + indentSpaces;
            const markerStart = lineObj.from + bulletMatch[1].length;
            const markerEnd = lineObj.from + bulletMatch[0].length;
            elements.push({
              type: 'listItem',
              from: lineObj.from,
              to: lineObj.to,
              line: lineObj.number,
              indentFrom,
              indentTo,
              markerFrom: markerStart,
              markerTo: markerEnd,
              indentLevel,
              isOrdered,
              orderNumber,
            });
          }
          break;
        }

        case 'TaskMarker': {
          // [x] or [ ]
          const text = doc.sliceString(from, to);
          const checked = text.includes('x') || text.includes('X');
          elements.push({
            type: 'taskMarker',
            from,
            to,
            line,
            checked,
          });
          break;
        }

        case 'HorizontalRule': {
          elements.push({
            type: 'horizontalRule',
            from,
            to,
            line,
          });
          break;
        }

        case 'URL':
        case 'Autolink': {
          const rawText = doc.sliceString(from, to);
          const inner = rawText.startsWith('<') ? rawText.slice(1, -1) : rawText;

          // Detect emails: preceded by @ or contains @
          const isEmail =
            inner.includes('@') ||
            (from > 0 && doc.sliceString(from - 1, from) === '@');

          if (isEmail) {
            elements.push({ type: 'emailUrl', from, to, line });
            break;
          }

          const href = inner.startsWith('http') ? inner : `https://${inner}`;
          elements.push({
            type: 'url',
            from,
            to,
            line,
            text: inner,
            url: href,
          });
          break;
        }
      }
    },
  });

  // Add plain URL detection for URLs not caught by the parser
  const plainUrls = findPlainUrls(view, elements);
  elements.push(...plainUrls);

  return elements;
}

function getFrontmatterRange(view: EditorView): { startLine: number; endLine: number } | null {
  const doc = view.state.doc;
  if (doc.lines < 2) return null;

  const firstLine = doc.line(1).text;
  if (firstLine.trim() !== '---') return null;

  for (let i = 2; i <= doc.lines; i++) {
    if (doc.line(i).text.trim() === '---') {
      return { startLine: 1, endLine: i };
    }
  }
  return null;
}

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const decorations: Range<Decoration>[] = [];
  const elements = parseMarkdownElements(view);

  // Get cursor line
  const cursorPos = view.state.selection.main.head;
  const cursorLine = view.state.doc.lineAt(cursorPos).number;

  // Detect frontmatter range to skip formatting and reset styles
  const frontmatter = getFrontmatterRange(view);
  const frontmatterLines = new Set<number>();
  if (frontmatter) {
    for (let i = frontmatter.startLine; i <= frontmatter.endLine; i++) {
      frontmatterLines.add(i);
      const lineObj = view.state.doc.line(i);
      decorations.push(frontmatterLineDecoration.range(lineObj.from));
    }
  }

  // Track lines with code blocks for special handling
  const codeBlockLines = new Set<number>();
  const codeFenceLines = new Set<number>();

  for (const el of elements) {
    if (el.type === 'codeBlock') {
      const startLine = el.line;
      const endLine = view.state.doc.lineAt(el.to).number;
      for (let i = startLine; i <= endLine; i++) {
        codeBlockLines.add(i);
      }
    }
    if (el.type === 'codeFenceStart' || el.type === 'codeFenceEnd') {
      codeFenceLines.add(el.line);
    }
  }

  for (const el of elements) {
    // Skip all formatting for frontmatter lines
    if (frontmatterLines.has(el.line)) continue;

    const isOnCursorLine = el.line === cursorLine;

    switch (el.type) {
      case 'heading': {
        // Add line decoration for heading style
        const lineObj = view.state.doc.lineAt(el.from);
        if (el.level && el.level >= 1 && el.level <= 6) {
          decorations.push(headingDecorations[el.level - 1].range(lineObj.from));
        }

        // Hide the # markers when cursor is not on this line
        if (!isOnCursorLine && el.markerFrom !== undefined && el.markerTo !== undefined) {
          decorations.push(hideDecoration.range(el.markerFrom, el.markerTo));
        }
        break;
      }

      case 'bold': {
        // Apply bold styling to the content
        if (el.markerTo !== undefined) {
          const contentFrom = el.markerTo;
          const contentTo = el.to - (el.markerTo - el.from);
          if (contentFrom < contentTo) {
            decorations.push(boldDecoration.range(contentFrom, contentTo));
          }
        }

        // Hide markers when not on cursor line
        if (!isOnCursorLine && el.markerFrom !== undefined && el.markerTo !== undefined) {
          decorations.push(hideDecoration.range(el.markerFrom, el.markerTo));
        }
        break;
      }

      case 'boldEnd': {
        if (!isOnCursorLine && el.markerFrom !== undefined && el.markerTo !== undefined) {
          decorations.push(hideDecoration.range(el.markerFrom, el.markerTo));
        }
        break;
      }

      case 'italic': {
        if (el.markerTo !== undefined) {
          const contentFrom = el.markerTo;
          const contentTo = el.to - 1;
          if (contentFrom < contentTo) {
            decorations.push(italicDecoration.range(contentFrom, contentTo));
          }
        }

        if (!isOnCursorLine && el.markerFrom !== undefined && el.markerTo !== undefined) {
          decorations.push(hideDecoration.range(el.markerFrom, el.markerTo));
        }
        break;
      }

      case 'italicEnd': {
        if (!isOnCursorLine && el.markerFrom !== undefined && el.markerTo !== undefined) {
          decorations.push(hideDecoration.range(el.markerFrom, el.markerTo));
        }
        break;
      }

      case 'strikethrough': {
        if (el.markerTo !== undefined) {
          const contentFrom = el.markerTo;
          const contentTo = el.to - 2;
          if (contentFrom < contentTo) {
            decorations.push(strikethroughDecoration.range(contentFrom, contentTo));
          }
        }

        if (!isOnCursorLine && el.markerFrom !== undefined && el.markerTo !== undefined) {
          decorations.push(hideDecoration.range(el.markerFrom, el.markerTo));
        }
        break;
      }

      case 'strikethroughEnd': {
        if (!isOnCursorLine && el.markerFrom !== undefined && el.markerTo !== undefined) {
          decorations.push(hideDecoration.range(el.markerFrom, el.markerTo));
        }
        break;
      }

      case 'inlineCode': {
        if (el.markerTo !== undefined) {
          const markerLen = el.markerTo - el.from;
          const contentFrom = el.markerTo;
          const contentTo = el.to - markerLen;
          if (contentFrom < contentTo) {
            decorations.push(inlineCodeDecoration.range(contentFrom, contentTo));
          }
        }

        if (!isOnCursorLine && el.markerFrom !== undefined && el.markerTo !== undefined) {
          decorations.push(hideDecoration.range(el.markerFrom, el.markerTo));
        }
        break;
      }

      case 'inlineCodeEnd': {
        if (!isOnCursorLine && el.markerFrom !== undefined && el.markerTo !== undefined) {
          decorations.push(hideDecoration.range(el.markerFrom, el.markerTo));
        }
        break;
      }

      case 'link': {
        if (!isOnCursorLine && el.text !== undefined && el.url !== undefined) {
          decorations.push(
            Decoration.replace({
              widget: new LinkWidget(el.text, el.url, true),
            }).range(el.from, el.to)
          );
        }
        break;
      }

      case 'url': {
        if (!isOnCursorLine && el.text !== undefined && el.url !== undefined) {
          decorations.push(
            Decoration.replace({
              widget: new LinkWidget(el.text, el.url, false),
            }).range(el.from, el.to)
          );
        }
        break;
      }

      case 'emailUrl': {
        // Override default URL highlighting for email domains
        decorations.push(plainTextDecoration.range(el.from, el.to));
        break;
      }

      case 'image': {
        if (!isOnCursorLine && el.text !== undefined && el.url !== undefined) {
          decorations.push(
            Decoration.replace({
              widget: new ImageWidget(el.text, el.url),
            }).range(el.from, el.to)
          );
        }
        break;
      }

      case 'codeFenceStart':
      case 'codeFenceEnd': {
        // Add code block line styling
        const lineObj = view.state.doc.lineAt(el.from);
        decorations.push(codeBlockLineDecoration.range(lineObj.from));

        // Hide fence when cursor is not on this line
        if (!isOnCursorLine) {
          decorations.push(hideDecoration.range(el.from, el.to));
        }
        break;
      }

      case 'codeBlock': {
        // Add styling to all code block lines (except fences, handled separately)
        const startLine = el.line;
        const endLine = view.state.doc.lineAt(el.to).number;

        for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
          if (!codeFenceLines.has(lineNum)) {
            const lineObj = view.state.doc.line(lineNum);
            decorations.push(codeBlockLineDecoration.range(lineObj.from));
          }
        }
        break;
      }

      case 'blockquote': {
        const lineObj = view.state.doc.lineAt(el.from);
        decorations.push(blockquoteLineDecoration.range(lineObj.from));

        // Hide the > marker when not on cursor line
        if (!isOnCursorLine && el.markerFrom !== undefined && el.markerTo !== undefined) {
          decorations.push(hideDecoration.range(el.markerFrom, el.markerTo));
        }
        break;
      }

      case 'listItem': {
        const lineObj = view.state.doc.lineAt(el.from);
        const indentLevel = Math.min(el.indentLevel ?? 0, 5);

        // Apply line decoration with consistent indentation
        decorations.push(listItemDecorations[indentLevel].range(lineObj.from));

        // Always hide the leading whitespace (indentation) - CSS padding handles it
        if (el.indentFrom !== undefined && el.indentTo !== undefined && el.indentFrom < el.indentTo) {
          decorations.push(hideDecoration.range(el.indentFrom, el.indentTo));
        }

        if (el.markerFrom !== undefined && el.markerTo !== undefined) {
          if (isOnCursorLine) {
            // Style the marker but keep it visible for editing
            decorations.push(listMarkerDecoration.range(el.markerFrom, el.markerTo));
          } else {
            // Replace marker with styled bullet
            decorations.push(
              Decoration.replace({
                widget: new BulletWidget(
                  el.isOrdered ?? false,
                  el.orderNumber
                ),
              }).range(el.markerFrom, el.markerTo)
            );
          }
        }
        break;
      }

      case 'taskMarker': {
        if (!isOnCursorLine) {
          decorations.push(
            Decoration.replace({
              widget: new CheckboxWidget(el.checked ?? false),
            }).range(el.from, el.to)
          );
        }
        break;
      }

      case 'horizontalRule': {
        if (!isOnCursorLine) {
          decorations.push(
            Decoration.replace({
              widget: new HorizontalRuleWidget(),
            }).range(el.from, el.to)
          );
        }
        break;
      }
    }
  }

  // Sort decorations by position
  decorations.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide);

  for (const d of decorations) {
    builder.add(d.from, d.to, d.value);
  }

  return builder.finish();
}

export const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);

// Styles for live preview elements
export const livePreviewStyles = EditorView.baseTheme({
  // Hide syntax markers
  '.cm-hide': {
    display: 'none',
  },

  // Headings - use line-height for spacing instead of margins
  // Margins break CodeMirror's click position calculations
  '.cm-live-h1': {
    fontSize: '1.5em',
    fontWeight: '700',
    lineHeight: '1.8',
  },
  '.cm-live-h2': {
    fontSize: '1.3em',
    fontWeight: '600',
    lineHeight: '1.7',
  },
  '.cm-live-h3': {
    fontSize: '1.15em',
    fontWeight: '600',
    lineHeight: '1.6',
  },
  '.cm-live-h4': {
    fontSize: '1.05em',
    fontWeight: '600',
    lineHeight: '1.5',
  },
  '.cm-live-h5': {
    fontSize: '1em',
    fontWeight: '600',
    lineHeight: '1.5',
  },
  '.cm-live-h6': {
    fontSize: '0.95em',
    fontWeight: '600',
    color: 'var(--color-fg-muted)',
    lineHeight: '1.5',
  },

  // Text formatting
  '.cm-live-bold': {
    fontWeight: 'bold',
  },
  '.cm-live-italic': {
    fontStyle: 'italic',
  },
  '.cm-live-strikethrough': {
    textDecoration: 'line-through',
    color: 'var(--color-fg-muted)',
  },
  '.cm-live-inline-code': {
    fontFamily: '"Monaco", "Menlo", "Ubuntu Mono", monospace',
    backgroundColor: 'var(--color-neutral-muted)',
    borderRadius: '3px',
    padding: '0.15em 0.4em',
    fontSize: '0.9em',
  },

  // Reset styling for URLs inside emails
  '.cm-live-plain-text': {
    color: 'inherit !important',
    textDecoration: 'none !important',
    cursor: 'inherit !important',
  },

  // Links
  '.cm-live-link': {
    color: 'var(--color-accent-fg, #0969da)',
    textDecoration: 'none',
    cursor: 'pointer',
    '&:hover': {
      textDecoration: 'underline',
    },
  },

  // Images
  '.cm-live-image-container': {
    display: 'inline-block',
  },
  '.cm-live-image': {
    maxWidth: '100%',
    height: 'auto',
    borderRadius: '4px',
  },
  '.cm-live-image-fallback': {
    color: 'var(--color-fg-muted)',
    fontStyle: 'italic',
  },

  // Code blocks
  '.cm-live-code-block-line': {
    backgroundColor: 'var(--color-canvas-subtle)',
    fontFamily: '"Monaco", "Menlo", "Ubuntu Mono", monospace',
    fontSize: '0.9em',
  },

  // Blockquotes
  '.cm-live-blockquote-line': {
    borderLeft: '4px solid var(--color-border-default)',
    paddingLeft: '1em',
    color: 'var(--color-fg-muted)',
    fontStyle: 'italic',
  },

  // Lists - base styling
  '.cm-live-list-item': {
    // Base list item styling
  },

  // List indent levels (applied via line decoration)
  '.cm-live-list-indent-0': {
    paddingLeft: '0 !important',
  },
  '.cm-live-list-indent-1': {
    paddingLeft: '1.5em !important',
  },
  '.cm-live-list-indent-2': {
    paddingLeft: '3em !important',
  },
  '.cm-live-list-indent-3': {
    paddingLeft: '4.5em !important',
  },
  '.cm-live-list-indent-4': {
    paddingLeft: '6em !important',
  },
  '.cm-live-list-indent-5': {
    paddingLeft: '7.5em !important',
  },

  // Bullet widget (replaces -, *, + with •)
  '.cm-live-bullet': {
    color: 'var(--color-fg-muted)',
  },

  // Marker styling when editing (cursor on line)
  '.cm-live-list-marker': {
    color: 'var(--color-fg-muted)',
  },

  // Task checkboxes
  '.cm-live-checkbox': {
    display: 'inline-block',
    width: '1.2em',
    marginRight: '0.3em',
    fontSize: '1.1em',
  },

  // Horizontal rule
  '.cm-live-hr': {
    display: 'block',
    borderTop: '2px solid var(--color-border-default)',
    height: '0',
    width: '100%',
  },

  // Frontmatter - reset all syntax highlighting overrides
  '.cm-live-frontmatter-line span': {
    fontSize: 'inherit !important',
    fontWeight: 'normal !important',
    fontStyle: 'normal !important',
    textDecoration: 'none !important',
    color: 'var(--color-fg-muted) !important',
  },
});

export function livePreview() {
  return [livePreviewPlugin, livePreviewStyles];
}