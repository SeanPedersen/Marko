import {
  EditorView,
  Decoration,
  ViewPlugin,
  WidgetType,
} from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder, StateField, StateEffect, Facet, Compartment } from '@codemirror/state';
import type { Range, EditorState, Transaction, Text } from '@codemirror/state';
import { convertFileSrc } from '@tauri-apps/api/core';
import { syntaxTree, ensureSyntaxTree } from '@codemirror/language';
import type { SyntaxNodeRef, Tree } from '@lezer/common';
import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { highlightTree, classHighlighter } from '@lezer/highlight';
import { render } from 'katex';
import 'katex/dist/katex.min.css';
import mermaid from 'mermaid';

// Facet + compartment for passing the active file path to the live preview extension
export const currentFileFacet = Facet.define<string, string>({
  combine: (values) => values[0] ?? '',
});
export const currentFileCompartment = new Compartment();

export function updateCurrentFile(view: EditorView, filePath: string) {
  view.dispatch({
    effects: currentFileCompartment.reconfigure(currentFileFacet.of(filePath)),
  });
}

// --- Interaction state -----------------------------------------------------
// Decoration rebuilds are suppressed while a pointer drag or an inline table
// cell edit is in progress, because rebuilding mid-interaction changes line
// heights under the pointer.
//
// This state lives in the editor state rather than in module-level flags for
// two reasons. It is per-view, so a drag in one editor instance cannot freeze
// another's decorations. And every transition is carried by a transaction, so
// decoration providers can observe the *end* of an interaction and run a
// catch-up rebuild — without that, anything suppressed during the interaction
// stays stale until an unrelated edit happens to trigger a rebuild.

const setPointerActive = StateEffect.define<boolean>();
const setCellEditing = StateEffect.define<boolean>();

interface InteractionState {
  pointerActive: boolean;
  cellEditing: boolean;
}

const INTERACTION_IDLE: InteractionState = { pointerActive: false, cellEditing: false };

const interactionState = StateField.define<InteractionState>({
  create: () => INTERACTION_IDLE,
  update(prev, tr) {
    let next = prev;
    for (const effect of tr.effects) {
      if (effect.is(setPointerActive)) next = { ...next, pointerActive: effect.value };
      else if (effect.is(setCellEditing)) next = { ...next, cellEditing: effect.value };
    }
    return next;
  },
});

// Optional read: plain-text editors mount a subset of the extensions.
function readInteraction(state: EditorState): InteractionState {
  return state.field(interactionState, false) ?? INTERACTION_IDLE;
}

function rebuildsSuppressed(state: EditorState): boolean {
  const { pointerActive, cellEditing } = readInteraction(state);
  return pointerActive || cellEditing;
}

// True when a suppressing interaction ended in this transaction. Every
// decoration provider treats this as a rebuild trigger.
function interactionEnded(tr: Transaction): boolean {
  const before = readInteraction(tr.startState);
  const after = readInteraction(tr.state);
  return (before.pointerActive && !after.pointerActive) ||
         (before.cellEditing && !after.cellEditing);
}

function dispatchInteraction(
  view: EditorView,
  effect: typeof setPointerActive | typeof setCellEditing,
  key: keyof InteractionState,
  active: boolean,
) {
  if (readInteraction(view.state)[key] === active) return;
  view.dispatch({ effects: effect.of(active) });
}

const setPointerState = (view: EditorView, active: boolean) =>
  dispatchInteraction(view, setPointerActive, 'pointerActive', active);

const setCellEditingState = (view: EditorView, active: boolean) =>
  dispatchInteraction(view, setCellEditing, 'cellEditing', active);

// Drives pointerActive. A drag can end anywhere — outside the window, on a
// cancelled gesture, or by the window losing focus — and every one of those
// has to release it, or decoration rebuilds stay suppressed indefinitely.
const pointerTracker = ViewPlugin.fromClass(
  class {
    private onPointerDown: (e: PointerEvent) => void;
    private release: () => void;

    constructor(private view: EditorView) {
      this.onPointerDown = (e) => {
        if (view.contentDOM.contains(e.target as Node)) setPointerState(view, true);
      };
      this.release = () => setPointerState(view, false);

      view.contentDOM.addEventListener('pointerdown', this.onPointerDown);
      window.addEventListener('pointerup', this.release);
      window.addEventListener('pointercancel', this.release);
      window.addEventListener('blur', this.release);
      document.addEventListener('visibilitychange', this.release);
    }

    destroy() {
      this.view.contentDOM.removeEventListener('pointerdown', this.onPointerDown);
      window.removeEventListener('pointerup', this.release);
      window.removeEventListener('pointercancel', this.release);
      window.removeEventListener('blur', this.release);
      document.removeEventListener('visibilitychange', this.release);
    }
  }
);

const interactionTracking = [interactionState, pointerTracker];

