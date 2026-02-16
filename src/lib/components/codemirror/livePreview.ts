import {
  EditorView,
  Decoration,
  ViewPlugin,
  WidgetType,
} from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder, StateField } from '@codemirror/state';
import type { Range } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNodeRef } from '@lezer/common';
import { render } from 'katex';
import 'katex/dist/katex.min.css';

// Render inline markdown (bold, italic, strikethrough, code) into an element
function renderInlineMarkdown(el: HTMLElement, text: string): void {
  // Process inline formatting tokens in order
  const regex = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|~~(.+?)~~|`(.+?)`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    // Append text before the match
    if (match.index > lastIndex) {
      el.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    }

    const span = document.createElement('span');
    if (match[2]) {
      // ***bold italic***
      span.style.fontWeight = 'bold';
      span.style.fontStyle = 'italic';
      span.textContent = match[2];
    } else if (match[3]) {
      // **bold**
      span.style.fontWeight = 'bold';
      span.textContent = match[3];
    } else if (match[4]) {
      // *italic*
      span.style.fontStyle = 'italic';
      span.textContent = match[4];
    } else if (match[5]) {
      // ~~strikethrough~~
      span.style.textDecoration = 'line-through';
      span.textContent = match[5];
    } else if (match[6]) {
      // `code`
      span.className = 'cm-live-inline-code';
      span.textContent = match[6];
    }
    el.appendChild(span);
    lastIndex = match.index + match[0].length;
  }

  // Append remaining text
  if (lastIndex < text.length) {
    el.appendChild(document.createTextNode(text.slice(lastIndex)));
  }

  // If nothing was parsed (no formatting), just set text content
  if (lastIndex === 0) {
    el.textContent = text;
  }
}

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
    renderInlineMarkdown(span, this.text);
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
  private view: EditorView | null = null;
  private from: number;
  private to: number;

  constructor(readonly checked: boolean, from: number, to: number) {
    super();
    this.from = from;
    this.to = to;
  }

  toDOM(view: EditorView): HTMLElement {
    this.view = view;
    const span = document.createElement('span');
    span.className = 'cm-live-checkbox';
    span.textContent = this.checked ? '\u2611' : '\u2610';
    span.style.cursor = 'pointer';

    span.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggleCheckbox();
    });

    return span;
  }

  ignoreEvent(event: Event): boolean {
    // Ignore all events on the checkbox widget to prevent CodeMirror from moving cursor
    return true;
  }

  private toggleCheckbox() {
    if (!this.view) return;

    const newChecked = !this.checked;
    const newText = newChecked ? '[x]' : '[ ]';

    this.view.dispatch({
      changes: {
        from: this.from,
        to: this.to,
        insert: newText
      }
    });
  }

  eq(other: CheckboxWidget): boolean {
    return this.checked === other.checked && this.from === other.from && this.to === other.to;
  }
}

class MathWidget extends WidgetType {
  private showingRaw = false;

  constructor(readonly latex: string) {
    super();
  }

  toDOM(): HTMLElement {
    const container = document.createElement('span');
    container.className = 'cm-live-math';
    container.style.cursor = 'pointer';

    container.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggleDisplay(container);
    });

    this.renderMath(container);
    return container;
  }

  ignoreEvent(event: Event): boolean {
    // Ignore all events on the math widget to prevent CodeMirror from moving cursor
    return true;
  }

  private toggleDisplay(container: HTMLElement) {
    this.showingRaw = !this.showingRaw;
    this.renderMath(container);
  }

  private renderMath(container: HTMLElement) {
    container.innerHTML = '';

    if (this.showingRaw) {
      // Show raw LaTeX
      const code = document.createElement('code');
      code.textContent = `$${this.latex}$`;
      code.style.fontFamily = '"Monaco", "Menlo", "Ubuntu Mono", monospace';
      code.style.backgroundColor = 'var(--color-neutral-muted)';
      code.style.padding = '2px 4px';
      code.style.borderRadius = '3px';
      code.style.fontSize = '0.9em';
      container.appendChild(code);
    } else {
      // Render with KaTeX
      try {
        render(this.latex, container, {
          throwOnError: false,
          displayMode: false,
          strict: false,
        });
      } catch (error) {
        // Fallback to raw text if rendering fails
        const fallback = document.createElement('code');
        fallback.textContent = `$${this.latex}$`;
        fallback.style.fontFamily = '"Monaco", "Menlo", "Ubuntu Mono", monospace';
        fallback.style.backgroundColor = 'var(--color-neutral-muted)';
        fallback.style.padding = '2px 4px';
        fallback.style.borderRadius = '3px';
        fallback.style.fontSize = '0.9em';
        fallback.style.color = 'var(--color-fg-muted)';
        container.appendChild(fallback);
      }
    }
  }

  eq(other: MathWidget): boolean {
    return this.latex === other.latex && this.showingRaw === other.showingRaw;
  }
}

