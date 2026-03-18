<script lang="ts">
	import { onMount, onDestroy, untrack } from 'svelte';
	import { fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import type { KanbanCard } from '$lib/utils/kanban.js';
	import type { FileIndex } from '$lib/utils/wikiLinks';
	import CodeMirrorEditor from './CodeMirrorEditor.svelte';

	let {
		card,
		theme = 'system',
		readonly = false,
		fileIndex = { entries: [], byBasename: new Map(), byFilename: new Map() } as FileIndex,
		onclose,
		onchange,
	}: {
		card: KanbanCard;
		theme?: 'system' | 'dark' | 'light';
		readonly?: boolean;
		fileIndex?: FileIndex;
		onclose: (updatedTitle: string, updatedBody: string) => void;
		onchange?: (updatedTitle: string, updatedBody: string) => void;
	} = $props();

	let titleInput = $state(untrack(() => card.text));
	let bodyContent = $state(untrack(() => card.body));
	let editorRef: ReturnType<typeof CodeMirrorEditor>;
	let closed = false;

	function emitChange() {
		onchange?.(titleInput.trim() || card.text, bodyContent);
	}

	function handleClose() {
		if (closed) return;
		closed = true;
		onclose(titleInput.trim() || card.text, bodyContent);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			handleClose();
		}
	}

	onMount(() => {
		editorRef?.focus();
		document.addEventListener('keydown', handleKeydown, { capture: true });
	});

	onDestroy(() => {
		document.removeEventListener('keydown', handleKeydown, { capture: true });
		handleClose();
	});
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	class="fixed inset-0 z-[500] bg-black/35 flex items-center justify-center"
	role="presentation"
	onpointerdown={handleClose}
>
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="w-[660px] max-w-[90vw] h-[62vh] max-h-[680px] min-h-[300px] bg-(--color-canvas-default) border border-(--color-border-default) rounded-[10px] shadow-[0_12px_48px_rgba(0,0,0,0.28)] flex flex-col overflow-hidden"
		transition:fly={{ y: 12, duration: 180, easing: cubicOut }}
		role="dialog"
		tabindex="-1"
		aria-modal="true"
		aria-label="Card details"
		onpointerdown={(e) => e.stopPropagation()}
	>
		<div class="flex items-center gap-2 px-4 py-3 border-b border-(--color-border-default) shrink-0">
			{#if readonly}
				<span class="flex-1 text-[14px] font-semibold text-(--color-fg-default) overflow-hidden text-ellipsis whitespace-nowrap">{card.text}</span>
			{:else}
				<input
					class="flex-1 text-[14px] font-semibold [font-family:inherit] border-none bg-transparent text-(--color-fg-default) outline-none min-w-0 px-1 py-0.5 rounded-[3px] focus:bg-(--color-canvas-subtle)"
					type="text"
					bind:value={titleInput}
					oninput={emitChange}
					placeholder="Card title…"
				/>
			{/if}
			<button class="bg-none border-none cursor-pointer text-(--color-fg-muted) text-[13px] px-1.5 py-1 rounded-[4px] leading-none shrink-0 hover:bg-(--color-neutral-muted) hover:text-(--color-fg-default)" onclick={handleClose} title="Close" aria-label="Close">✕</button>
		</div>

		<div class="flex-1 overflow-hidden flex flex-col">
			<CodeMirrorEditor
				bind:this={editorRef}
				value={bodyContent}
				fileType="markdown"
				editorWidth="full"
				{theme}
				{readonly}
				{fileIndex}
				onchange={(v) => { bodyContent = v; emitChange(); }}
			/>
		</div>
	</div>
</div>

<style>
	div :global(.cm-scroller) {
		padding: 1rem !important;
	}

	div :global(.cm-editor) {
		height: 100%;
	}
</style>