// Resolve a markdown image URL to a loadable src.
// Remote/data URLs are returned as-is; relative/absolute local paths are
// converted to the Tauri asset:// protocol so the webview can read them.
function resolveImageUrl(url: string, currentFilePath: string): string {
  if (/^https?:\/\/|^data:|^asset:\/\//.test(url)) return url;
  if (!currentFilePath) return url;

  const lastSlash = Math.max(currentFilePath.lastIndexOf('/'), currentFilePath.lastIndexOf('\\'));
  const dir = lastSlash >= 0 ? currentFilePath.slice(0, lastSlash) : '';

  // Windows absolute paths start with a drive letter (e.g. C:\)
  const isAbsolute = url.startsWith('/') || /^[A-Za-z]:[/\\]/.test(url);
  const joined = isAbsolute ? url : dir + '/' + url;

  // Normalise . and .. segments
  const parts = joined.split(/[/\\]/);
  const normalized: string[] = [];
  for (const part of parts) {
    if (part === '..') normalized.pop();
    else if (part !== '.') normalized.push(part);
  }

  return convertFileSrc(normalized.join('/'));
}

// Cache of loaded language parsers: name → parser (null while loading or unavailable)
const languageCache = new Map<string, ReturnType<LanguageDescription['load']> extends Promise<infer T> ? T : never>();
const languageLoading = new Set<string>();

function getLanguageDescription(name: string): LanguageDescription | null {
  if (!name) return null;
  return LanguageDescription.matchLanguageName(languages, name, true) ?? null;
}

// Load a language async and return its parser synchronously if already cached
function getLoadedParser(name: string, view: EditorView): import('@lezer/common').Parser | null {
  if (languageCache.has(name)) {
    return (languageCache.get(name) as any)?.language?.parser ?? null;
  }
  if (languageLoading.has(name)) return null;

  const desc = getLanguageDescription(name);
  if (!desc) return null;

  languageLoading.add(name);
  desc.load().then((support) => {
    languageCache.set(name, support as any);
    languageLoading.delete(name);
    // Trigger decoration rebuild now that language is loaded
    view.dispatch({ effects: [] });
  }).catch(() => {
    languageLoading.delete(name);
  });

  return null;
}
// Render inline markdown into an element. Handles bold, italic, strikethrough,
// inline code, images, wiki-links and standard links — the same inline tokens
// the editor's main live-preview supports, so block-replaced contexts (e.g.
// table cells) render consistently.
//
// Patterns are tried in priority order; the earliest match in the remaining
// text wins, with array order resolving ties so more-specific tokens
// (image > wiki-link > link > bold-italic > bold > italic) take precedence.
type InlinePattern = {
  regex: RegExp;
  build: (match: RegExpExecArray) => Node;
};

const INLINE_PATTERNS: InlinePattern[] = [
  // ![alt](url) — image
  {
    regex: /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    build: (m) => {
      const img = document.createElement('img');
      img.alt = m[1];
      img.src = m[2];
      img.className = 'cm-live-image';
      return img;
    },
  },
  // [[target]] or [[target|display]] — wiki-link
  {
    regex: /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
    build: (m) => {
      const target = m[1].trim();
      const display = (m[2] ?? m[1]).trim();
      const span = document.createElement('span');
      span.className = 'cm-wiki-link';
      span.textContent = display;
      const dispatch = (newTab: boolean) => {
        span.dispatchEvent(new CustomEvent('marko:wiki-link', {
          bubbles: true,
          detail: { target, newTab },
        }));
      };
      span.addEventListener('mousedown', (e) => {
        // Stop the parent contentEditable cell from grabbing focus so the
        // click can navigate instead of dropping into edit mode.
        e.preventDefault();
        e.stopPropagation();
      });
      span.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dispatch(false);
      });
      span.addEventListener('auxclick', (e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        e.stopPropagation();
        dispatch(true);
      });
      return span;
    },
  },
  // [text](url) — markdown link
  {
    regex: /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    build: (m) => {
      const url = m[2].trim();
      const span = document.createElement('span');
      span.className = 'cm-live-link';
      renderInlineMarkdown(span, m[1]);
      const dispatch = (newTab: boolean) => {
        span.dispatchEvent(new CustomEvent('marko:link', {
          bubbles: true,
          detail: { url, newTab },
        }));
      };
      span.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      span.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dispatch(false);
      });
      span.addEventListener('auxclick', (e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        e.stopPropagation();
        dispatch(true);
      });
      return span;
    },
  },
  // ***bold italic***
  {
    regex: /\*\*\*(.+?)\*\*\*/g,
    build: (m) => {
      const span = document.createElement('span');
      span.style.fontWeight = 'bold';
      span.style.fontStyle = 'italic';
      span.textContent = m[1];
      return span;
    },
  },
  // **bold**
  {
    regex: /\*\*(.+?)\*\*/g,
    build: (m) => {
      const span = document.createElement('span');
      span.style.fontWeight = 'bold';
      span.textContent = m[1];
      return span;
    },
  },
  // *italic*
  {
    regex: /\*(.+?)\*/g,
    build: (m) => {
      const span = document.createElement('span');
      span.style.fontStyle = 'italic';
      span.textContent = m[1];
      return span;
    },
  },
  // ~~strikethrough~~
  {
    regex: /~~(.+?)~~/g,
    build: (m) => {
      const span = document.createElement('span');
      span.style.textDecoration = 'line-through';
      span.textContent = m[1];
      return span;
    },
  },
  // `code`
  {
    regex: /`([^`]+)`/g,
    build: (m) => {
      const span = document.createElement('span');
      span.className = 'cm-live-inline-code';
      span.textContent = m[1];
      return span;
    },
  },
];

function renderInlineMarkdown(el: HTMLElement, text: string): void {
  if (!text) {
    el.textContent = '';
    return;
  }

  let pos = 0;
  while (pos < text.length) {
    let best: { start: number; match: RegExpExecArray; pattern: InlinePattern } | null = null;
    for (const pattern of INLINE_PATTERNS) {
      pattern.regex.lastIndex = pos;
      const m = pattern.regex.exec(text);
      if (!m) continue;
      if (best === null || m.index < best.start) {
        best = { start: m.index, match: m, pattern };
        if (m.index === pos) break;
      }
    }

    if (!best) {
      el.appendChild(document.createTextNode(text.slice(pos)));
      return;
    }

    if (best.start > pos) {
      el.appendChild(document.createTextNode(text.slice(pos, best.start)));
    }
    el.appendChild(best.pattern.build(best.match));
    pos = best.start + best.match[0].length;
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
      span.dispatchEvent(new CustomEvent('marko:link', {
        bubbles: true,
        detail: { url: this.url, newTab: false },
      }));
    });
    span.addEventListener('auxclick', (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      e.stopPropagation();
      span.dispatchEvent(new CustomEvent('marko:link', {
        bubbles: true,
        detail: { url: this.url, newTab: true },
      }));
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

class InlineCodeWidget extends WidgetType {
  constructor(
    readonly code: string,
    readonly from: number,
    readonly to: number
  ) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-live-inline-code';
    span.textContent = this.code;
    span.style.cursor = 'text';

    span.addEventListener('mousedown', (e) => {
      e.preventDefault();
      // Estimate which character within the code text was clicked by
      // comparing the click X to the widget's bounding rect.
      const rect = span.getBoundingClientRect();
      const ratio = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0;
      const clamped = Math.max(0, Math.min(1, ratio));
      // Map ratio to position within the content (from+1 to to-1, exclusive of backticks)
      const contentLen = this.to - this.from - 2; // exclude opening + closing backtick
      const offset = Math.round(clamped * contentLen);
      const anchor = this.from + 1 + offset; // +1 to skip opening backtick
      view.dispatch({ selection: { anchor } });
      view.focus();
    });

    return span;
  }

  ignoreEvent(event: Event): boolean {
    return event.type !== 'mousedown';
  }

  eq(other: InlineCodeWidget): boolean {
    return this.code === other.code && this.from === other.from && this.to === other.to;
  }
}

class MathWidget extends WidgetType {
  constructor(readonly latex: string, readonly from: number) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement('span');
    container.className = 'cm-live-math';
    container.style.cursor = 'pointer';

    container.addEventListener('mousedown', (e) => {
      e.preventDefault();
      // Move cursor into the math expression — decoration will be removed
      // by the next buildDecorations call (cursorInElement becomes true)
      view.dispatch({ selection: { anchor: this.from + 1 } });
      view.focus();
    });

    try {
      render(this.latex, container, {
        throwOnError: false,
        displayMode: false,
        strict: false,
      });
    } catch {
      container.textContent = `$${this.latex}$`;
    }

    return container;
  }

  ignoreEvent(event: Event): boolean {
    return event.type !== 'mousedown';
  }

  eq(other: MathWidget): boolean {
    return this.latex === other.latex && this.from === other.from;
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

// Block widgets must not capture their document offsets: doing so makes eq()
// position-sensitive, so any edit *above* the widget recreates its DOM and
// forces a re-measure — the main source of height churn during typing.
// Instead the widget asks the view where its own DOM currently sits.
function widgetRange(view: EditorView, dom: HTMLElement, expected: string) {
  const from = view.posAtDOM(dom);
  const to = from + expected.length;
  if (from < 0 || to > view.state.doc.length) return null;
  // Only write back if the source still reads as this widget rendered it —
  // a mismatch means the lookup is off, and writing would corrupt the file.
  if (view.state.doc.sliceString(from, to) !== expected) return null;
  return { from, to };
}

function parseTableRow(row: string): string[] {
  const trimmed = row.replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let current = '';
  let inCode = false;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === '`') {
      inCode = !inCode;
      current += ch;
    } else if (ch === '\\' && i + 1 < trimmed.length && trimmed[i + 1] === '|') {
      current += '|';
      i++;
    } else if (ch === '|' && !inCode) {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

function serializeTableRow(cells: string[]): string {
  return '| ' + cells.join(' | ') + ' |';
}

// Seed values for CM's height oracle so block widgets that have not been
// measured yet don't make it guess a single text line — bad guesses are what
// make the scroll position jump when an off-screen widget scrolls into view.
const TABLE_ROW_ESTIMATED_HEIGHT_PX = 34;
const DEFAULT_LINE_ESTIMATED_HEIGHT_PX = 22;

class TableWidget extends WidgetType {
  constructor(readonly rawText: string) {
    super();
  }

  get estimatedHeight(): number {
    const rows = this.rawText.split('\n').filter((l) => l.trim()).length;
    // The alignment row renders as a border, not a row.
    return Math.max(1, rows - 1) * TABLE_ROW_ESTIMATED_HEIGHT_PX;
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement('div');
    container.className = 'cm-live-table';

    // Tracks the source text this widget currently stands for. Cell commits
    // rewrite the document in place while the widget instance is kept alive,
    // so the length used to locate the widget has to follow along.
    let currentRaw = this.rawText;

    const lines = this.rawText.split('\n').filter((l) => l.trim());
    if (lines.length < 2) return container;

    const headerCells = parseTableRow(lines[0]);
    const alignRow = parseTableRow(lines[1]);
    const colCount = headerCells.length;

    const alignments: ('left' | 'center' | 'right' | null)[] = alignRow.map((cell) => {
      const left = cell.startsWith(':');
      const right = cell.endsWith(':');
      if (left && right) return 'center';
      if (right) return 'right';
      if (left) return 'left';
      return null;
    });

    // Build a mutable grid of cell values (row 0 = header, row 1+ = body)
    const grid: string[][] = [headerCells];
    for (let r = 2; r < lines.length; r++) {
      const cells = parseTableRow(lines[r]);
      // Pad or truncate to match column count
      while (cells.length < colCount) cells.push('');
      grid.push(cells.slice(0, colCount));
    }

    const table = document.createElement('table');
    table.style.tableLayout = 'fixed';

    // Colgroup for resizable widths
    const colgroup = document.createElement('colgroup');
    const defaultWidth = 100 / colCount;
    for (let i = 0; i < colCount; i++) {
      const col = document.createElement('col');
      col.style.width = defaultWidth + '%';
      colgroup.appendChild(col);
    }
    table.appendChild(colgroup);

    // Commit a cell edit back to the markdown source
    const commitCell = (rowIdx: number, colIdx: number, newText: string) => {
      const oldText = grid[rowIdx][colIdx];
      if (newText === oldText) return;
      grid[rowIdx][colIdx] = newText;

      // Rebuild the full table markdown
      const newLines: string[] = [];
      newLines.push(serializeTableRow(grid[0]));
      newLines.push(lines[1]); // keep alignment row as-is
      for (let r = 1; r < grid.length; r++) {
        newLines.push(serializeTableRow(grid[r]));
      }
      const newRaw = newLines.join('\n');
      const range = widgetRange(view, container, currentRaw);
      if (!range) return;

      view.dispatch({ changes: { ...range, insert: newRaw } });
      currentRaw = newRaw;
    };

    // Create an editable cell
    const makeCell = (tag: 'th' | 'td', rowIdx: number, colIdx: number) => {
      const cell = document.createElement(tag);
      cell.contentEditable = 'true';
      cell.spellcheck = false;
      renderInlineMarkdown(cell, grid[rowIdx][colIdx]);
      if (alignments[colIdx]) cell.style.textAlign = alignments[colIdx]!;

      cell.addEventListener('focus', () => {
        // Freeze widget rebuilds for as long as a cell holds focus — a rebuild
        // recreates the table DOM and would drop the caret mid-edit.
        setCellEditingState(view, true);
        // Show raw markdown text for editing
        cell.textContent = grid[rowIdx][colIdx];
        // Move caret to end
        const range = document.createRange();
        range.selectNodeContents(cell);
        range.collapse(false);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      });

      cell.addEventListener('blur', () => {
        const newText = cell.textContent?.trim() ?? '';
        commitCell(rowIdx, colIdx, newText);
        // Re-render inline markdown
        cell.innerHTML = '';
        renderInlineMarkdown(cell, newText);
        // Tab moves focus to a sibling cell, so only release the freeze once
        // focus has actually left the table — that release is what triggers
        // the catch-up rebuild.
        queueMicrotask(() => {
          if (!container.contains(document.activeElement)) setCellEditingState(view, false);
        });
      });

      cell.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          cell.blur();
        }
        if (e.key === 'Tab') {
          e.preventDefault();
          // Move to next/prev cell
          const nextCol = e.shiftKey ? colIdx - 1 : colIdx + 1;
          const nextRow = nextCol < 0 ? rowIdx - 1 : nextCol >= colCount ? rowIdx + 1 : rowIdx;
          const wrappedCol = nextCol < 0 ? colCount - 1 : nextCol >= colCount ? 0 : nextCol;
          if (nextRow >= 0 && nextRow < grid.length) {
            const target = table.querySelector(`[data-row="${nextRow}"][data-col="${wrappedCol}"]`) as HTMLElement;
            target?.focus();
          }
        }
        if (e.key === 'Escape') {
          // Restore original text, blur
          cell.textContent = grid[rowIdx][colIdx];
          cell.blur();
        }
      });

      cell.dataset.row = String(rowIdx);
      cell.dataset.col = String(colIdx);
      return cell;
    };

    // Header
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    for (let i = 0; i < colCount; i++) {
      const th = makeCell('th', 0, i);
      // Resize handle (except after last column)
      if (i < colCount - 1) {
        const handle = document.createElement('div');
        handle.className = 'cm-table-resize-handle';
        handle.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const cols = colgroup.children;
          const leftCol = cols[i] as HTMLElement;
          const rightCol = cols[i + 1] as HTMLElement;
          const tableRect = table.getBoundingClientRect();
          const tableWidth = tableRect.width;
          const startX = e.clientX;
          const startLeftPct = parseFloat(leftCol.style.width);
          const startRightPct = parseFloat(rightCol.style.width);
          const MIN_COL_PCT = 5;

          const onMove = (ev: MouseEvent) => {
            const dx = ev.clientX - startX;
            const deltaPct = (dx / tableWidth) * 100;
            const newLeft = Math.max(MIN_COL_PCT, startLeftPct + deltaPct);
            const newRight = Math.max(MIN_COL_PCT, startRightPct - deltaPct);
            // Only apply if both stay above minimum
            if (newLeft >= MIN_COL_PCT && newRight >= MIN_COL_PCT) {
              leftCol.style.width = newLeft + '%';
              rightCol.style.width = newRight + '%';
            }
          };
          const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
          };
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        });
        th.style.position = 'relative';
        th.appendChild(handle);
      }
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Body
    if (grid.length > 1) {
      const tbody = document.createElement('tbody');
      for (let r = 1; r < grid.length; r++) {
        const tr = document.createElement('tr');
        for (let i = 0; i < colCount; i++) {
          tr.appendChild(makeCell('td', r, i));
        }
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
    }

    // Clicks inside the table should NOT move cursor to raw markdown
    container.addEventListener('mousedown', (e) => {
      e.stopPropagation();
    });

    container.appendChild(table);
    return container;
  }

  ignoreEvent(event: Event): boolean {
    // Let all events through to our DOM handlers
    return true;
  }

  eq(other: TableWidget): boolean {
    return this.rawText === other.rawText;
  }
}

