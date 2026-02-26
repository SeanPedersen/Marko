<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import type { KanbanCard } from '$lib/utils/kanban.js';
	import CodeMirrorEditor from './CodeMirrorEditor.svelte';

	let {
		card,
		theme = 'system',
		readonly = false,
		onclose,
	}: {
		card: KanbanCard;
		theme?: 'system' | 'dark' | 'light';
		readonly?: boolean;
		onclose: (updatedTitle: string, updatedBody: string) => void;
	} = $props();

	let titleInput = $state(card.text);
	let bodyContent = $state(card.body);
	let titleEl: HTMLInputElement;
	let editorRef: ReturnType<typeof CodeMirrorEditor>;

	function handleClose() {
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
	});
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	class="modal-backdrop"
	role="presentation"
	onpointerdown={handleClose}
>
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="modal"
		transition:fly={{ y: 12, duration: 180, easing: cubicOut }}
		role="dialog"
		aria-modal="true"
		aria-label="Card details"
		onpointerdown={(e) => e.stopPropagation()}
	>
		<div class="modal-header">
			{#if readonly}
				<span class="modal-title-readonly">{card.text}</span>
			{:else}
				<input
					bind:this={titleEl}
					class="modal-title"
					type="text"
					bind:value={titleInput}
					placeholder="Card title…"
				/>
			{/if}
			<button class="modal-close" onclick={handleClose} title="Close" aria-label="Close">✕</button>
		</div>

		<div class="modal-body">
			<CodeMirrorEditor
				bind:this={editorRef}
				value={bodyContent}
				fileType="markdown"
				editorWidth="full"
				{theme}
				{readonly}
				onchange={(v) => { bodyContent = v; }}
			/>
		</div>
	</div>
</div>

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: 500;
		background: rgba(0, 0, 0, 0.35);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.modal {
		width: 660px;
		max-width: 90vw;
		height: 62vh;
		max-height: 680px;
		min-height: 300px;
		background: var(--color-canvas-default);
		border: 1px solid var(--color-border-default);
		border-radius: 10px;
		box-shadow: 0 12px 48px rgba(0, 0, 0, 0.28);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.modal-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--color-border-default);
		flex-shrink: 0;
	}

	.modal-title {
		flex: 1;
		font-size: 14px;
		font-weight: 600;
		font-family: inherit;
		border: none;
		background: transparent;
		color: var(--color-fg-default);
		outline: none;
		min-width: 0;
		padding: 2px 4px;
		border-radius: 3px;
	}

	.modal-title:focus {
		background: var(--color-canvas-subtle);
	}

	.modal-title-readonly {
		flex: 1;
		font-size: 14px;
		font-weight: 600;
		color: var(--color-fg-default);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.modal-close {
		background: none;
		border: none;
		cursor: pointer;
		color: var(--color-fg-muted);
		font-size: 13px;
		padding: 4px 6px;
		border-radius: 4px;
		line-height: 1;
		flex-shrink: 0;
	}

	.modal-close:hover {
		background: var(--color-neutral-muted);
		color: var(--color-fg-default);
	}

	.modal-body {
		flex: 1;
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}

	.modal-body :global(.cm-scroller) {
		padding: 1rem !important;
	}

	.modal-body :global(.cm-editor) {
		height: 100%;
	}
</style>