class WikiLinkWidget extends WidgetType {
  constructor(
    readonly target: string,
    readonly display: string
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-wiki-link';
    span.textContent = this.display;

    // Left-click: navigate in current tab
    span.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      span.dispatchEvent(new CustomEvent('marko:wiki-link', {
        bubbles: true,
        detail: { target: this.target, newTab: false }
      }));
    });

    // Middle-click: open in new tab
    span.addEventListener('auxclick', (e) => {
      if (e.button === 1) { // Middle mouse button
        e.preventDefault();
        e.stopPropagation();
        span.dispatchEvent(new CustomEvent('marko:wiki-link', {
          bubbles: true,
          detail: { target: this.target, newTab: true }
        }));
      }
    });

    return span;
  }

  eq(other: WikiLinkWidget): boolean {
    return this.target === other.target && this.display === other.display;
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

class TableWidget extends WidgetType {
  private view: EditorView | null = null;
  private boundHandlers: (() => void) | null = null;
  private from: number;
  private to: number;

  constructor(readonly rawText: string, from: number, to: number) {
    super();
    this.from = from;
    this.to = to;
  }

  toDOM(view: EditorView): HTMLElement {
    this.view = view;
    const container = document.createElement('div');
    container.className = 'cm-live-table';

    const lines = this.rawText.split('\n').filter((l) => l.trim());
    if (lines.length < 2) return container;

    const parseRow = (row: string): string[] =>
      row
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((c) => c.trim());

    const headerCells = parseRow(lines[0]);
    const alignRow = parseRow(lines[1]);

    const alignments: ('left' | 'center' | 'right' | null)[] = alignRow.map((cell) => {
      const left = cell.startsWith(':');
      const right = cell.endsWith(':');
      if (left && right) return 'center';
      if (right) return 'right';
      if (left) return 'left';
      return null;
    });

    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    for (let i = 0; i < headerCells.length; i++) {
      const th = document.createElement('th');
      th.textContent = headerCells[i];
      th.contentEditable = 'true';
      if (alignments[i]) th.style.textAlign = alignments[i]!;
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    if (lines.length > 2) {
      const tbody = document.createElement('tbody');
      for (let r = 2; r < lines.length; r++) {
        const cells = parseRow(lines[r]);
        const tr = document.createElement('tr');
        for (let i = 0; i < headerCells.length; i++) {
          const td = document.createElement('td');
          td.textContent = cells[i] ?? '';
          td.contentEditable = 'true';
          if (alignments[i]) td.style.textAlign = alignments[i]!;
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
    }

    // Add event listeners for cell editing
    const handleCellInput = (e: Event) => {
      // Just track that content has changed - we'll sync on blur
      const cell = e.target as HTMLElement;
      cell.dataset.changed = 'true';
    };

    const handleCellFocus = (e: Event) => {
      // Mark cell as being edited
      const cell = e.target as HTMLElement;
      cell.dataset.editing = 'true';
    };

    const handleCellBlur = (e: Event) => {
      const cell = e.target as HTMLElement;
      if (cell.dataset.changed === 'true') {
        this.syncTableToMarkdown();
      }
      delete cell.dataset.editing;
      delete cell.dataset.changed;
    };

    const handleCellKeyDown = (e: Event) => {
      const ke = e as KeyboardEvent;
      const cell = ke.target as HTMLTableCellElement;
      const currentRow = cell.closest('tr') as HTMLTableRowElement;
      const table = currentRow.closest('table') as HTMLTableElement;
      const allRows = Array.from(table.querySelectorAll('tr'));
      const currentRowIndex = allRows.indexOf(currentRow);
      const cellsInRow = Array.from(currentRow.querySelectorAll('th, td'));
      const currentCellIndex = cellsInRow.indexOf(cell);

      switch (ke.key) {
        case 'Tab':
          ke.preventDefault();
          if (ke.shiftKey) {
            // Move to previous cell
            if (currentCellIndex > 0) {
              (cellsInRow[currentCellIndex - 1] as HTMLElement).focus();
            } else if (currentRowIndex > 0) {
              // Move to last cell of previous row
              const prevRow = allRows[currentRowIndex - 1];
              const prevCells = Array.from(prevRow.querySelectorAll('th, td'));
              (prevCells[prevCells.length - 1] as HTMLElement).focus();
            }
          } else {
            // Move to next cell
            if (currentCellIndex < cellsInRow.length - 1) {
              (cellsInRow[currentCellIndex + 1] as HTMLElement).focus();
            } else if (currentRowIndex < allRows.length - 1) {
              // Move to first cell of next row
              const nextRow = allRows[currentRowIndex + 1];
              const nextCells = Array.from(nextRow.querySelectorAll('th, td'));
              (nextCells[0] as HTMLElement).focus();
            }
          }
          break;

        case 'Enter':
          ke.preventDefault();
          // Move to same column in next row
          if (currentRowIndex < allRows.length - 1) {
            const nextRow = allRows[currentRowIndex + 1];
            const nextCells = Array.from(nextRow.querySelectorAll('th, td'));
            if (currentCellIndex < nextCells.length) {
              (nextCells[currentCellIndex] as HTMLElement).focus();
            }
          }
          break;

        case 'Escape':
          ke.preventDefault();
          cell.blur();
          break;
      }
    };

    // Add listeners to all cells
    const cells = table.querySelectorAll('th, td');
    cells.forEach(cell => {
      cell.addEventListener('input', handleCellInput);
      cell.addEventListener('focus', handleCellFocus);
      cell.addEventListener('blur', handleCellBlur);
      cell.addEventListener('keydown', handleCellKeyDown);
    });

    // Store cleanup function
    this.boundHandlers = () => {
      cells.forEach(cell => {
        cell.removeEventListener('input', handleCellInput);
        cell.removeEventListener('focus', handleCellFocus);
        cell.removeEventListener('blur', handleCellBlur);
        cell.removeEventListener('keydown', handleCellKeyDown);
      });
    };

    container.appendChild(table);
    return container;
  }

  ignoreEvent(event: Event): boolean {
    // Ignore all events on the table widget to prevent CodeMirror from moving cursor
    // Cell editing is handled entirely within the widget
    return true;
  }

  private syncTableToMarkdown() {
    if (!this.view) return;

    const table = this.view.dom.querySelector('.cm-live-table table') as HTMLTableElement;
    if (!table) return;

    const rows: string[] = [];
    
    // Get header row
    const headerRow = table.querySelector('thead tr');
    if (headerRow) {
      const headerCells = Array.from(headerRow.querySelectorAll('th')).map(th => th.textContent || '');
      rows.push('| ' + headerCells.join(' | ') + ' |');
      
      // Add alignment row (simplified - could be enhanced to detect actual alignments)
      rows.push('| ' + headerCells.map(() => '---').join(' | ') + ' |');
    }

    // Get body rows
    const bodyRows = table.querySelectorAll('tbody tr');
    bodyRows.forEach(tr => {
      const cells = Array.from(tr.querySelectorAll('td')).map(td => td.textContent || '');
      rows.push('| ' + cells.join(' | ') + ' |');
    });

    const newMarkdown = rows.join('\n');
    
    // Dispatch transaction to update the document
    this.view.dispatch({
      changes: {
        from: this.from,
        to: this.to,
        insert: newMarkdown
      }
    });
  }

  updateDOM(dom: HTMLElement, view: EditorView): boolean {
    // If the raw text hasn't changed, no need to update
    if (this.rawText === view.state.doc.sliceString(this.from, this.to)) {
      this.view = view; // Update view reference
      return true; // DOM is still valid
    }

    // If content changed externally, we need to recreate
    return false; // Signal that DOM needs to be recreated
  }

  destroy(): void {
    if (this.boundHandlers) {
      this.boundHandlers();
      this.boundHandlers = null;
    }
  }

  eq(other: TableWidget): boolean {
    return this.rawText === other.rawText && this.from === other.from && this.to === other.to;
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
  endLine?: number;
  indentFrom?: number;
  indentTo?: number;
  isOrdered?: boolean;
  orderNumber?: number;
  target?: string; // For wiki-links: the link target
  parentFrom?: number; // For end markers: full element range
  parentTo?: number;
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

  // Create a set of ranges that are already covered by existing elements (excluding list items, inline formatting, and URLs)
  const coveredRanges = new Set<string>();
  for (const el of existingElements) {
    // Don't consider list items, inline formatting, or existing URLs as covering content for URL detection
    // This allows findPlainUrls to find complete URLs even if Lezer's URL node stops early
    if (el.type !== 'listItem' &&
        el.type !== 'bold' &&
        el.type !== 'boldEnd' &&
        el.type !== 'italic' &&
        el.type !== 'italicEnd' &&
        el.type !== 'strikethrough' &&
        el.type !== 'strikethroughEnd' &&
        el.type !== 'inlineCode' &&
        el.type !== 'inlineCodeEnd' &&
        el.type !== 'url' &&
        el.type !== 'emailUrl') {
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

// Check if a bracket at given position is escaped with backslash
function isEscaped(doc: any, pos: number): boolean {
  if (pos === 0) return false;
  let backslashes = 0;
  let checkPos = pos - 1;
  while (checkPos >= 0 && doc.sliceString(checkPos, checkPos + 1) === '\\') {
    backslashes++;
    checkPos--;
  }
  // If odd number of backslashes, the character is escaped
  return backslashes % 2 === 1;
}

// Function to detect wiki-links [[target]] or [[target|display]]
function findWikiLinks(view: EditorView, existingElements: ParsedElement[]): ParsedElement[] {
  const elements: ParsedElement[] = [];
  const doc = view.state.doc;
  // Match [[target]] or [[target|display text]]
  const wikiLinkRegex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

  // Build set of code block lines to skip
  const codeBlockLines = new Set<number>();
  for (const el of existingElements) {
    if (el.type === 'codeBlock') {
      const startLine = el.line;
      const endLine = view.state.doc.lineAt(el.to).number;
      for (let i = startLine; i <= endLine; i++) {
        codeBlockLines.add(i);
      }
    }
  }

  for (let lineNum = 1; lineNum <= doc.lines; lineNum++) {
    // Skip code block lines
    if (codeBlockLines.has(lineNum)) continue;

    const line = doc.line(lineNum);
    const lineText = line.text;
    let match;

    while ((match = wikiLinkRegex.exec(lineText)) !== null) {
      const startPos = line.from + match.index;

      // Skip if the opening bracket is escaped
      if (isEscaped(doc, startPos)) {
        continue;
      }

      const target = match[1].trim();
      const display = match[2]?.trim() || target;
      const endPos = startPos + match[0].length;

      elements.push({
        type: 'wikiLink',
        from: startPos,
        to: endPos,
        line: lineNum,
        text: display,
        target: target,
      });
    }
  }

  return elements;
}

// Function to detect block math $$...$$
function findMathBlocks(view: EditorView, existingElements: ParsedElement[]): ParsedElement[] {
  const elements: ParsedElement[] = [];
  const doc = view.state.doc;
  // Match $$...$$ blocks (multiline support)
  const mathRegex = /\$\$([\s\S]*?)\$\$/g;

  // Build set of code block lines to skip
  const codeBlockLines = new Set<number>();
  for (const el of existingElements) {
    if (el.type === 'codeBlock') {
      const startLine = el.line;
      const endLine = view.state.doc.lineAt(el.to).number;
      for (let i = startLine; i <= endLine; i++) {
        codeBlockLines.add(i);
      }
    }
  }

  for (let lineNum = 1; lineNum <= doc.lines; lineNum++) {
    // Skip code block lines
    if (codeBlockLines.has(lineNum)) continue;

    const line = doc.line(lineNum);
    const lineText = line.text;
    let match;

    while ((match = mathRegex.exec(lineText)) !== null) {
      const latex = match[1].trim();
      const startPos = line.from + match.index;
      const endPos = startPos + match[0].length;

      elements.push({
        type: 'math',
        from: startPos,
        to: endPos,
        line: lineNum,
        text: latex,
      });
    }
  }

  return elements;
}

// Function to detect inline math $...$
function findInlineMath(view: EditorView, existingElements: ParsedElement[]): ParsedElement[] {
  const elements: ParsedElement[] = [];
  const doc = view.state.doc;

  // Build set of code block lines to skip
  const codeBlockLines = new Set<number>();
  for (const el of existingElements) {
    if (el.type === 'codeBlock') {
      const startLine = el.line;
      const endLine = view.state.doc.lineAt(el.to).number;
      for (let i = startLine; i <= endLine; i++) {
        codeBlockLines.add(i);
      }
    }
  }

  // Build set of inline code ranges to skip
  const inlineCodeRanges: { from: number; to: number }[] = [];
  for (const el of existingElements) {
    if (el.type === 'inlineCode') {
      inlineCodeRanges.push({ from: el.from, to: el.to });
    }
  }

  for (let lineNum = 1; lineNum <= doc.lines; lineNum++) {
    // Skip code block lines
    if (codeBlockLines.has(lineNum)) continue;

    const line = doc.line(lineNum);
    const lineText = line.text;

    // Match $...$ but not $$...$$ (inline math only)
    // Look for $ followed by non-whitespace, then content, then non-whitespace followed by $
    const inlineMathRegex = /\$(?!\$)([^\s$](?:[^$]*[^\s$])?)\$/g;
    let match;

    while ((match = inlineMathRegex.exec(lineText)) !== null) {
      const startPos = line.from + match.index;
      const endPos = startPos + match[0].length;

      // Skip if escaped
      if (isEscaped(doc, startPos)) continue;

      // Skip if inside inline code
      let inCode = false;
      for (const range of inlineCodeRanges) {
        if (startPos >= range.from && endPos <= range.to) {
          inCode = true;
          break;
        }
      }
      if (inCode) continue;

      const latex = match[1];

      elements.push({
        type: 'inlineMath',
        from: startPos,
        to: endPos,
        line: lineNum,
        text: latex,
      });
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

        case 'SetextHeading1':
        case 'SetextHeading2': {
          const level = name === 'SetextHeading1' ? 1 : 2;
          // Setext headings: text on first line, === or --- on second line
          const endLineObj = doc.lineAt(to);
          elements.push({
            type: 'heading',
            from,
            to,
            line,
            markerFrom: endLineObj.from,
            markerTo: endLineObj.to,
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
            parentFrom: from,
            parentTo: to,
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
            parentFrom: from,
            parentTo: to,
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
            parentFrom: from,
            parentTo: to,
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
            parentFrom: from,
            parentTo: to,
          });
          break;
        }

        case 'Link': {
          // [text](url) — url may contain balanced parentheses
          // Handle multi-line links and validate structure
          const text = doc.sliceString(from, to);

          // More robust regex that handles newlines in link text
          // Match [text](url) where text can contain newlines but not unescaped ]
          const match = text.match(/^\[([^\]]*(?:\\\][^\]]*)*)\]\((.*?)\)$/s);

          if (match) {
            const linkText = match[1].trim();
            const linkUrl = match[2].trim();

            // Validate that the link is reasonable (e.g., not spanning too many lines)
            const newlineCount = (linkText.match(/\n/g) || []).length;
            if (newlineCount <= 5) { // Allow up to 5 line breaks in link text
              elements.push({
                type: 'link',
                from,
                to,
                line,
                text: linkText,
                url: linkUrl,
              });
            }
          }
          break;
        }

        case 'Image': {
          // ![alt](url) — url may contain balanced parentheses
          // Handle multi-line alt text and validate structure
          const text = doc.sliceString(from, to);

          // More robust regex that handles newlines in alt text
          const match = text.match(/^!\[([^\]]*(?:\\\][^\]]*)*)\]\((.*?)\)$/s);

          if (match) {
            const altText = match[1].trim();
            const imageUrl = match[2].trim();

            // Validate that the alt text is reasonable
            const newlineCount = (altText.match(/\n/g) || []).length;
            if (newlineCount <= 5) { // Allow up to 5 line breaks in alt text
              elements.push({
                type: 'image',
                from,
                to,
                line,
                text: altText,
                url: imageUrl,
              });
            }
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

        case 'Table': {
          const endLine = view.state.doc.lineAt(to).number;
          elements.push({
            type: 'table',
            from,
            to,
            line,
            endLine,
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

  // Deduplicate: remove any existing url/emailUrl elements that are subsumed by plainUrls
  for (const plainUrl of plainUrls) {
    const overlappingIndices = elements
      .map((el, i) =>
        (el.type === 'url' || el.type === 'emailUrl') &&
        el.from >= plainUrl.from &&
        el.to <= plainUrl.to ? i : -1
      )
      .filter(i => i !== -1);

    // Remove overlapped elements in reverse order to maintain indices
    for (let i = overlappingIndices.length - 1; i >= 0; i--) {
      elements.splice(overlappingIndices[i], 1);
    }
  }

  elements.push(...plainUrls);

  // Add wiki-link detection
  const wikiLinks = findWikiLinks(view, elements);
  elements.push(...wikiLinks);

  // Add math block detection
  const mathBlocks = findMathBlocks(view, elements);
  elements.push(...mathBlocks);

  // Add inline math detection
  const inlineMath = findInlineMath(view, elements);
  elements.push(...inlineMath);

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

  // Wrap in try-catch to prevent entire editor from breaking if parser fails
  let elements: ParsedElement[] = [];
  try {
    elements = parseMarkdownElements(view);
  } catch (error) {
    console.error('Error parsing markdown elements:', error);
    return Decoration.none;
  }

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

  // Track table ranges that will be replaced (cursor outside)
  const replacedTableRanges: { from: number; to: number }[] = [];

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
    if (el.type === 'table') {
      const tableEndLine = el.endLine ?? el.line;
      const cursorInTable = cursorLine >= el.line && cursorLine <= tableEndLine;
      if (!cursorInTable) {
        replacedTableRanges.push({ from: el.from, to: el.to });
      }
    }
  }

  // Helper: check if cursor is inside an element's character range
  const cursorInside = (from: number, to: number) =>
    cursorPos >= from && cursorPos <= to;

  for (const el of elements) {
    // Skip all formatting for frontmatter lines
    if (frontmatterLines.has(el.line)) continue;

    // Skip inline decorations inside tables that will be block-replaced
    if (el.type !== 'table' && replacedTableRanges.some(r => el.from >= r.from && el.to <= r.to)) {
      continue;
    }

    // Line-level elements use line-based cursor check (structural markers)
    const isOnCursorLine = el.line === cursorLine;
    // Inline elements use precise range-based cursor check
    const cursorInElement = cursorInside(el.from, el.to);
    // End markers check cursor against the full parent element range
    const cursorInParent = el.parentFrom !== undefined && el.parentTo !== undefined
      ? cursorInside(el.parentFrom, el.parentTo)
      : cursorInElement;

    switch (el.type) {
      case 'heading': {
        // Add line decoration for heading style
        const lineObj = view.state.doc.lineAt(el.from);
        if (el.level && el.level >= 1 && el.level <= 6) {
          decorations.push(headingDecorations[el.level - 1].range(lineObj.from));
        }

        // Hide the # markers when cursor is not on this line (line-level element)
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

        // Hide markers when cursor is not inside this element
        if (!cursorInElement && el.markerFrom !== undefined && el.markerTo !== undefined) {
          decorations.push(hideDecoration.range(el.markerFrom, el.markerTo));
        }
        break;
      }

      case 'boldEnd': {
        if (!cursorInParent && el.markerFrom !== undefined && el.markerTo !== undefined) {
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

        if (!cursorInElement && el.markerFrom !== undefined && el.markerTo !== undefined) {
          decorations.push(hideDecoration.range(el.markerFrom, el.markerTo));
        }
        break;
      }

      case 'italicEnd': {
        if (!cursorInParent && el.markerFrom !== undefined && el.markerTo !== undefined) {
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

        if (!cursorInElement && el.markerFrom !== undefined && el.markerTo !== undefined) {
          decorations.push(hideDecoration.range(el.markerFrom, el.markerTo));
        }
        break;
      }

      case 'strikethroughEnd': {
        if (!cursorInParent && el.markerFrom !== undefined && el.markerTo !== undefined) {
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

        if (!cursorInElement && el.markerFrom !== undefined && el.markerTo !== undefined) {
          decorations.push(hideDecoration.range(el.markerFrom, el.markerTo));
        }
        break;
      }

      case 'inlineCodeEnd': {
        if (!cursorInParent && el.markerFrom !== undefined && el.markerTo !== undefined) {
          decorations.push(hideDecoration.range(el.markerFrom, el.markerTo));
        }
        break;
      }

      case 'link': {
        if (!cursorInElement && el.text !== undefined && el.url !== undefined) {
          // Skip multi-line links (ViewPlugin cannot create decorations that span line breaks)
          const startLine = view.state.doc.lineAt(el.from).number;
          const endLine = view.state.doc.lineAt(el.to).number;
          if (startLine === endLine) {
            decorations.push(
              Decoration.replace({
                widget: new LinkWidget(el.text, el.url, true),
              }).range(el.from, el.to)
            );
          }
        }
        break;
      }

      case 'url': {
        if (!cursorInElement && el.text !== undefined && el.url !== undefined) {
          // Skip multi-line URLs (ViewPlugin cannot create decorations that span line breaks)
          const startLine = view.state.doc.lineAt(el.from).number;
          const endLine = view.state.doc.lineAt(el.to).number;
          if (startLine === endLine) {
            decorations.push(
              Decoration.replace({
                widget: new LinkWidget(el.text, el.url, false),
              }).range(el.from, el.to)
            );
          }
        }
        break;
      }

      case 'emailUrl': {
        // Override default URL highlighting for email domains
        decorations.push(plainTextDecoration.range(el.from, el.to));
        break;
      }

      case 'image': {
        if (!cursorInElement && el.text !== undefined && el.url !== undefined) {
          // Skip multi-line images (ViewPlugin cannot create decorations that span line breaks)
          const startLine = view.state.doc.lineAt(el.from).number;
          const endLine = view.state.doc.lineAt(el.to).number;
          if (startLine === endLine) {
            decorations.push(
              Decoration.replace({
                widget: new ImageWidget(el.text, el.url),
              }).range(el.from, el.to)
            );
          }
        }
        break;
      }

      case 'codeFenceStart':
      case 'codeFenceEnd': {
        // Add code block line styling
        const lineObj = view.state.doc.lineAt(el.from);
        decorations.push(codeBlockLineDecoration.range(lineObj.from));

        // Hide fence when cursor is not on this line (line-level element)
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

        // Hide the > marker when not on cursor line (line-level element)
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
            // Style the marker but keep it visible for editing (line-level element)
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
        decorations.push(
          Decoration.replace({
            widget: new CheckboxWidget(el.checked ?? false, el.from, el.to),
          }).range(el.from, el.to)
        );
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

      case 'wikiLink': {
        if (!cursorInElement && el.text && el.target) {
          // Skip multi-line wiki-links (ViewPlugin cannot create decorations that span line breaks)
          const startLine = view.state.doc.lineAt(el.from).number;
          const endLine = view.state.doc.lineAt(el.to).number;
          if (startLine === endLine) {
            decorations.push(
              Decoration.replace({
                widget: new WikiLinkWidget(el.target, el.text),
              }).range(el.from, el.to)
            );
          }
        }
        break;
      }

      case 'math':
      case 'inlineMath': {
        if (!cursorInElement && el.text) {
          decorations.push(
            Decoration.replace({
              widget: new MathWidget(el.text),
            }).range(el.from, el.to)
          );
        }
        break;
      }

      case 'table':
        // Handled by tableDecorationField (StateField) since block replacements
        // spanning line breaks cannot be provided via ViewPlugin
        break;
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
    mouseIsDown = false;
    pendingUpdate = false;
    editorView: EditorView;

    constructor(view: EditorView) {
      this.editorView = view;
      this.decorations = buildDecorations(view);
      this.onMouseDown = this.onMouseDown.bind(this);
      this.onMouseUp = this.onMouseUp.bind(this);
      view.scrollDOM.addEventListener('mousedown', this.onMouseDown);
      document.addEventListener('mouseup', this.onMouseUp);
    }

    onMouseDown() {
      this.mouseIsDown = true;
      this.pendingUpdate = false;
    }

    onMouseUp() {
      if (!this.mouseIsDown) return;
      this.mouseIsDown = false;
      if (this.pendingUpdate) {
        this.pendingUpdate = false;
        // Dispatch a no-op transaction to trigger an update cycle so
        // CM picks up the new decorations through the normal path.
        requestAnimationFrame(() => {
          this.editorView.dispatch();
        });
      }
    }

    update(update: ViewUpdate) {
      this.editorView = update.view;
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        if (this.mouseIsDown && !update.docChanged) {
          // Defer decoration rebuild to avoid layout shifts mid-click
          this.pendingUpdate = true;
        } else {
          this.decorations = buildDecorations(update.view);
          this.pendingUpdate = false;
        }
      }
    }

    destroy() {
      this.editorView.scrollDOM.removeEventListener('mousedown', this.onMouseDown);
      document.removeEventListener('mouseup', this.onMouseUp);
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);

// StateField for table decorations (block replacements that span line breaks
// cannot be provided via ViewPlugin — they require a StateField)
const tableDecorationField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(_, tr) {
    const decorations: Range<Decoration>[] = [];
    
    // For editable tables, always show the widget so users can click and edit cells
    // Raw markdown editing can be done by selecting the table text explicitly
    syntaxTree(tr.state).iterate({
      enter(node: SyntaxNodeRef) {
        if (node.name !== 'Table') return;
        
        const rawText = tr.state.doc.sliceString(node.from, node.to);
        decorations.push(
          Decoration.replace({
            widget: new TableWidget(rawText, node.from, node.to),
            block: true,
          }).range(node.from, node.to)
        );
      },
    });

    decorations.sort((a, b) => a.from - b.from);
    return Decoration.set(decorations);
  },
  provide: (f) => EditorView.decorations.from(f),
});

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

  // Wiki-links [[target]] or [[target|display]]
  '.cm-wiki-link': {
    color: 'var(--color-accent-fg, #0969da)',
    cursor: 'pointer',
    borderBottom: '1px dashed currentColor',
    '&:hover': {
      borderBottomStyle: 'solid',
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
    cursor: 'pointer',
    '&:hover': {
      opacity: 0.7,
    },
  },

  // Horizontal rule
  '.cm-live-hr': {
    display: 'block',
    borderTop: '2px solid var(--color-border-default)',
    height: '0',
    width: '100%',
  },

  // Tables
  '.cm-live-table': {
    fontFamily: 'inherit',
    padding: '4px 0',
  },
  '.cm-live-table table': {
    borderCollapse: 'collapse',
    width: '100%',
  },
  '.cm-live-table th, .cm-live-table td': {
    border: '1px solid var(--color-border-default)',
    padding: '6px 12px',
    outline: 'none', // Remove default browser focus outline
  },
  '.cm-live-table th': {
    backgroundColor: 'var(--color-canvas-subtle)',
    fontWeight: '600',
  },

  // Frontmatter lines — reset any heading/formatting applied by the parser
  '.cm-live-frontmatter-line': {
    fontSize: '1em !important',
    fontWeight: 'normal !important',
    lineHeight: '1.5 !important',
    color: 'var(--color-fg-muted) !important',
    fontFamily: '"Monaco", "Menlo", "Ubuntu Mono", monospace',
    textDecoration: 'none !important',
  },
  '.cm-live-frontmatter-line span': {
    fontSize: 'inherit !important',
    fontWeight: 'inherit !important',
    lineHeight: 'inherit !important',
    color: 'inherit !important',
    fontFamily: 'inherit !important',
    textDecoration: 'none !important',
  },

  // Math equations
  '.cm-live-math': {
    display: 'inline-block',
    cursor: 'pointer',
    padding: '2px 4px',
    borderRadius: '3px',
    '&:hover': {
      backgroundColor: 'var(--color-canvas-subtle)',
    },
  },
  '.cm-live-math .katex': {
    fontSize: '1.1em',
  },
});

export function livePreview() {
  return [livePreviewPlugin, tableDecorationField, livePreviewStyles];
}