// --- HTML block rendering ---

// Clicking a block widget puts the cursor at the start of its source, which
// reveals the raw markdown. The source position is resolved from the DOM so
// the widget stays position-independent.
function focusWidgetSource(view: EditorView, container: HTMLElement) {
  const from = view.posAtDOM(container);
  if (from < 0) return;
  view.dispatch({ selection: { anchor: from } });
  view.focus();
}

class HtmlBlockWidget extends WidgetType {
  constructor(readonly html: string) {
    super();
  }

  get estimatedHeight(): number {
    return this.html.split('\n').length * DEFAULT_LINE_ESTIMATED_HEIGHT_PX;
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement('div');
    container.className = 'cm-live-html-block';

    container.addEventListener('mousedown', (e) => {
      e.preventDefault();
      focusWidgetSource(view, container);
    });

    container.innerHTML = this.html;
    return container;
  }

  ignoreEvent(event: Event): boolean {
    return event.type !== 'mousedown';
  }

  eq(other: HtmlBlockWidget): boolean {
    return this.html === other.html;
  }
}

// --- Mermaid rendering ---
let mermaidCurrentTheme: 'default' | 'dark' | null = null;
let mermaidRenderCount = 0;

function ensureMermaidInitialized(isDark: boolean): void {
  const theme = isDark ? 'dark' : 'default';
  if (mermaidCurrentTheme === theme) return;
  mermaidCurrentTheme = theme;
  mermaid.initialize({ startOnLoad: false, theme });
}

