# Marko

A Tauri-based markdown editor with Obsidian-style WYSIWYG inline editor.

## Tech Stack

- **Frontend**: Svelte 5 (with runes), TypeScript, Vite
- **Backend**: Tauri 2 (Rust)
- **Editor**: CodeMirror 6 with custom live preview extension
- **Styling**: CSS variables for theming (light/dark/system)

## Project Structure

```
src/
├── lib/
│   ├── components/
│   │   ├── codemirror/
│   │   │   ├── livePreview.ts    # Obsidian-style live preview (hides syntax when cursor away)
│   │   │   └── theme.ts          # CodeMirror theme using CSS variables
│   │   ├── CodeMirrorEditor.svelte  # Main editor component
│   │   ├── TableOfContents.svelte   # TOC sidebar (220px wide)
│   │   ├── TitleBar.svelte          # Window title bar with tabs
│   │   ├── TabList.svelte           # Tab management
│   │   └── ...
│   ├── stores/
│   │   ├── tabs.svelte.js        # Tab state management
│   │   └── settings.svelte.js    # App settings
│   ├── utils/
│   │   └── parseHeadings.ts      # Extract headings from markdown (with line numbers)
│   └── MarkdownViewer.svelte     # Main app container
├── assets/
└── routes/
```

## Key Components

### CodeMirror Editor (`src/lib/components/CodeMirrorEditor.svelte`)
- Props: `value`, `readonly`, `theme`, `onchange`, `zoomLevel`
- Exports: `scrollToLine(lineNumber)`, `findHeadingLine(text, level, occurrence)`
- Uses `EditorView.lineWrapping` for automatic line wrapping

### Live Preview (`src/lib/components/codemirror/livePreview.ts`)
- Hides markdown syntax (**, ##, [](), etc.) when cursor is NOT on that line
- Reveals syntax when cursor enters the line
- Applies visual styling via CodeMirror decorations
- **Important**: Avoid using CSS margins on line decorations - they break click position calculations. Use `line-height` for spacing instead.

### Table of Contents (`src/lib/components/TableOfContents.svelte`)
- Fixed width: 220px
- Dispatches `onscrollto` event with `{ lineNumber }` for editor scrolling
- Toggle button is in TitleBar, not in this component

### TitleBar (`src/lib/components/TitleBar.svelte`)
- Contains: home button (house icon), TOC toggle button, tabs, theme switcher, window controls
- Tab area has `toc-offset` class that adds left padding when TOC is visible
- Props include `tocVisible`, `ontoggleToc`, `showTocButton`

## CSS Variables

Theme colors defined in `MarkdownViewer.svelte`:
- `--color-canvas-default` - background
- `--color-canvas-subtle` - secondary background
- `--color-fg-default` - primary text
- `--color-fg-muted` - secondary text
- `--color-border-default` - borders
- `--color-accent-fg` - accent/link color
- `--color-neutral-muted` - neutral highlights

## Commands

```bash
npm run build        # Production build
npm run check        # TypeScript/Svelte type checking
```
