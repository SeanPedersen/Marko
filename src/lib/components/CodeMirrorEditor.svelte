<script lang="ts">
	import { onMount, onDestroy, untrack } from 'svelte';
	import { EditorView, keymap, highlightActiveLine, rectangularSelection, drawSelection, dropCursor, ViewPlugin } from '@codemirror/view';
	import { EditorState, EditorSelection, Compartment, Transaction } from '@codemirror/state';
	import { defaultKeymap, history, historyKeymap, indentMore, indentLess } from '@codemirror/commands';
	import { search, searchKeymap } from '@codemirror/search';
	import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
	import { Table } from '@lezer/markdown';
	import { languages } from '@codemirror/language-data';
	import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, indentUnit } from '@codemirror/language';
	import { createTheme } from './codemirror/theme.js';
	import { livePreview, plainUrlDetection, updateCurrentFile } from './codemirror/livePreview.js';
	import { wikiLinkCompletion, fileIndexFacet, fileIndexCompartment, updateFileIndex } from './codemirror/wikiLinkCompletion.js';
	import { readSnapshot, writeSnapshot, nextAnonymousDocId } from './codemirror/viewSnapshots.js';
	import { clickPlacesCursor } from './codemirror/clickSelection.js';
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
		fileType = 'markdown', // 'markdown' or 'text'
		editorWidth = '720px',
		filePath = '',
		docId,
		fileIndex = { entries: [], byBasename: new Map(), byFilename: new Map() } as FileIndex,
	} = $props<{
		value?: string;
		readonly?: boolean;
		theme?: 'system' | 'dark' | 'light';
		onchange?: (value: string) => void;
		fileType?: 'markdown' | 'text';
		editorWidth?: string;
		filePath?: string;
		/** Identity of the document being edited. A change means "a different
		 *  document is now in this editor" and resets caret, scroll and history;
		 *  a `value` change alone is reconciled in place. Defaults to filePath. */
		docId?: string;
		fileIndex?: FileIndex;
	}>();

	let container: HTMLDivElement;
	let view: EditorView | null = null;

	// Mirrors the text CodeMirror currently holds. Lets the sync effect tell an
	// edit echoing back through the store from a genuine external replacement
	// in O(1), instead of stringifying the document on every keystroke.
	let syncedValue = '';
	let loadedDocId: string | null = null;

	// Editors mounted without any document identity (kanban raw view, card
	// detail pane) still need a key of their own, or they would share — and
	// overwrite — each other's entry in the process-wide snapshot store.
	const anonymousDocId = nextAnonymousDocId();
	let currentDocId = $derived(docId ?? (filePath || anonymousDocId));

	// Compartments for dynamic configuration
	const readonlyCompartment = new Compartment();
	const themeCompartment = new Compartment();


		function toggleMarker(view: EditorView, marker: string): boolean {
		const changes = view.state.changeByRange((range) => {
			if (range.empty) {
				return {
					changes: { from: range.from, insert: marker + marker },
					range: EditorSelection.cursor(range.from + marker.length),
				};
			}
			const text = view.state.sliceDoc(range.from, range.to);
			if (text.startsWith(marker) && text.endsWith(marker) && text.length > marker.length * 2) {
				return {
					changes: [
						{ from: range.from, to: range.from + marker.length, insert: '' },
						{ from: range.to - marker.length, to: range.to, insert: '' },
					],
					range: EditorSelection.range(range.from, range.to - marker.length * 2),
				};
			}
			return {
				changes: [{ from: range.from, insert: marker }, { from: range.to, insert: marker }],
				range: EditorSelection.range(range.from, range.to + marker.length * 2),
			};
		});
		view.dispatch(view.state.update(changes, { userEvent: 'input' }));
		return true;
	}