function resolveIsDark(): boolean {
  const attr = document.documentElement.dataset.theme;
  if (attr === 'dark') return true;
  if (attr === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

const MERMAID_ESTIMATED_HEIGHT_PX = 240;

class MermaidWidget extends WidgetType {
  constructor(readonly code: string) {
    super();
  }

  get estimatedHeight(): number {
    return MERMAID_ESTIMATED_HEIGHT_PX;
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement('div');
    container.className = 'cm-live-mermaid';

    container.addEventListener('mousedown', (e) => {
      e.preventDefault();
      focusWidgetSource(view, container);
    });

    ensureMermaidInitialized(resolveIsDark());
    const id = `cm-mermaid-${++mermaidRenderCount}`;

    mermaid.render(id, this.code || 'graph LR\n  A --> B').then(({ svg }) => {
      container.innerHTML = svg;
    }).catch(() => {
      container.textContent = '⚠ Invalid mermaid diagram';
      container.classList.add('cm-live-mermaid-error');
    });

    return container;
  }

  ignoreEvent(event: Event): boolean {
    return event.type !== 'mousedown';
  }

  eq(other: MermaidWidget): boolean {
    return this.code === other.code;
  }
}

// Hide decoration — replaces text with nothing (zero-width).
// Decoration.replace tells CM about the size change so its height oracle
// stays accurate (unlike mark + display:none which hides content without
// CM's knowledge).
const hideDecoration = Decoration.replace({});

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

// When cursor is on an ATX heading, pull "## " left into the padding gutter by
// making the marker span 0-width and shifting it with position:relative.
const MARKER_BASE = 'display:inline-block;width:0;overflow:visible;white-space:pre;position:relative';
const headingActiveMarkerDecorations = [
  Decoration.mark({ attributes: { style: `${MARKER_BASE};left:-2ch` } }), // H1: "# "
  Decoration.mark({ attributes: { style: `${MARKER_BASE};left:-3ch` } }), // H2: "## "
  Decoration.mark({ attributes: { style: `${MARKER_BASE};left:-4ch` } }), // H3: "### "
  Decoration.mark({ attributes: { style: `${MARKER_BASE};left:-5ch` } }), // H4: "#### "
  Decoration.mark({ attributes: { style: `${MARKER_BASE};left:-6ch` } }), // H5: "##### "
  Decoration.mark({ attributes: { style: `${MARKER_BASE};left:-7ch` } }), // H6: "###### "
];


const normalizeHeadingDecoration = Decoration.line({ class: 'cm-live-normalize-heading' });
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
  language?: string; // For code blocks: the language identifier
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
// Lines occupied by fenced code, which the regex-based finders all skip.
function collectCodeBlockLines(view: EditorView, elements: ParsedElement[]): Set<number> {
  const lines = new Set<number>();
  for (const el of elements) {
    if (el.type !== 'codeBlock') continue;
    const endLine = view.state.doc.lineAt(el.to).number;
    for (let i = el.line; i <= endLine; i++) lines.add(i);
  }
  return lines;
}

// List items, inline formatting and already-detected URLs do not block plain
// URL detection: Lezer's URL node can stop early, so a plain-URL match is
// allowed to span them.
const URL_TRANSPARENT_TYPES = new Set([
  'listItem',
  'bold', 'boldEnd',
  'italic', 'italicEnd',
  'strikethrough', 'strikethroughEnd',
  'inlineCode', 'inlineCodeEnd',
  'url', 'emailUrl',
]);

// Ranges already claimed by other elements, bucketed by the line each element
// starts on. Stored as intervals rather than one key per covered character:
// the per-character form allocated a string for nearly every character in the
// document on every keystroke, which dominated the entire parse.
function buildCoveredRanges(elements: ParsedElement[]): Map<number, Range2[]> {
  const covered = new Map<number, Range2[]>();
  for (const el of elements) {
    if (URL_TRANSPARENT_TYPES.has(el.type)) continue;
    const bucket = covered.get(el.line);
    if (bucket) bucket.push({ from: el.from, to: el.to });
    else covered.set(el.line, [{ from: el.from, to: el.to }]);
  }
  return covered;
}

interface Range2 { from: number; to: number }

function overlapsCovered(covered: Map<number, Range2[]>, line: number, from: number, to: number): boolean {
  const bucket = covered.get(line);
  if (!bucket) return false;
  return bucket.some((r) => from < r.to && to > r.from);
}

function findPlainUrls(view: EditorView, existingElements: ParsedElement[]): ParsedElement[] {
  const elements: ParsedElement[] = [];
  const doc = view.state.doc;
  // Match URLs with protocol, www. prefix, or bare domains (word.tld)
  const urlRegex = /(?:https?:\/\/|www\.)[^\s<>"{}|\\^`\[\]]+|(?<![.@/\\\w])(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}(?:\/[^\s<>"{}|\\^`\[\]]*)?/g;

  const coveredRanges = buildCoveredRanges(existingElements);

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

      if (!overlapsCovered(coveredRanges, lineNum, startPos, endPos)) {
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

  const codeBlockLines = collectCodeBlockLines(view, existingElements);

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

  const codeBlockLines = collectCodeBlockLines(view, existingElements);

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

  const codeBlockLines = collectCodeBlockLines(view, existingElements);

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
    // Look for $ followed by non-whitespace, then content, then $
    const inlineMathRegex = /\$(?!\$)([^\s$][^$]*?)\$/g;
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

function parseMarkdownElements(view: EditorView, tree: Tree): ParsedElement[] {
  const elements: ParsedElement[] = [];
  const doc = view.state.doc;

  tree.iterate({
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
          const markerText = doc.sliceString(endLineObj.from, endLineObj.to).trim();
          // A single '-' is ambiguous with a list item start — reset heading styling
          if (markerText === '-') {
            const firstLineObj = doc.lineAt(from);
            elements.push({ type: 'normalizeHeading', from, to, line: firstLineObj.number });
            break;
          }
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

          // Extract language from the opening fence line (e.g., ```javascript)
          const firstLineText = doc.lineAt(from).text;
          const langMatch = firstLineText.match(/^```(\w+)?/);
          const language = langMatch?.[1] || '';

          elements.push({
            type: 'codeBlock',
            from,
            to,
            line: startLine,
            language,
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

// --- Parse cache -----------------------------------------------------------
// The element list is a pure function of (document, syntax tree). Caching it
// keeps cursor movement off the parser: only the much cheaper decoration
// assembly re-runs. `coveringLines` maps a line to the elements whose range
// (including the parent range recorded on end markers) touches that line —
// exactly the elements whose cursor-dependent predicates can change when the
// caret is on that line.

interface ParseCache {
  doc: Text;
  tree: Tree;
  elements: ParsedElement[];
  startLines: Map<number, number[]>;
  coveringLines: Map<number, number[]>;
}

const EMPTY_INDICES: number[] = [];

// Synchronous parse budget per rebuild. Kept short so a large file cannot
// stall a keystroke; whatever the background parser finishes later arrives as
// a tree change, which triggers its own rebuild.
const PARSE_BUDGET_MS = 5;

function indexElements(doc: Text, elements: ParsedElement[]): Pick<ParseCache, 'startLines' | 'coveringLines'> {
  const startLines = new Map<number, number[]>();
  const coveringLines = new Map<number, number[]>();

  const push = (map: Map<number, number[]>, line: number, index: number) => {
    const bucket = map.get(line);
    if (bucket) bucket.push(index);
    else map.set(line, [index]);
  };

  const clamp = (pos: number) => Math.max(0, Math.min(pos, doc.length));

  elements.forEach((el, index) => {
    push(startLines, el.line, index);
    const from = clamp(Math.min(el.from, el.parentFrom ?? el.from));
    const to = clamp(Math.max(el.to, el.parentTo ?? el.to));
    const firstLine = doc.lineAt(from).number;
    const lastLine = doc.lineAt(to).number;
    for (let line = firstLine; line <= lastLine; line++) push(coveringLines, line, index);
  });

  return { startLines, coveringLines };
}

function parseCache(view: EditorView, previous: ParseCache | null): ParseCache {
  const doc = view.state.doc;
  const tree = ensureSyntaxTree(view.state, doc.length, PARSE_BUDGET_MS) ?? syntaxTree(view.state);
  if (previous && previous.doc === doc && previous.tree === tree) return previous;

  let elements: ParsedElement[] = [];
  try {
    elements = parseMarkdownElements(view, tree);
  } catch (error) {
    console.error('Error parsing markdown elements:', error);
  }

  return { doc, tree, elements, ...indexElements(doc, elements) };
}

// Identifies the cursor-dependent inputs of a decoration build. Two positions
// with the same key produce the same decorations, so the rebuild can be
// skipped entirely — which is most caret movement through ordinary prose.
function revealKeyFor(state: EditorState, cache: ParseCache): string {
  const cursorPos = state.selection.main.head;
  const cursorLine = state.doc.lineAt(cursorPos).number;
  const parts: (string | number)[] = [];

  for (const index of cache.startLines.get(cursorLine) ?? EMPTY_INDICES) {
    parts.push('L', index);
  }
  for (const index of cache.coveringLines.get(cursorLine) ?? EMPTY_INDICES) {
    const el = cache.elements[index];
    parts.push('C', index);
    if (cursorPos >= el.from && cursorPos <= el.to) parts.push('i');
    if (el.parentFrom !== undefined && el.parentTo !== undefined &&
        cursorPos >= el.parentFrom && cursorPos <= el.parentTo) parts.push('p');
  }

  return parts.join(':');
}

function buildDecorations(view: EditorView, cache: ParseCache): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const decorations: Range<Decoration>[] = [];
  const elements = cache.elements;

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
      case 'normalizeHeading': {
        // Reset heading token styles on both lines of the setext heading
        const firstLineObj = view.state.doc.lineAt(el.from);
        const secondLineObj = view.state.doc.lineAt(el.to);
        decorations.push(normalizeHeadingDecoration.range(firstLineObj.from));
        decorations.push(normalizeHeadingDecoration.range(secondLineObj.from));
        break;
      }

      case 'heading': {
        // Add line decoration for heading style
        const lineObj = view.state.doc.lineAt(el.from);
        if (el.level && el.level >= 1 && el.level <= 6) {
          decorations.push(headingDecorations[el.level - 1].range(lineObj.from));
        }

        const isAtxHeading = el.markerFrom !== undefined && el.markerFrom === el.from;
        if (!isOnCursorLine && el.markerFrom !== undefined && el.markerTo !== undefined && el.markerFrom < el.markerTo) {
          // Hide the # markers when cursor is not on this line
          decorations.push(hideDecoration.range(el.markerFrom, el.markerTo));
        } else if (isAtxHeading && isOnCursorLine && el.level && el.markerFrom !== undefined && el.markerTo !== undefined && el.markerFrom < el.markerTo) {
          // Cursor on line: render marker in the left padding gutter (0-width span shifted left)
          decorations.push(headingActiveMarkerDecorations[el.level - 1].range(el.markerFrom, el.markerTo));
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
        if (!cursorInElement && el.text !== undefined) {
          decorations.push(
            Decoration.replace({
              widget: new InlineCodeWidget(el.text, el.from, el.to),
            }).range(el.from, el.to)
          );
        } else if (cursorInElement && el.markerTo !== undefined) {
          // Cursor is inside: show raw syntax, style content region
          const markerLen = el.markerTo - el.from;
          const contentFrom = el.markerTo;
          const contentTo = el.to - markerLen;
          if (contentFrom < contentTo) {
            decorations.push(inlineCodeDecoration.range(contentFrom, contentTo));
          }
        }
        break;
      }

      case 'inlineCodeEnd': {
        // No-op: handled entirely by inlineCode case above
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
            const currentFile = view.state.facet(currentFileFacet);
            const resolvedUrl = resolveImageUrl(el.url, currentFile);
            decorations.push(
              Decoration.replace({
                widget: new ImageWidget(el.text, resolvedUrl),
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

        // Syntax highlighting: parse code content with the language's parser
        if (el.language) {
          const parser = getLoadedParser(el.language, view);
          if (parser) {
            // Code content is between the end of the opening fence line and the start of closing fence line
            const openFenceLine = view.state.doc.line(startLine);
            const closeFenceLine = view.state.doc.line(endLine);
            const codeFrom = openFenceLine.to + 1; // char after newline
            const codeTo = closeFenceLine.from > codeFrom ? closeFenceLine.from - 1 : codeFrom;

            if (codeTo > codeFrom) {
              const codeText = view.state.doc.sliceString(codeFrom, codeTo);
              const tree = parser.parse(codeText);
              highlightTree(tree, classHighlighter, (from, to, classes) => {
                if (classes && from < to) {
                  decorations.push(
                    Decoration.mark({ class: classes }).range(codeFrom + from, codeFrom + to)
                  );
                }
              });
            }
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
              widget: new MathWidget(el.text, el.from),
            }).range(el.from, el.to)
          );
        }
        break;
      }

      case 'table':
        // Handled by blockWidgetField (StateField) since block replacements
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
    private cache: ParseCache;
    private revealKey: string;

    constructor(view: EditorView) {
      this.cache = parseCache(view, null);
      this.revealKey = revealKeyFor(view.state, this.cache);
      this.decorations = buildDecorations(view, this.cache);
    }

    update(update: ViewUpdate) {
      // Reparse only when the document or the syntax tree actually changed;
      // cursor movement reuses the cached element list.
      const previous = this.cache;
      this.cache = parseCache(update.view, this.cache);
      const parseChanged = this.cache !== previous;

      // An interaction ending is a rebuild trigger in its own right: whatever
      // was suppressed while it ran has to be caught up here.
      const resumed = update.transactions.some(interactionEnded);

      if (!parseChanged && !resumed) {
        if (rebuildsSuppressed(update.state)) return;
        // Decorations depend on the cursor only through the elements covering
        // its line, so an unchanged reveal key means an unchanged result.
        const key = revealKeyFor(update.state, this.cache);
        if (key === this.revealKey) return;
        this.revealKey = key;
      } else {
        this.revealKey = revealKeyFor(update.state, this.cache);
      }

      this.decorations = buildDecorations(update.view, this.cache);
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);

// --- Block widget fields ---------------------------------------------------
// Block replacements span line breaks, which a ViewPlugin cannot provide, so
// each lives in a StateField. The three differ only in which syntax node they
// match and which widget they build; the rebuild policy is shared so the
// catch-up rebuild on interaction end cannot be forgotten in one of them.

type BlockWidgetBuilder = (state: EditorState, from: number, to: number) => Decoration | null;

// One builder per block node type. They share a single tree traversal — three
// separate fields meant three full-document walks per keystroke.
const BLOCK_WIDGET_BUILDERS: Record<string, BlockWidgetBuilder> = {
  Table: (state, from, to) =>
    Decoration.replace({
      widget: new TableWidget(state.doc.sliceString(from, to)),
      block: true,
    }),

  FencedCode: (state, from, to) => {
    const openFenceLine = state.doc.lineAt(from);
    const langMatch = openFenceLine.text.match(/^(`{3,}|~{3,})(\w+)?/);
    if (langMatch?.[2]?.toLowerCase() !== 'mermaid') return null;

    const closeFenceLine = state.doc.lineAt(to);
    const codeFrom = openFenceLine.to + 1;
    const codeTo = closeFenceLine.from > codeFrom ? closeFenceLine.from - 1 : codeFrom;
    const code = codeFrom < codeTo ? state.doc.sliceString(codeFrom, codeTo) : '';

    return Decoration.replace({ widget: new MermaidWidget(code), block: true });
  },

  HTMLBlock: (state, from, to) =>
    Decoration.replace({
      widget: new HtmlBlockWidget(state.doc.sliceString(from, to)),
      block: true,
    }),
};

