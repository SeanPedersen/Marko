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
    backgroundColor: 'var(--color-selection) !important',
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

  // Autocomplete tooltip styling
  '.cm-tooltip': {
    backgroundColor: 'var(--color-canvas-default)',
    border: '1px solid var(--color-border-default)',
    borderRadius: '8px',
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.12)',
    overflow: 'hidden',
  },
  '.cm-tooltip.cm-tooltip-autocomplete': {
    minWidth: '200px',
    maxWidth: '400px',
  },
  '.cm-tooltip-autocomplete > ul': {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: '13px',
    padding: '4px',
    margin: '0',
    maxHeight: '300px',
  },
  '.cm-tooltip-autocomplete > ul > li': {
    padding: '6px 10px',
    borderRadius: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    cursor: 'pointer',
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--color-accent-fg)',
    color: '#ffffff',
  },
  '.cm-completionLabel': {
    flex: '1',
    fontWeight: '500',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  '.cm-completionDetail': {
    fontSize: '11px',
    color: 'var(--color-fg-muted)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: '180px',
    textAlign: 'right',
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionDetail': {
    color: 'rgba(255, 255, 255, 0.8)',
  },
  '.cm-completionMatchedText': {
    textDecoration: 'none',
    fontWeight: '700',
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionMatchedText': {
    color: '#ffffff',
  },
  // Search panel
  '.cm-panels': {
    backgroundColor: 'var(--color-canvas-subtle)',
    borderTop: '1px solid var(--color-border-default)',
    color: 'var(--color-fg-default)',
  },
  '.cm-search': {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '6px',
    padding: '8px 12px',
    fontSize: '13px',
  },
  '.cm-textfield': {
    backgroundColor: 'var(--color-canvas-default)',
    color: 'var(--color-fg-default)',
    border: '1px solid var(--color-border-default)',
    borderRadius: '6px',
    padding: '4px 8px',
    fontSize: '13px',
    outline: 'none',
    minWidth: '160px',
  },
  '.cm-textfield:focus': {
    borderColor: 'var(--color-accent-fg)',
    boxShadow: '0 0 0 2px color-mix(in srgb, var(--color-accent-fg) 25%, transparent)',
  },
  '.cm-button': {
    backgroundImage: 'none',
    backgroundColor: 'var(--color-canvas-default)',
    color: 'var(--color-fg-default)',
    border: '1px solid var(--color-border-default)',
    borderRadius: '6px',
    padding: '4px 10px',
    fontSize: '13px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  '.cm-button:hover': {
    backgroundColor: 'var(--color-neutral-muted)',
  },
  '.cm-search button[name="close"]': {
    backgroundColor: 'transparent',
    color: 'var(--color-fg-muted)',
    border: 'none',
    padding: '4px 6px',
    marginLeft: 'auto',
    cursor: 'pointer',
    fontSize: '16px',
  },
  '.cm-search button[name="close"]:hover': {
    color: 'var(--color-fg-default)',
    backgroundColor: 'transparent',
  },
  '.cm-search label': {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    cursor: 'pointer',
    color: 'var(--color-fg-muted)',
    fontSize: '12px',
  },
  '.cm-searchMatch': {
    backgroundColor: 'color-mix(in srgb, var(--color-accent-fg) 20%, transparent)',
    outline: '1px solid color-mix(in srgb, var(--color-accent-fg) 50%, transparent)',
    borderRadius: '2px',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'color-mix(in srgb, var(--color-accent-fg) 45%, transparent)',
    outline: '1px solid var(--color-accent-fg)',
  },

  // Completion icon (file type)
  '.cm-completionIcon': {
    fontSize: '14px',
    opacity: '0.7',
    marginRight: '6px',
    width: '16px',
    textAlign: 'center',
  },
  '.cm-completionIcon-file::after': {
    content: '"\\1F4C4"', // File emoji
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionIcon': {
    opacity: '1',
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
