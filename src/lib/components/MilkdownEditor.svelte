<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Editor, rootCtx, defaultValueCtx, editorViewOptionsCtx, editorViewCtx, parserCtx } from '@milkdown/core';
	import { commonmark } from '@milkdown/preset-commonmark';
	import { gfm } from '@milkdown/preset-gfm';
	import { nord } from '@milkdown/theme-nord';
	import { history } from '@milkdown/plugin-history';
	import { clipboard } from '@milkdown/plugin-clipboard';
	import { cursor } from '@milkdown/plugin-cursor';
	import { listener, listenerCtx } from '@milkdown/plugin-listener';

	let {
		value = '',
		readonly = false,
		theme = 'system',
		onchange,
		zoomLevel = 100,
	} = $props<{
		value?: string;
		readonly?: boolean;
		theme?: 'system' | 'dark' | 'light';
		onchange?: (value: string) => void;
		zoomLevel?: number;
	}>();

	let container: HTMLDivElement;
	let editor = $state<Editor | null>(null);
	let internalValue = '';
	let suppressListener = false;

	async function initializeEditor() {
		if (!container) return;

		if (editor) {
			await editor.destroy();
			editor = null;
		}

		internalValue = value;

		const instance = Editor.make()
			.config((ctx) => {
				ctx.set(rootCtx, container);
				ctx.set(defaultValueCtx, value || '');
				ctx.update(editorViewOptionsCtx, (prev) => ({
					...prev,
					editable: () => !readonly,
				}));

				ctx.get(listenerCtx).markdownUpdated((_ctx, markdown, _prevMarkdown) => {
					internalValue = markdown;
					if (!suppressListener) {
						onchange?.(markdown);
					}
					suppressListener = false;
				});
			})
			.config(nord)
			.use(commonmark)
			.use(gfm)
			.use(history)
			.use(clipboard)
			.use(cursor)
			.use(listener);

		await instance.create();
		editor = instance;
	}

	function replaceContent(newMarkdown: string) {
		if (!editor) return;

		try {
			editor.action((ctx) => {
				const view = ctx.get(editorViewCtx);
				const parser = ctx.get(parserCtx);
				const doc = parser(newMarkdown);
				if (!doc) return;
				const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content);
				suppressListener = true;
				view.dispatch(tr);
			});
			internalValue = newMarkdown;
		} catch (e) {
			console.error('Failed to replace editor content:', e);
		}
	}

	onMount(async () => {
		await initializeEditor();
	});

	onDestroy(async () => {
		if (editor) {
			await editor.destroy();
			editor = null;
		}
	});

	// Sync external value changes into the editor
	$effect(() => {
		if (!editor) return;
		const newValue = value;
		if (newValue === internalValue) return;

		replaceContent(newValue);
	});
</script>

<div
	bind:this={container}
	class="milkdown-container"
	style="font-size: {zoomLevel / 100}em;"
></div>

<style>
	.milkdown-container {
		width: 100%;
		height: 100%;
		padding: 2rem;
		box-sizing: border-box;
		overflow-y: auto;
	}

	.milkdown-container :global(.milkdown .ProseMirror) {
		outline: none;
		max-width: 720px;
		margin: 0 auto;
		padding: 0;
	}

	.milkdown-container :global(.milkdown h1),
	.milkdown-container :global(.milkdown h2),
	.milkdown-container :global(.milkdown h3),
	.milkdown-container :global(.milkdown h4),
	.milkdown-container :global(.milkdown h5),
	.milkdown-container :global(.milkdown h6) {
		color: var(--color-fg-default);
		margin-top: 1.5em;
		margin-bottom: 0.5em;
	}

	.milkdown-container :global(.milkdown p) {
		color: var(--color-fg-default);
		margin: 0.5em 0;
	}

	.milkdown-container :global(.milkdown blockquote) {
		border-left: 4px solid var(--color-border-default);
		padding-left: 1em;
		margin: 1em 0;
		color: var(--color-fg-muted);
	}

	.milkdown-container :global(.milkdown code) {
		background: var(--color-neutral-muted);
		padding: 0.2em 0.4em;
		border-radius: 3px;
		font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
	}

	.milkdown-container :global(.milkdown pre) {
		background: var(--color-canvas-subtle);
		padding: 1em;
		border-radius: 6px;
		overflow-x: auto;
		margin: 1em 0;
	}

	.milkdown-container :global(.milkdown pre code) {
		background: none;
		padding: 0;
	}

	.milkdown-container :global(.milkdown ul),
	.milkdown-container :global(.milkdown ol) {
		padding-left: 2em;
		margin: 0.5em 0;
	}

	.milkdown-container :global(.milkdown li) {
		margin: 0.25em 0;
	}

	.milkdown-container :global(.milkdown a) {
		color: var(--color-accent-fg);
		text-decoration: none;
	}

	.milkdown-container :global(.milkdown a:hover) {
		text-decoration: underline;
	}

	.milkdown-container :global(.milkdown table) {
		border-collapse: collapse;
		margin: 1em 0;
		width: 100%;
	}

	.milkdown-container :global(.milkdown th) {
		border: 1px solid var(--color-border-default);
		padding: 0.5em 1em;
		text-align: left;
		background: var(--color-canvas-subtle);
		font-weight: 600;
	}

	.milkdown-container :global(.milkdown td) {
		border: 1px solid var(--color-border-default);
		padding: 0.5em 1em;
		text-align: left;
	}
</style>