function collectBlockWidgets(state: EditorState): DecorationSet {
  const cursorPos = state.selection.main.head;
  const decorations: Range<Decoration>[] = [];

  syntaxTree(state).iterate({
    enter(node: SyntaxNodeRef) {
      const build = BLOCK_WIDGET_BUILDERS[node.name];
      if (!build) return;
      // Cursor inside the block reveals the raw markdown.
      if (cursorPos >= node.from && cursorPos <= node.to) return;
      const decoration = build(state, node.from, node.to);
      if (decoration) decorations.push(decoration.range(node.from, node.to));
    },
  });

  decorations.sort((a, b) => a.from - b.from);
  return Decoration.set(decorations);
}

const blockWidgetField = StateField.define<DecorationSet>({
  create: collectBlockWidgets,
  update(prev, tr) {
    // Whatever was suppressed during the interaction is caught up here.
    if (interactionEnded(tr)) return collectBlockWidgets(tr.state);
    if (rebuildsSuppressed(tr.state)) return prev.map(tr.changes);

    const selectionChanged = !tr.newSelection.eq(tr.startState.selection);
    const treeChanged = syntaxTree(tr.startState) !== syntaxTree(tr.state);
    if (!tr.docChanged && !selectionChanged && !treeChanged) return prev.map(tr.changes);

    return collectBlockWidgets(tr.state);
  },
  provide: (f) => EditorView.decorations.from(f),
});

