# Marko

A Tauri-based markdown editor with Obsidian-style WYSIWYG inline editor.

## Tech Stack

- **Frontend**: Svelte 5 (with runes), TypeScript, Vite
- **Backend**: Tauri 2 (Rust)
- **Editor**: CodeMirror 6 with custom live preview extension
- **Styling**: Tailwind CSS v4 (`@tailwindcss/vite`) + CSS variables for theming

## Styling

### Tailwind CSS v4

All components use Tailwind utility classes. No `<style>` blocks except for:
- **CodeMirrorEditor.svelte**: all `:global(.cm-*)` rules (CodeMirror internals)
- **FolderExplorer / TableOfContents / TabList**: `::-webkit-scrollbar` rules
- **KanbanBoard.svelte**: `:global()` rules + non-standard `font-weight: 450/650`

**CSS variable syntax**: always `(--varname)` — e.g. `text-(--color-fg-default)`. Using `[--varname]` generates empty `{}` rules in Tailwind v4.

**Dark mode**: configured via `@custom-variant dark` in `styles.css`, supporting `light/dark/system`.

**Component classes**: `btn-icon` defined in `@layer components` in `styles.css`.

**Complex dynamic styles kept as inline `style=`**:
- Sidebar clamp positioning: `style="left: clamp(0px, 1184px - 100vw, calc(232px - 2rem))"`
- Git status badge colors: `style="color: {badge.color}"`
- Tooltip transforms: computed via `$derived` JS state → inline style

### CSS Variables

Theme colors defined in `MarkdownViewer.svelte`:
- `--color-canvas-default` — background
- `--color-canvas-subtle` — secondary background
- `--color-fg-default` — primary text
- `--color-fg-muted` — secondary text
- `--color-border-default` — borders
- `--color-accent-fg` — accent/link color
- `--color-neutral-muted` — neutral highlights

## Dev Tooling

- **MCP Bridge**: `tauri-plugin-mcp-bridge` is registered in debug builds only (`#[cfg(debug_assertions)]`), enabling automation via WebSocket on port 9223
- **`withGlobalTauri: true`** is set in `tauri.conf.json` (required for MCP bridge communication)
- Run `pnpm tauri dev` to start the app with MCP bridge active

## Commands

```bash
pnpm check        # TypeScript/Svelte type checking
```

## CLI Command

After installing via Settings > "Install Command", you can open files from terminal:
```bash
marko <file>         # Open a file in Marko
marko <folder>       # Open folder in Marko's file explorer
marko                # Open Marko without a file
```

The CLI is installed to:
- **macOS/Linux**: `/usr/local/bin/marko`
- **Windows**: `%LOCALAPPDATA%\Marko\bin\marko.cmd` (added to PATH)
