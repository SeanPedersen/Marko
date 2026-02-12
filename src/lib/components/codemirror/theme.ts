import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

// Base theme using CSS variables from the app
const baseTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--color-canvas-default)',
    color: 'var(--color-fg-default)',
    height: '100%',
  },
  '.cm-content': {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    padding: '0',
    caretColor: 'var(--color-fg-default)',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--color-fg-default)',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--color-accent-fg)',
    opacity: '0.2',
  },
  '.cm-selectionBackground': {
    backgroundColor: 'rgba(9, 105, 218, 0.2) !important',
  },
  '.cm-activeLine': {
    backgroundColor: 'transparent',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--color-canvas-default)',
    color: 'var(--color-fg-muted)',
    border: 'none',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
  },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    lineHeight: '1.6',
  },
  '.cm-line': {
    padding: '0 4px',
  },
});

// Syntax highlighting for markdown
const markdownHighlighting = HighlightStyle.define([
  // Headings - we'll handle sizes via decorations, but still style the markers
  { tag: t.heading1, fontWeight: '700', fontSize: '1.5em' },
  { tag: t.heading2, fontWeight: '600', fontSize: '1.3em' },
  { tag: t.heading3, fontWeight: '600', fontSize: '1.15em' },
  { tag: t.heading4, fontWeight: '600', fontSize: '1.05em' },
  { tag: t.heading5, fontWeight: '600', fontSize: '1em' },
  { tag: t.heading6, fontWeight: '600', fontSize: '0.95em' },

  // Emphasis
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },

  // Code
  {
    tag: t.monospace,
    fontFamily: '"Monaco", "Menlo", "Ubuntu Mono", monospace',
    backgroundColor: 'var(--color-neutral-muted)',
    borderRadius: '3px',
    padding: '0.2em 0.4em',
  },

  // Links
  { tag: t.link, color: 'var(--color-accent-fg)' },
  { tag: t.url, color: 'var(--color-accent-fg)', textDecoration: 'underline' },

  // Quote
  { tag: t.quote, color: 'var(--color-fg-muted)', fontStyle: 'italic' },

  // Lists
  { tag: t.list, color: 'var(--color-fg-default)' },

  // Meta characters (markdown syntax)
  { tag: t.processingInstruction, color: 'var(--color-fg-muted)' },
  { tag: t.meta, color: 'var(--color-fg-muted)' },

  // Content
  { tag: t.content, color: 'var(--color-fg-default)' },
  { tag: t.contentSeparator, color: 'var(--color-border-default)' },
]);

export function createTheme(): Extension {
  return [baseTheme, syntaxHighlighting(markdownHighlighting)];
}

export { baseTheme, markdownHighlighting };
