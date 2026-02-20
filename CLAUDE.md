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
├── app.html                          # HTML shell
├── styles.css                        # Global styles
├── routes/
│   ├── +layout.ts                    # SvelteKit layout (SSR disabled)
│   └── +page.svelte                  # Root page (mounts MarkdownViewer)
├── assets/
│   ├── favicon.svg
│   └── icon.png
├── lib/
│   ├── MarkdownViewer.svelte         # Main app container (layout, file I/O, keybindings, auto-save)
│   ├── Installer.svelte              # First-run installer flow
│   ├── Uninstaller.svelte            # Uninstall flow
│   ├── components/
│   │   ├── codemirror/
│   │   │   ├── livePreview.ts        # Obsidian-style live preview (hides syntax when cursor away)
│   │   │   ├── wikiLinkCompletion.ts # Wiki-link autocomplete extension for [[...]] syntax
│   │   │   └── theme.ts             # CodeMirror theme using CSS variables
│   │   ├── CodeMirrorEditor.svelte   # Editor wrapper (CodeMirror 6 instance)
│   │   ├── EditorHeader.svelte       # Obsidian-style header with back/forward nav and collapsed breadcrumb path
│   │   ├── TableOfContents.svelte    # TOC sidebar (220px, parses headings)
│   │   ├── FolderExplorer.svelte     # File tree sidebar (220px, recursive dir listing)
│   │   ├── TitleBar.svelte           # Window title bar (traffic lights, sidebar toggles, tabs, theme, window controls)
│   │   ├── TabList.svelte            # Horizontal tab strip
│   │   ├── Tab.svelte                # Single tab component
│   │   ├── HomePage.svelte           # Start screen (recent files/folders)
│   │   ├── Modal.svelte              # Confirmation dialog (save/discard/cancel)
│   │   ├── SettingsModal.svelte      # Settings dialog (editor width, sidebar position, CLI install)
│   │   ├── KanbanBoard.svelte        # Kanban board UI (Obsidian-compatible, replaces editor for kanban files)
│   │   └── ContextMenu.svelte        # Right-click context menu
│   ├── stores/
│   │   ├── tabs.svelte.ts            # TabManager class: tab CRUD, navigation history, dirty state
│   │   └── settings.svelte.ts        # SettingsStore class: editor prefs persisted to localStorage
│   └── utils/
│       ├── debounce.ts               # Typed debounce with call()/cancel()
│       ├── parseHeadings.ts          # Extract headings from markdown (with line numbers)
│       ├── frontmatter.ts            # YAML frontmatter parser
│       ├── kanban.ts                 # Kanban board parsing/serialization (Obsidian format)
│       └── wikiLinks.ts              # Wiki-link utilities (file index, resolution, fuzzy matching)
```

## Key Components

### MarkdownViewer (`src/lib/MarkdownViewer.svelte`)
- Main app shell: manages layout, file loading/saving, keyboard shortcuts, drag-and-drop
- Auto-save: debounced (1s) via `debounce` utility, controlled by `settings.autoSave`
- Sidebar layout: TOC and FolderExplorer overlay the editor; editor reflows only when viewport is narrow (uses `clamp()` on `left` to account for 720px content max-width + 2rem padding)
- TOC button visibility depends on `hasHeadings` derived (only shown when document has headings)
- Wiki-links: builds file index from folder contents, handles `marko:wiki-link` click events, resolves links and creates missing files

### CodeMirror Editor (`src/lib/components/CodeMirrorEditor.svelte`)
- Props: `value`, `readonly`, `theme`, `onchange`, `zoomLevel`, `fileType`, `editorWidth`, `fileIndex`
- Exports: `scrollToLine(lineNumber)`, `findHeadingLine(text, level, occurrence)`
- Uses `EditorView.lineWrapping` for automatic line wrapping
- Content layout: `.cm-scroller` has `padding: 2rem`, `.cm-content` has `max-width` set via `--editor-max-width` CSS variable
- Wiki-link autocomplete via `wikiLinkCompletion()` extension

### Live Preview (`src/lib/components/codemirror/livePreview.ts`)
- Hides markdown syntax (**, ##, [](), etc.) when cursor is NOT on that line
- Reveals syntax when cursor enters the line
- Applies visual styling via CodeMirror decorations
- Supports wiki-links: `[[filename]]` or `[[filename|display text]]` syntax
- **Important**: Avoid using CSS margins on line decorations — they break click position calculations. Use `line-height` for spacing instead.

### Wiki-Links (`src/lib/utils/wikiLinks.ts` + `wikiLinkCompletion.ts`)
- Obsidian-style internal linking between markdown files
- Syntax: `[[target]]` or `[[target|display text]]`
- Resolution: case-insensitive search by basename or filename across entire folder tree
- Autocomplete: shows file suggestions when typing `[[` (fuzzy matching)
- Missing file handling: prompts user to create new file when clicking non-existent link
- `FileIndex` type indexes all markdown files by basename and filename for fast lookup
- `resolveWikiLink()` returns `found | not-found | ambiguous` status with path or candidates

### Git Integration
- **Backend**: Three Rust commands using `git2` crate in `src-tauri/src/lib.rs`:
  - `get_git_status(path)` — returns map of absolute file paths → status strings for an entire repo
  - `get_file_git_status(path)` — returns git status of a single file (or null if clean/not in repo)
  - `git_commit_file(path, message)` — stages and commits a single file
  - `git_sync(path)` — runs `git pull --ff-only` then `git push` via CLI
  - `get_git_ahead_behind(path)` — returns `{ ahead, behind }` commit counts vs remote
- **FolderExplorer**: Fetches git status on load/refresh, shows colored letter badges (M/A/U/D/C) with filename tinting; sync button (pull+push) with ahead/behind counters
- **EditorHeader**: Shows current file's git status badge + commit button with inline message input
- **MarkdownViewer**: Wires git status fetching (on file change + after save) and commit handler
- Status values: `modified`, `staged`, `staged_modified`, `untracked`, `deleted`, `renamed`, `conflicted`

### Table of Contents (`src/lib/components/TableOfContents.svelte`)
- Fixed width: 220px, overlays editor (does not push content)
- Only renders when `hasHeadings && visible`
- Dispatches `onscrollto` event with `{ lineNumber }` for editor scrolling
- Supports `sidebarPosition` prop for left/right positioning

### FolderExplorer (`src/lib/components/FolderExplorer.svelte`)
- Fixed width: 220px, overlays editor (does not push content)
- Recursive directory tree with expand/collapse (persisted to localStorage)
- Opens markdown files on click; mutually exclusive with TOC
- Tracks `knownFiles` to detect file additions/removals and notify parent via `onfileschanged`
- Supports `sidebarPosition` prop for left/right positioning
- **Search**: search icon in header expands into a filter input (animated); filters files by name across all subdirectories, auto-expands matching parent dirs; close with X or Escape
- **Important**: `knownFiles` is reset when `folderPath` changes to prevent false "deleted" diffs when switching folders

### TitleBar (`src/lib/components/TitleBar.svelte`)
- Contains: home button, folder explorer toggle, TOC toggle, tab strip, settings button, theme switcher, window controls
- macOS traffic lights + Windows title bar buttons
- Tabs no longer shift when sidebars are open
- Props include `tocVisible`, `ontoggleToc`, `showTocButton`, `folderExplorerVisible`, `ontoggleFolderExplorer`, `showFolderExplorerButton`, `ontoggleSettings`

### Settings Store (`src/lib/stores/settings.svelte.ts`)
- Svelte 5 runes-based class with `$state` properties
- All settings persisted to localStorage under `editor.*` keys
- Settings: `minimap`, `wordWrap`, `lineNumbers`, `vimMode`, `statusBar`, `wordCount`, `renderLineHighlight`, `showTabs`, `zenMode`, `occurrencesHighlight`, `autoSave`, `editorWidth`, `sidebarPosition`
- `editorWidth`: `'compact' | 'default' | 'wide' | 'full'` (maps to 600px, 720px, 900px, 100%)
- `sidebarPosition`: `'left' | 'right'` — controls which side TOC/FolderExplorer appear
- Each setting has a `toggle*()` or `set*()` method

### Tab Manager (`src/lib/stores/tabs.svelte.ts`)
- `Tab` interface: `id`, `path`, `title`, `rawContent`, `isDirty`, `isEditing`, `history[]`, `scrollTop`, etc.
- `TabManager` class: `addTab`, `closeTab`, `setActive`, `cycleTab`, `navigate`, `goBack`/`goForward`, `updateTabRawContent`, `setTabRawContent`
- Exported singleton: `tabManager`

## CSS Variables

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
- Run `npx tauri dev` to start the app with MCP bridge active

## Commands

```bash
npm run check        # TypeScript/Svelte type checking
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