// Styles for live preview elements
export const livePreviewStyles = EditorView.baseTheme({
  // Reset heading token styles when a setext marker is a single '-'
  // !important needed to beat HighlightStyle's direct token-level font-size
  '.cm-live-normalize-heading span': {
    fontSize: '1em !important',
    fontWeight: 'normal !important',
  },

  // Headings - use line-height for spacing instead of margins
  // (margins break CodeMirror's click position calculations).
  // padding-left reserves gutter space for the "## " marker so heading text
  // stays at a fixed x-position whether the cursor is on the line or not.
  '.cm-live-h1': {
    fontSize: '1.5em',
    fontWeight: '700',
    lineHeight: '1.8',
    paddingLeft: '2ch',
  },
  '.cm-live-h2': {
    fontSize: '1.3em',
    fontWeight: '600',
    lineHeight: '1.7',
    paddingLeft: '3ch',
  },
  '.cm-live-h3': {
    fontSize: '1.15em',
    fontWeight: '600',
    lineHeight: '1.6',
    paddingLeft: '4ch',
  },
  '.cm-live-h4': {
    fontSize: '1.05em',
    fontWeight: '600',
    lineHeight: '1.5',
    paddingLeft: '5ch',
  },
  '.cm-live-h5': {
    fontSize: '1em',
    fontWeight: '600',
    lineHeight: '1.5',
    paddingLeft: '6ch',
  },
  '.cm-live-h6': {
    fontSize: '0.95em',
    fontWeight: '600',
    color: 'var(--color-fg-muted)',
    lineHeight: '1.5',
    paddingLeft: '7ch',
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
  '.cm-live-code-block-line.cm-activeLine': {
    backgroundColor: 'var(--color-canvas-subtle)',
  },

  // Syntax highlighting inside code blocks (tok-* classes from classHighlighter)
  '.cm-live-code-block-line .tok-keyword': { color: '#c678dd' },
  '.cm-live-code-block-line .tok-operator': { color: '#56b6c2' },
  '.cm-live-code-block-line .tok-punctuation': { color: 'var(--color-fg-muted)' },
  '.cm-live-code-block-line .tok-string': { color: '#98c379' },
  '.cm-live-code-block-line .tok-string2': { color: '#98c379' },
  '.cm-live-code-block-line .tok-number': { color: '#d19a66' },
  '.cm-live-code-block-line .tok-bool': { color: '#d19a66' },
  '.cm-live-code-block-line .tok-null': { color: '#d19a66' },
  '.cm-live-code-block-line .tok-atom': { color: '#d19a66' },
  '.cm-live-code-block-line .tok-comment': { color: '#7f848e', fontStyle: 'italic' },
  '.cm-live-code-block-line .tok-lineComment': { color: '#7f848e', fontStyle: 'italic' },
  '.cm-live-code-block-line .tok-blockComment': { color: '#7f848e', fontStyle: 'italic' },
  '.cm-live-code-block-line .tok-function': { color: '#61afef' },
  '.cm-live-code-block-line .tok-variableName': { color: '#e06c75' },
  '.cm-live-code-block-line .tok-definition': { color: '#61afef' },
  '.cm-live-code-block-line .tok-typeName': { color: '#e5c07b' },
  '.cm-live-code-block-line .tok-className': { color: '#e5c07b' },
  '.cm-live-code-block-line .tok-propertyName': { color: '#e06c75' },
  '.cm-live-code-block-line .tok-attributeName': { color: '#e06c75' },
  '.cm-live-code-block-line .tok-attributeValue': { color: '#98c379' },
  '.cm-live-code-block-line .tok-namespace': { color: '#e5c07b' },
  '.cm-live-code-block-line .tok-tagName': { color: '#e06c75' },
  '.cm-live-code-block-line .tok-angleBracket': { color: 'var(--color-fg-muted)' },
  '.cm-live-code-block-line .tok-self': { color: '#e06c75' },
  '.cm-live-code-block-line .tok-regexp': { color: '#56b6c2' },
  '.cm-live-code-block-line .tok-escape': { color: '#56b6c2' },
  '.cm-live-code-block-line .tok-color': { color: '#d19a66' },
  '.cm-live-code-block-line .tok-url': { color: '#56b6c2', textDecoration: 'underline' },
  '.cm-live-code-block-line .tok-meta': { color: '#7f848e' },
  '.cm-live-code-block-line .tok-invalid': { color: '#f44747' },

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
    tableLayout: 'fixed',
  },
  '.cm-live-table th, .cm-live-table td': {
    border: '1px solid var(--color-border-default)',
    padding: '6px 12px',
    outline: 'none',
    cursor: 'text',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    '&:focus': {
      boxShadow: 'inset 0 0 0 2px var(--color-accent-fg)',
    },
  },
  '.cm-live-table th': {
    backgroundColor: 'var(--color-canvas-subtle)',
    fontWeight: '600',
    position: 'relative',
  },
  '.cm-table-resize-handle': {
    position: 'absolute',
    top: '0',
    right: '-3px',
    width: '6px',
    height: '100%',
    cursor: 'col-resize',
    zIndex: '1',
    '&:hover, &:active': {
      backgroundColor: 'var(--color-accent-fg)',
      opacity: '0.4',
    },
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

  // Mermaid diagrams
  '.cm-live-mermaid': {
    cursor: 'pointer',
    display: 'block',
    padding: '0.75em 0',
    overflowX: 'auto',
  },
  '.cm-live-mermaid svg': {
    maxWidth: '100%',
    height: 'auto',
  },
  '.cm-live-mermaid-error': {
    fontStyle: 'italic',
    fontSize: '0.9em',
    opacity: '0.6',
  },

  // HTML blocks
  '.cm-live-html-block': {
    cursor: 'pointer',
    display: 'block',
    padding: '0.25em 0',
    overflowX: 'auto',
  },

});

export function livePreview(filePath = '') {
  return [
    currentFileCompartment.of(currentFileFacet.of(filePath)),
    interactionTracking,
    livePreviewPlugin,
    blockWidgetField,
    livePreviewStyles,
  ];
}

// Lightweight URL detection for plain text files (no markdown parsing)
function buildPlainUrlDecorations(view: EditorView): DecorationSet {
  const urls = findPlainUrls(view, []);
  const cursorPos = view.state.selection.main.head;
  const decorations: Range<Decoration>[] = [];

  for (const el of urls) {
    if (el.text === undefined || el.url === undefined) continue;
    const cursorInside = cursorPos >= el.from && cursorPos <= el.to;
    if (!cursorInside) {
      decorations.push(
        Decoration.replace({
          widget: new LinkWidget(el.text, el.url, false),
        }).range(el.from, el.to)
      );
    }
  }

  decorations.sort((a, b) => a.from - b.from);
  return Decoration.set(decorations);
}

const plainUrlPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildPlainUrlDecorations(view);
    }

    update(update: ViewUpdate) {
      const resumed = update.transactions.some(interactionEnded);
      if (!update.docChanged && !resumed) {
        if (!update.selectionSet || rebuildsSuppressed(update.state)) return;
      }
      this.decorations = buildPlainUrlDecorations(update.view);
    }
  },
  { decorations: (v) => v.decorations }
);

export function plainUrlDetection() {
  return [interactionTracking, plainUrlPlugin, livePreviewStyles];
}