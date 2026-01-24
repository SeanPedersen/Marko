<script lang="ts">
	import { tabManager } from '../stores/tabs.svelte.js';
	import Tab from './Tab.svelte';

	let { onnewTab, ondetach } = $props<{
		onnewTab: () => void;
		ondetach?: (tabId: string) => void;
	}>();

	let draggingId = $state<string | null>(null);

	function handleDragStart(e: DragEvent, id: string) {
		draggingId = id;
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
		}
	}

	function handleDragEnter(e: DragEvent, targetId: string) {
		if (!draggingId || draggingId === targetId) return;
		e.preventDefault();

		const fromIndex = tabManager.tabs.findIndex((t) => t.id === draggingId);
		const toIndex = tabManager.tabs.findIndex((t) => t.id === targetId);

		if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
			tabManager.reorderTabs(fromIndex, toIndex);
		}
	}

	function handleDragOver(e: DragEvent) {
		e.preventDefault();
	}

	function handleDragEnd(e: DragEvent) {
		if (draggingId && ondetach) {
			const { screenX, screenY } = e;
			// check if outside window bounds with some margin
			const margin = 50;
			const outX = screenX < window.screenX - margin || screenX > window.screenX + window.outerWidth + margin;
			const outY = screenY < window.screenY - margin || screenY > window.screenY + window.outerHeight + margin;

			if (outX || outY) {
				ondetach(draggingId);
			}
		}
		draggingId = null;
	}
</script>

<div
	class="tab-list-container"
	role="tablist"
	onwheel={(e) => {
		if (e.deltaY !== 0) {
			e.preventDefault();
			e.currentTarget.scrollLeft += e.deltaY;
		}
	}}>
	{#each tabManager.tabs as tab, i (tab.id)}
		<Tab
			{tab}
			isActive={tabManager.activeTabId === tab.id}
			isLast={i === tabManager.tabs.length - 1}
			onclick={() => tabManager.setActive(tab.id)}
			onclose={() => tabManager.closeTab(tab.id)}
			ondragstart={(e) => handleDragStart(e, tab.id)}
			ondragenter={(e) => handleDragEnter(e, tab.id)}
			ondragend={(e) => handleDragEnd(e)} />
	{/each}
	<button class="new-tab-btn" onclick={onnewTab} title="New tab (Ctrl+T)">
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
			><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
	</button>
</div>
<div class="tab-list-spacer" data-tauri-drag-region>
	<!-- Spacer to allow dragging the window from the empty space -->
</div>

<style>
	.tab-list-container {
		display: flex;
		flex-direction: row;
		align-items: flex-end;
		overflow-x: auto;
		overflow-y: hidden;
		gap: 4px;
		height: 100%;
		scrollbar-width: none;
		padding-left: 4px;
	}

	.tab-list-container::-webkit-scrollbar {
		display: none;
	}

	.new-tab-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		margin: 4px 4px 0 4px;
		border: none;
		background: transparent;
		color: var(--color-fg-muted);
		border-radius: 8px;
		cursor: pointer;
		flex-shrink: 0;
		transition:
			background 0.1s,
			color 0.1s;
	}

	.new-tab-btn:hover {
		background: var(--color-neutral-muted);
		color: var(--color-fg-default);
	}

	.tab-list-spacer {
		flex: 1;
		height: 100%;
		min-width: 50px;
	}
</style>
