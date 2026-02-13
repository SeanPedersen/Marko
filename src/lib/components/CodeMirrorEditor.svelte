<script lang="ts">
	import { onMount, onDestroy, untrack } from 'svelte';
	import { EditorView, keymap, lineNumbers, drawSelection, highlightActiveLine, rectangularSelection, scrollPastEnd } from '@codemirror/view';
	import { EditorState, Compartment } from '@codemirror/state';
	import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
	import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
	import { languages } from '@codemirror/language-data';
	import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from '@codemirror/language';
	import { createTheme } from './codemirror/theme.js';
	import { livePreview } from './codemirror/livePreview.js';

	let {
		value = '',
		readonly = false,
		theme = 'system',
		onchange,
		zoomLevel = 100,
		fileType = 'markdown', // 'markdown' or 'text'
	} = $props<{
		value?: string;
		readonly?: boolean;
		theme?: 'system' | 'dark' | 'light';
		onchange?: (value: string) => void;
		zoomLevel?: number;
		fileType?: 'markdown' | 'text';
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

			// Allow scrolling past the end of the document
			scrollPastEnd(),
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

	// Sync external value changes
	$effect(() => {
		if (!view) return;
		const newValue = value;

		// Skip if value matches internal state
		if (newValue === internalValue) return;

		// Replace content without triggering onChange
		suppressUpdate = true;
		const transaction = view.state.update({
			changes: {
				from: 0,
				to: view.state.doc.length,
				insert: newValue,
			},
			selection: { anchor: 0 },
		});
		view.dispatch(transaction);
		internalValue = newValue;
		suppressUpdate = false;

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
	style="font-size: {zoomLevel / 100}em;"
></div>

<style>
	.codemirror-container {
		width: 100%;
		height: 100%;
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
		max-width: 720px;
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
