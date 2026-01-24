<script lang="ts">
	import { tabManager } from '../stores/tabs.svelte.js';
	import Tab from './Tab.svelte';

	import { flip } from 'svelte/animate';
	import { scale } from 'svelte/transition';
	let { onnewTab, ondetach } = $props<{
		onnewTab: () => void;
		ondetach?: (tabId: string) => void;
	}>();

	let draggingId = $state<string | null>(null);
	let scrollContainer = $state<HTMLElement | null>(null);
	let showLeftArrow = $state(false);
	let showRightArrow = $state(false);

	function updateScrollArrows() {
		if (!scrollContainer) return;
		const { scrollLeft, scrollWidth, clientWidth } = scrollContainer;
		showLeftArrow = scrollLeft > 0;
		showRightArrow = Math.ceil(scrollLeft + clientWidth) < scrollWidth;
	}

	function handleDragStart(e: DragEvent, id: string) {
		draggingId = id;
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			// Must set data to be valid drag
			e.dataTransfer.setData('text/plain', id);
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
		// Crucial for allowing drop events and drag functionality
		e.preventDefault();
		e.dataTransfer!.dropEffect = 'move';
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

	function scroll(direction: 'left' | 'right') {
		if (!scrollContainer) return;
		const amount = 200;
		scrollContainer.scrollBy({ left: direction === 'left' ? -amount : amount, behavior: 'smooth' });
	}

	$effect(() => {
		// Watch for tab changes to update arrows
		const _ = tabManager.tabs;
		// Re-check after dom update
		requestAnimationFrame(updateScrollArrows);
	});

	$effect(() => {
		const activeId = tabManager.activeTabId;
		if (activeId && scrollContainer && !draggingId) {
			// Find the active tab element index
			const index = tabManager.tabs.findIndex((t) => t.id === activeId);
			if (index !== -1) {
				// We need to wait for the DOM to update if we just added a tab
				requestAnimationFrame(() => {
					if (!scrollContainer) return;
					const tabElements = scrollContainer.children;
					if (tabElements[index]) {
						const el = tabElements[index] as HTMLElement;
						el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
					}
				});
			}
		}
	});
</script>

<div class="tab-list-wrapper">
	<div class="scroll-viewport">
		<div class="scroll-shadow left" class:visible={showLeftArrow}></div>

		<div
			bind:this={scrollContainer}
			class="tab-list-container"
			role="tablist"
			onscroll={updateScrollArrows}
			onwheel={(e) => {
				if (e.deltaY !== 0) {
					e.preventDefault();
					e.currentTarget.scrollLeft += e.deltaY;
				}
			}}>
			{#each tabManager.tabs as tab, i (tab.id)}
				<div
					animate:flip={{ duration: draggingId ? 0 : 200 }}
					transition:scale={{ duration: 150, start: 0.9 }}
					draggable={true}
					ondragstart={(e) => handleDragStart(e, tab.id)}
					ondragenter={(e) => handleDragEnter(e, tab.id)}
					ondragover={handleDragOver}
					ondragend={(e) => handleDragEnd(e)}
					role="listitem">
					<Tab
						{tab}
						isActive={tabManager.activeTabId === tab.id}
						isLast={i === tabManager.tabs.length - 1}
						onclick={() => tabManager.setActive(tab.id)}
						onclose={() => tabManager.closeTab(tab.id)} />
				</div>
			{/each}
		</div>

		<div class="scroll-shadow right" class:visible={showRightArrow}></div>
	</div>

	<button class="new-tab-btn" onclick={onnewTab} title="New tab (Ctrl+T)">
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
			><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
	</button>
</div>
<div class="tab-list-spacer" data-tauri-drag-region>
	<!-- Spacer to allow dragging the window from the empty space -->
</div>

<style>
	.tab-list-wrapper {
		display: flex;
		align-items: center;
		height: 100%;
		overflow: hidden;
		flex: 1; /* Take all available space */
		min-width: 0;
	}

	.scroll-viewport {
		position: relative;
		display: flex;
		flex: 1;
		height: 100%;
		overflow: hidden;
		min-width: 0;
	}

	.scroll-shadow {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 40px;
		z-index: 20;
		pointer-events: none;
		opacity: 0;
		transition: opacity 0.2s ease;
	}

	.scroll-shadow.visible {
		opacity: 1;
	}

	.scroll-shadow.left {
		left: 0;
		background: linear-gradient(to right, var(--color-canvas-default), transparent);
	}

	.scroll-shadow.right {
		right: 0;
		background: linear-gradient(to left, var(--color-canvas-default), transparent);
	}

	.tab-list-container {
		display: flex;
		flex-direction: row;
		align-items: center;
		overflow-x: auto;
		overflow-y: hidden;
		gap: 4px;
		height: 100%;
		padding-left: 10px;
		scroll-behavior: smooth;
		width: 100%;
		/* Hide scrollbar */
		scrollbar-width: none;
		-ms-overflow-style: none;
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
		margin: 4px 4px 4px 4px;
		border: none;
		background: transparent;
		color: var(--color-fg-muted);
		border-radius: 8px;
		cursor: pointer;
		flex-shrink: 0;
		transition:
			background 0.1s,
			color 0.1s;
		z-index: 21; /* Ensure above shadow if overlapping? though it is outside viewport */
	}

	.new-tab-btn:hover {
		background: var(--color-neutral-muted);
		color: var(--color-fg-default);
	}

	.tab-list-spacer {
		flex: 0 0 30px;
		height: 100%;
		min-width: 30px;
	}
</style>
