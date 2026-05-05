<script lang="ts">
	import { onMount, onDestroy, untrack } from 'svelte';
	import { EditorView, keymap, highlightActiveLine, rectangularSelection } from '@codemirror/view';
	import { EditorState, Compartment } from '@codemirror/state';
	import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
	import { search, searchKeymap } from '@codemirror/search';
	import { bracketMatching } from '@codemirror/language';
	import mermaid from 'mermaid';
	import { createTheme } from './codemirror/theme.js';
	import { debounce } from '$lib/utils/debounce.js';

	let {
		value = '',
		readonly = false,
		theme = 'system',
		onchange,
	} = $props<{
		value?: string;
		readonly?: boolean;
		theme?: 'system' | 'dark' | 'light';
		onchange?: (value: string) => void;
	}>();

	const RENDER_DEBOUNCE_MS = 250;
	const FALLBACK_DIAGRAM = 'graph LR\n  A --> B';
	const MIN_SCALE = 0.1;
	const MAX_SCALE = 8;
	const ZOOM_STEP = 1.1;

	let editorContainer: HTMLDivElement;
	let previewViewport: HTMLDivElement;
	let previewContainer: HTMLDivElement;
	let view: EditorView | null = null;

	let renderError = $state<string | null>(null);
	let renderCount = 0;
	let mermaidCurrentTheme: 'default' | 'dark' | null = null;
	let lastRendered = '';

	let scale = $state(1);
	let tx = $state(0);
	let ty = $state(0);
	let baseW = 0;
	let baseH = 0;

	const SPLIT_KEY = 'mermaid-split-ratio';
	const MIN_RATIO = 0.15;
	const MAX_RATIO = 0.85;
	let splitRatio = $state(parseFloat(localStorage.getItem(SPLIT_KEY) || '') || 0.5);
	let rootEl: HTMLDivElement;
	let isDraggingDivider = $state(false);
	$effect(() => { localStorage.setItem(SPLIT_KEY, String(splitRatio)); });
	let isPanning = $state(false);
	let panStartX = 0;
	let panStartY = 0;
	let panOriginTx = 0;
	let panOriginTy = 0;

	const readonlyCompartment = new Compartment();
	const themeCompartment = new Compartment();

	function resolveIsDark(): boolean {
		const attr = document.documentElement.dataset.theme;
		if (attr === 'dark') return true;
		if (attr === 'light') return false;
		return window.matchMedia('(prefers-color-scheme: dark)').matches;
	}

	function ensureMermaidInitialized(isDark: boolean): void {
		const mermaidTheme = isDark ? 'dark' : 'default';
		if (mermaidCurrentTheme === mermaidTheme) return;
		mermaidCurrentTheme = mermaidTheme;
		mermaid.initialize({ startOnLoad: false, theme: mermaidTheme });
	}

	function resetTransform(): void {
		scale = 1;
		tx = 0;
		ty = 0;
	}

	async function renderDiagram(code: string): Promise<void> {
		if (!previewContainer) return;
		ensureMermaidInitialized(resolveIsDark());
		const id = `marko-mermaid-${++renderCount}`;
		const source = code.trim() || FALLBACK_DIAGRAM;
		try {
			const { svg } = await mermaid.render(id, source);
			previewContainer.innerHTML = svg;
			renderError = null;
			lastRendered = code;
			const el = previewContainer.querySelector('svg');
			if (el) {
				const vb = el.viewBox?.baseVal;
				baseW = vb && vb.width ? vb.width : el.getBoundingClientRect().width;
				baseH = vb && vb.height ? vb.height : el.getBoundingClientRect().height;
				el.removeAttribute('width');
				el.removeAttribute('height');
				applyScaleToSvg();
			}
		} catch (e) {
			renderError = e instanceof Error ? e.message : 'Invalid mermaid diagram';
		}
	}

	function applyScaleToSvg(): void {
		const el = previewContainer?.querySelector('svg') as SVGSVGElement | null;
		if (!el || !baseW || !baseH) return;
		el.style.width = `${baseW * scale}px`;
		el.style.height = `${baseH * scale}px`;
	}

	const debouncedRender = debounce(renderDiagram, RENDER_DEBOUNCE_MS);

	function handleWheel(e: WheelEvent): void {
		e.preventDefault();
		const rect = previewViewport.getBoundingClientRect();
		const cx = e.clientX - rect.left;
		const cy = e.clientY - rect.top;
		const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
		const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * factor));
		const k = next / scale;
		tx = cx - k * (cx - tx);
		ty = cy - k * (cy - ty);
		scale = next;
	}

	function handlePointerDown(e: PointerEvent): void {
		if (e.button !== 0) return;
		isPanning = true;
		panStartX = e.clientX;
		panStartY = e.clientY;
		panOriginTx = tx;
		panOriginTy = ty;
		previewViewport.setPointerCapture(e.pointerId);
	}

	function handlePointerMove(e: PointerEvent): void {
		if (!isPanning) return;
		tx = panOriginTx + (e.clientX - panStartX);
		ty = panOriginTy + (e.clientY - panStartY);
	}

	function handlePointerUp(e: PointerEvent): void {
		if (!isPanning) return;
		isPanning = false;
		previewViewport.releasePointerCapture(e.pointerId);
	}

	function handleDividerPointerDown(e: PointerEvent): void {
		if (e.button !== 0) return;
		e.preventDefault();
		isDraggingDivider = true;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		document.body.style.userSelect = 'none';
		document.body.style.cursor = 'col-resize';
	}

	function handleDividerPointerMove(e: PointerEvent): void {
		if (!isDraggingDivider || !rootEl) return;
		e.preventDefault();
		const rect = rootEl.getBoundingClientRect();
		const ratio = (e.clientX - rect.left) / rect.width;
		splitRatio = Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));
	}

	function handleDividerPointerUp(e: PointerEvent): void {
		if (!isDraggingDivider) return;
		isDraggingDivider = false;
		(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
		document.body.style.userSelect = '';
		document.body.style.cursor = '';
	}

	function createExtensions() {
		return [
			history(),
			EditorState.allowMultipleSelections.of(true),
			rectangularSelection(),
			bracketMatching(),
			EditorView.lineWrapping,
			highlightActiveLine(),
			keymap.of([...searchKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
			search({ top: false }),
			themeCompartment.of(createTheme()),
			readonlyCompartment.of(EditorState.readOnly.of(readonly)),
			EditorView.updateListener.of((update) => {
				if (update.docChanged) {
					const newValue = update.state.doc.toString();
					onchange?.(newValue);
					debouncedRender.call(newValue);
				}
			}),
		];
	}

	function initEditor() {
		if (!editorContainer) return;
		if (view) {
			view.destroy();
			view = null;
		}
		view = new EditorView({
			state: EditorState.create({ doc: value, extensions: createExtensions() }),
			parent: editorContainer,
		});
	}

	onMount(() => {
		initEditor();
		renderDiagram(value);
	});

	onDestroy(() => {
		debouncedRender.cancel();
		if (view) {
			view.destroy();
			view = null;
		}
		document.body.style.userSelect = '';
		document.body.style.cursor = '';
	});

	$effect(() => {
		if (!view) return;
		const newValue = value;
		if (newValue === view.state.doc.toString()) return;
		view.setState(EditorState.create({ doc: newValue, extensions: createExtensions() }));
		untrack(() => {
			resetTransform();
			renderDiagram(newValue);
		});
	});

	$effect(() => {
		if (!view) return;
		view.dispatch({
			effects: readonlyCompartment.reconfigure(EditorState.readOnly.of(readonly)),
		});
	});

	$effect(() => {
		theme;
		untrack(() => {
			mermaidCurrentTheme = null;
			renderDiagram(lastRendered || value);
		});
	});

	$effect(() => {
		scale;
		untrack(applyScaleToSvg);
	});
</script>

<div bind:this={rootEl} class="flex flex-1 min-h-0 w-full overflow-hidden {isDraggingDivider ? 'select-none' : ''}">
	<div class="min-w-0 overflow-hidden" style="flex: 0 0 calc({splitRatio * 100}% - 3px);">
		<div bind:this={editorContainer} class="mermaid-editor w-full h-full"></div>
	</div>
	<div
		class="w-[6px] shrink-0 cursor-col-resize bg-(--color-border-default) hover:bg-(--color-accent-fg) transition-colors {isDraggingDivider ? 'bg-(--color-accent-fg)' : ''}"
		onpointerdown={handleDividerPointerDown}
		onpointermove={handleDividerPointerMove}
		onpointerup={handleDividerPointerUp}
		onpointercancel={handleDividerPointerUp}
		role="separator"
		aria-orientation="vertical"
		tabindex="-1"
	></div>
	<div
		bind:this={previewViewport}
		class="relative min-w-0 overflow-hidden bg-(--color-canvas-subtle) select-none touch-none {isPanning ? 'cursor-grabbing' : 'cursor-grab'}"
		style="flex: 0 0 calc({(1 - splitRatio) * 100}% - 3px);"
		onwheel={handleWheel}
		onpointerdown={handlePointerDown}
		onpointermove={handlePointerMove}
		onpointerup={handlePointerUp}
		onpointercancel={handlePointerUp}
		role="presentation"
	>
		{#if renderError}
			<pre class="absolute inset-0 m-6 text-(--color-fg-muted) text-[12px] whitespace-pre-wrap">⚠ {renderError}</pre>
		{/if}
		<div
			bind:this={previewContainer}
			class="marko-mermaid-preview absolute top-0 left-0 origin-top-left"
			class:hidden={!!renderError}
			style="transform: translate({tx}px, {ty}px);"
		></div>
		<div class="absolute bottom-2 right-2 flex gap-1 text-[11px] text-(--color-fg-muted) bg-(--color-canvas-default) border border-(--color-border-default) rounded px-2 py-1 pointer-events-auto">
			<button class="hover:text-(--color-fg-default)" onclick={() => { scale = Math.min(MAX_SCALE, scale * ZOOM_STEP); }} title="Zoom in">+</button>
			<span class="tabular-nums w-10 text-center">{Math.round(scale * 100)}%</span>
			<button class="hover:text-(--color-fg-default)" onclick={() => { scale = Math.max(MIN_SCALE, scale / ZOOM_STEP); }} title="Zoom out">−</button>
			<button class="ml-1 hover:text-(--color-fg-default)" onclick={resetTransform} title="Reset">⤾</button>
		</div>
	</div>
</div>

<style>
	.mermaid-editor :global(.cm-editor) {
		height: 100%;
		outline: none;
	}
	.mermaid-editor :global(.cm-scroller) {
		padding: 1.5rem;
		overflow-y: auto;
		font-family: 'SF Mono', 'Monaco', 'Menlo', monospace;
		font-size: 13px;
	}
	.mermaid-editor :global(.cm-content) {
		max-width: none;
	}
	.mermaid-editor :global(.cm-selectionBackground) {
		background-color: var(--color-selection) !important;
	}
	.mermaid-editor :global(.cm-focused .cm-selectionBackground) {
		background-color: var(--color-selection-focus) !important;
	}
	.mermaid-editor :global(.cm-cursor) {
		border-left-width: 2px;
	}
	:global(.marko-mermaid-preview svg) {
		max-width: none !important;
		height: auto;
		display: block;
	}
</style>
