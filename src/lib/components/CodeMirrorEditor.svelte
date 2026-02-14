<script lang="ts">
	import { onMount, onDestroy, untrack } from 'svelte';
	import { EditorView, keymap, lineNumbers, drawSelection, highlightActiveLine, rectangularSelection, ViewPlugin } from '@codemirror/view';
	import { EditorState, Compartment } from '@codemirror/state';
	import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
	import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
	import { languages } from '@codemirror/language-data';
	import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from '@codemirror/language';
	import { createTheme } from './codemirror/theme.js';
	import { livePreview } from './codemirror/livePreview.js';
	import { wikiLinkCompletion, fileIndexFacet, fileIndexCompartment, updateFileIndex } from './codemirror/wikiLinkCompletion.js';
	import type { FileIndex } from '$lib/utils/wikiLinks';
	import type { Extension } from '@codemirror/state';

	// Custom scrollPastEnd that only adds half viewport height
	const scrollPastEndHalfPlugin = ViewPlugin.fromClass(
		class {
			height = 500;
			attrs: { style: string } = { style: 'padding-bottom: 500px' };

			update(update: { view: EditorView }) {
				const { view } = update;
				// Use scrollDOM height as the viewport reference
				const editorHeight = view.scrollDOM.clientHeight;
				const height = Math.max(0, (editorHeight - view.defaultLineHeight) / 2);
				if (height !== this.height) {
					this.height = height;
					this.attrs = { style: `padding-bottom: ${height}px` };
				}
			}
		}
	);

	function scrollPastEndHalf(): Extension {
		return [
			scrollPastEndHalfPlugin,
			EditorView.contentAttributes.of((view) => {
				return view.plugin(scrollPastEndHalfPlugin)?.attrs || null;
			}),
		];
	}

	let {
		value = '',
		readonly = false,
		theme = 'system',
		onchange,
		zoomLevel = 100,
		fileType = 'markdown', // 'markdown' or 'text'
		editorWidth = '720px',
		fileIndex = { entries: [], byBasename: new Map(), byFilename: new Map() } as FileIndex,
	} = $props<{
		value?: string;
		readonly?: boolean;
		theme?: 'system' | 'dark' | 'light';
		onchange?: (value: string) => void;
		zoomLevel?: number;
		fileType?: 'markdown' | 'text';
		editorWidth?: string;
		fileIndex?: FileIndex;
	}>();

	let container: HTMLDivElement;
	let view: EditorView | null = null;
	let internalValue = '';
	let suppressUpdate = false;

	// Compartments for dynamic configuration
	const readonlyCompartment = new Compartment();
	const themeCompartment = new Compartment();

	function createExtensions() {
		const extensions = [
			// Basic editing
			history(),
			drawSelection(),
			EditorState.allowMultipleSelections.of(true),
			rectangularSelection(),
			bracketMatching(),

			// Line wrapping (no horizontal scroll)
			EditorView.lineWrapping,

			// Highlight active line
			highlightActiveLine(),

			// Keymaps
			keymap.of([
				...defaultKeymap,
				...historyKeymap,
				indentWithTab,
			]),

			// Custom theme
			themeCompartment.of(createTheme()),

			// Readonly mode
			readonlyCompartment.of(EditorState.readOnly.of(readonly)),

			// Update listener
			EditorView.updateListener.of((update) => {
				if (update.docChanged && !suppressUpdate) {
					const newValue = update.state.doc.toString();
					internalValue = newValue;
					onchange?.(newValue);
				}
			}),

			// Allow scrolling past the end (half viewport height)
			scrollPastEndHalf(),
		];

		// Conditionally add markdown-specific features
		if (fileType === 'markdown') {
			extensions.push(
				// Markdown language support
				markdown({
					base: markdownLanguage,
					codeLanguages: languages,
				}),

				// Syntax highlighting
				syntaxHighlighting(defaultHighlightStyle, { fallback: true }),

				// Live preview (Obsidian-style)
				livePreview(),

				// Wiki-link autocomplete
				wikiLinkCompletion(),
				fileIndexCompartment.of(fileIndexFacet.of(fileIndex)),
			);
		}

		return extensions;
	}

	function initEditor() {
		if (!container) return;

		// Clean up existing editor
		if (view) {
			view.destroy();
			view = null;
		}

		internalValue = value;

		const state = EditorState.create({
			doc: value,
			extensions: createExtensions(),
		});

		view = new EditorView({
			state,
			parent: container,
		});
	}

	onMount(() => {
		initEditor();
	});

	// Re-initialize editor when fileType changes
	$effect(() => {
		fileType; // Only track fileType changes
		untrack(() => {
			if (container) initEditor();
		});
	});

	onDestroy(() => {
		if (view) {
			view.destroy();
			view = null;
		}
	});

	// Sync external value changes (e.g. switching tabs/files)
	$effect(() => {
		if (!view) return;
		const newValue = value;

		// Skip if value matches internal state
		if (newValue === internalValue) return;

		// Use setState to cleanly replace the editor state.
		// A transaction-based replacement can race with ongoing mouse
		// interactions, causing the selection to map to the end of the
		// new document (jump-to-bottom + select-all bug).
		internalValue = newValue;
		view.setState(EditorState.create({
			doc: newValue,
			extensions: createExtensions(),
		}));

		// Scroll to top for new file content
		view.scrollDOM.scrollTop = 0;
	});

	// Update readonly state
	$effect(() => {
		if (!view) return;
		view.dispatch({
			effects: readonlyCompartment.reconfigure(EditorState.readOnly.of(readonly)),
		});
	});

	// Update file index for wiki-link completion
	$effect(() => {
		if (!view || fileType !== 'markdown') return;
		updateFileIndex(view, fileIndex);
	});

	// Export function to scroll to a specific line (for TOC integration)
	export function scrollToLine(lineNumber: number) {
		if (!view) return;

		const doc = view.state.doc;
		if (lineNumber < 1 || lineNumber > doc.lines) return;

		const line = doc.line(lineNumber);
		const previousSelection = view.state.selection;
		view.dispatch({
			selection: { anchor: line.from },
			effects: EditorView.scrollIntoView(line.from, { y: 'start' }),
		});
		requestAnimationFrame(() => {
			if (!view) return;
			view.dispatch({ selection: previousSelection });
		});
	}

	// Export function to focus the editor
	export function focus() {
		view?.focus();
	}

	// Export function to get line number for a heading
	export function findHeadingLine(headingText: string, level: number, occurrence: number = 0): number {
		if (!view) return -1;

		const doc = view.state.doc;
		const pattern = new RegExp(`^#{${level}}\\s+${escapeRegex(headingText)}\\s*$`);
		let matchCount = 0;

		for (let i = 1; i <= doc.lines; i++) {
			const line = doc.line(i);
			if (pattern.test(line.text)) {
				if (matchCount === occurrence) {
					return i;
				}
				matchCount++;
			}
		}

		return -1;
	}

	function escapeRegex(str: string): string {
		return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}
</script>

<div
	bind:this={container}
	class="codemirror-container"
	style="font-size: {zoomLevel / 100}em; --editor-max-width: {editorWidth};"
></div>

<style>
	.codemirror-container {
		width: 100%;
		height: 100%;
		flex: 1;
		min-height: 0;
		box-sizing: border-box;
		overflow: hidden;
	}

	.codemirror-container :global(.cm-editor) {
		height: 100%;
		outline: none;
	}

	.codemirror-container :global(.cm-scroller) {
		padding: 2rem;
		overflow: auto;
	}

	.codemirror-container :global(.cm-content) {
		max-width: var(--editor-max-width, 720px);
		margin: 0 auto;
	}

  /* Selection styling (uses CSS variables so theme can override) */
  .codemirror-container :global(.cm-selectionBackground) {
    background-color: var(--color-selection) !important;
  }

  .codemirror-container :global(.cm-focused .cm-selectionBackground) {
    background-color: var(--color-selection-focus) !important;
  }

	/* Cursor */
	.codemirror-container :global(.cm-cursor) {
		border-left-width: 2px;
	}
</style>