function createExtensions() {
		const extensions = [
			// Basic editing
			history(),
			EditorState.allowMultipleSelections.of(true),
			// The caret and selection are drawn by CodeMirror rather than left to
			// the platform: WKWebView repaints the native caret lazily and strands
			// a frozen copy of it at the old offset when an edit rewrites the line
			// around it (Tab followed by Cmd+Backspace is the reliable trigger).
			drawSelection(),
			dropCursor(),
			rectangularSelection(),
			clickPlacesCursor(),
			bracketMatching(),

			// Line wrapping (no horizontal scroll)
			EditorView.lineWrapping,

			// Highlight active line
			highlightActiveLine(),

			// Keymaps
			keymap.of([
				// Override selectAll so head stays at 0 (cursor at top) — prevents the
				// view from scrolling to the bottom after Cmd/Ctrl+A.
				{
					key: 'Mod-a',
					run: (view) => {
						view.dispatch({
							selection: { anchor: view.state.doc.length, head: 0 },
							userEvent: 'select',
						});
						return true;
					},
				},
				{ key: 'Mod-b', run: (view) => toggleMarker(view, '**') },
				...searchKeymap,
				...defaultKeymap,
				...historyKeymap,

				// Tab indents at the caret. CodeMirror's indentWithTab runs
				// indentMore, which always inserts at the start of the logical line —
				// on a wrapped paragraph that lands nowhere near the caret. Whole-line
				// indenting is still what a non-empty selection means.
				{
					key: 'Tab',
					run: (view) => {
						const { state } = view;
						if (state.readOnly) return false;
						if (state.selection.ranges.some((range) => !range.empty)) return indentMore(view);
						view.dispatch(
							state.update(state.replaceSelection(state.facet(indentUnit)), {
								scrollIntoView: true,
								userEvent: 'input.indent',
							})
						);
						return true;
					},
					shift: indentLess,
				},
			]),

			// Search panel (Cmd/Ctrl+F)
			search({ top: false }),

			// Disable system autocorrect/suggestions on search panel inputs
			ViewPlugin.fromClass(class {
				observer: MutationObserver;
				constructor(view: EditorView) {
					this.observer = new MutationObserver(() => this.disableSuggestions(view));
					this.observer.observe(view.dom, { childList: true, subtree: true });
					this.disableSuggestions(view);
				}
				disableSuggestions(view: EditorView) {
					view.dom.querySelectorAll('.cm-textfield').forEach((el) => {
						const input = el as HTMLInputElement;
						if (input.getAttribute('autocomplete') === 'off') return;
						input.setAttribute('autocomplete', 'off');
						input.setAttribute('autocorrect', 'off');
						input.setAttribute('autocapitalize', 'off');
						input.setAttribute('spellcheck', 'false');
					});
				}
				destroy() { this.observer.disconnect(); }
			}),

			// Custom theme
			themeCompartment.of(createTheme()),

			// Readonly mode
			readonlyCompartment.of(EditorState.readOnly.of(readonly)),

			// Update listener
			EditorView.updateListener.of((update) => {
				if (update.selectionSet || update.docChanged) recordSnapshot();
				if (!update.docChanged) return;
				const newValue = update.state.doc.toString();
				syncedValue = newValue;
				onchange?.(newValue);
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
					extensions: [Table],
				}),

				// Syntax highlighting
				syntaxHighlighting(defaultHighlightStyle, { fallback: true }),

				// Live preview (Obsidian-style)
				livePreview(filePath),

				// Wiki-link autocomplete
				wikiLinkCompletion(),
				fileIndexCompartment.of(fileIndexFacet.of(fileIndex)),
			);
		} else if (fileType === 'text') {
			extensions.push(plainUrlDetection());
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

		syncedValue = value;
		loadedDocId = currentDocId;

		const state = EditorState.create({
			doc: value,
			extensions: createExtensions(),
		});

		view = new EditorView({
			state,
			parent: container,
		});
		view.scrollDOM.addEventListener('scroll', recordSnapshot, { passive: true });

		// A fresh mount is either the app opening its first document or a tab
		// returning from a view that replaced this editor (kanban, mermaid, HTML),
		// so it resumes from the store just like a tab switch does — and takes
		// focus, so the caret is live and visible without a click first.
		applySnapshot(view, currentDocId);
		view.focus();
	}

	// Set while a snapshot is being applied. The caret and scroll assignments made
	// during that window are echoes of the stored value, and recording them back
	// before the scroll has landed would overwrite it with the pre-restore zero.
	let restoring = false;

	// Recording on every caret move and scroll — rather than only on teardown —
	// makes restoring independent of unmount ordering. A tab handing the editor
	// over to another view (kanban, mermaid, HTML) destroys this component rather
	// than swapping its document, so teardown is not a reliable last word.
	function recordSnapshot() {
		if (restoring || !view || loadedDocId === null) return;
		const { anchor, head } = view.state.selection.main;
		// Svelte detaches a component's nodes before running onDestroy, and a
		// detached scroller reports 0 — so the teardown record must not be allowed
		// to overwrite the position the document was actually left at. The caret
		// comes from editor state, which detaching does not touch.
		const scrollTop = view.scrollDOM.isConnected
			? view.scrollDOM.scrollTop
			: (readSnapshot(loadedDocId)?.scrollTop ?? 0);
		writeSnapshot(loadedDocId, { anchor, head, scrollTop });
	}

	// A freshly mounted editor reports a content height that is still growing as
	// CodeMirror measures, so a single assignment gets clamped to whatever fits
	// the incomplete layout. Re-apply until the value sticks, bounded so an
	// offset the document can no longer reach cannot spin.
	const SCROLL_RESTORE_ATTEMPTS = 5;

	function restoreScroll(target: EditorView, scrollTop: number, id: string, attempt = 0) {
		target.requestMeasure({
			read: () => null,
			write: () => {
				// A newer restore has taken over and owns `restoring` from here.
				if (loadedDocId !== id) return;

				target.scrollDOM.scrollTop = scrollTop;
				if (target.scrollDOM.scrollTop === scrollTop || attempt >= SCROLL_RESTORE_ATTEMPTS) {
					restoring = false;
					return;
				}
				restoreScroll(target, scrollTop, id, attempt + 1);
			},
		});
	}

	// Resume the caret and scroll this document was last left at. Positions are
	// clamped: the document may have been edited elsewhere since.
	function applySnapshot(target: EditorView, id: string) {
		restoring = true;
		const snapshot = readSnapshot(id);
		if (!snapshot) {
			target.dispatch({ selection: { anchor: 0 } });
			target.scrollDOM.scrollTop = 0;
			restoring = false;
			return;
		}

		const max = target.state.doc.length;
		target.dispatch({
			selection: {
				anchor: Math.min(snapshot.anchor, max),
				head: Math.min(snapshot.head, max),
			},
			scrollIntoView: false,
		});
		restoreScroll(target, snapshot.scrollTop, id);
	}

	// A different document is taking over this editor: replace the state
	// wholesale so undo history starts fresh, then resume where it was left.
	function loadDoc(target: EditorView, next: string, id: string) {
		target.setState(EditorState.create({ doc: next, extensions: createExtensions() }));
		target.focus();
		applySnapshot(target, id);
	}

	// Same document, new text from outside the editor (file watcher, git
	// revert, kanban round-trip). Narrow the replacement to the range that
	// actually differs so CodeMirror can map the selection and scroll position
	// through it — replacing the whole document would send the caret to the top
	// mid-edit, which is what made external writes feel like a desync.
	function reconcileDoc(target: EditorView, next: string) {
		const current = target.state.doc.toString();
		if (current === next) return;

		const maxCommon = Math.min(current.length, next.length);

		let prefix = 0;
		while (prefix < maxCommon && current[prefix] === next[prefix]) prefix++;

		let suffix = 0;
		while (
			suffix < maxCommon - prefix &&
			current[current.length - 1 - suffix] === next[next.length - 1 - suffix]
		) suffix++;

		target.dispatch({
			changes: {
				from: prefix,
				to: current.length - suffix,
				insert: next.slice(prefix, next.length - suffix),
			},
			annotations: Transaction.addToHistory.of(false),
			scrollIntoView: false,
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
		if (!view) return;
		// Catches a caret move that landed after the last recorded one; the scroll
		// position is already stored, since the nodes are detached by now.
		recordSnapshot();
		view.destroy();
		view = null;
	});

	// The single reconciliation point between the owning store and CodeMirror's
	// document. untrack() keeps the other props (which createExtensions reads)
	// out of this effect's dependencies, so unrelated churn — a rebuilt
	// fileIndex, say — cannot re-enter it.
	$effect(() => {
		const next = value;
		const nextDocId = currentDocId;

		untrack(() => {
			if (!view) return;

			if (nextDocId !== loadedDocId) {
				recordSnapshot();
				loadedDocId = nextDocId;
				syncedValue = next;
				loadDoc(view, next, nextDocId);
				return;
			}

			if (next === syncedValue) return;
			syncedValue = next;
			reconcileDoc(view, next);
		});
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

	// Update current file path for image URL resolution
	$effect(() => {
		if (!view || fileType !== 'markdown') return;
		updateCurrentFile(view, filePath);
	});

	// Export function to scroll to a specific line (for TOC integration)
	export function scrollToLine(lineNumber: number) {
		if (!view) return;

		const doc = view.state.doc;
		if (lineNumber < 1 || lineNumber > doc.lines) return;

		const line = doc.line(lineNumber);
		// Focus first so the subsequent dispatch doesn't trigger a
		// separate focus-induced scroll-to-cursor
		view.focus();
		view.dispatch({
			selection: { anchor: line.from },
			effects: EditorView.scrollIntoView(line.from, { y: 'start' }),
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

	// Export function to wrap current selection as a code block or blockquote
	export function wrapSelection(type: 'code_block' | 'quote') {
		if (!view) return;

		const state = view.state;
		const selection = state.selection.main;
		if (selection.empty) return;

		const selectedText = state.sliceDoc(selection.from, selection.to);

		let replacement: string;
		if (type === 'code_block') {
			const isMultiLine = selectedText.includes('\n');
			replacement = isMultiLine
				? '```\n' + selectedText + '\n```'
				: '`' + selectedText + '`';
		} else {
			replacement = selectedText
				.split('\n')
				.map((line) => '> ' + line)
				.join('\n');
		}

		view.dispatch({
			changes: { from: selection.from, to: selection.to, insert: replacement },
			selection: { anchor: selection.from, head: selection.from + replacement.length },
		});
		view.focus();
	}
</script>

<div
	bind:this={container}
	class="codemirror-container w-full h-full flex-1 min-h-0 overflow-hidden box-border"
	style="--editor-max-width: {editorWidth};"
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
		overflow-y: scroll;
	}

	.codemirror-container :global(.cm-content) {
		max-width: var(--editor-max-width, 720px);
		margin: 0 auto;
	}

  /* Reset native appearance on search panel controls */
  .codemirror-container :global(.cm-button),
  .codemirror-container :global(.cm-textfield) {
    -webkit-appearance: none;
    appearance: none;
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
