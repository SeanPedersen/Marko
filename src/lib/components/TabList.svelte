<script lang="ts">
	import { type Tab as TabData, tabManager } from '../stores/tabs.svelte.js';
	import { invoke } from '@tauri-apps/api/core';
	import Tab from './Tab.svelte';

	import { flip } from 'svelte/animate';
	import { tick } from 'svelte';

	let {
		onnewTab,
		ondetach,
		ontabclick,
		oncloseTab,
		oncommitRename,
	} = $props<{
		onnewTab: () => void;
		ondetach?: (tabId: string) => void;
		ontabclick?: () => void;
		oncloseTab?: (id: string) => void;
		oncommitRename?: (id: string, newTitle: string) => void;
	}>();

	let scrollContainer = $state<HTMLElement | null>(null);
	let showLeftArrow = $state(false);
	let showRightArrow = $state(false);

	let draggingId = $state<string | null>(null);
	let justDragged = false;
	let dragState = $state<{
		startX: number;
		currentX: number;
		currentY: number;
		initialRect: DOMRect;
		tab: TabData;
		isDragging: boolean;
	} | null>(null);

	function handleMouseDown(e: MouseEvent, tab: TabData, element: HTMLElement) {
		if (e.button !== 0) return;
		if (tab.path === 'HOME') return;
		e.stopPropagation();

		const rect = element.getBoundingClientRect();
		dragState = {
			startX: e.clientX,
			currentX: e.clientX,
			currentY: e.clientY,
			initialRect: rect,
			tab: tab,
			isDragging: false,
		};

		window.addEventListener('mousemove', handleWindowMouseMove);
		window.addEventListener('mouseup', handleWindowMouseUp);
	}

	function handleWindowMouseMove(e: MouseEvent) {
		if (!dragState || !scrollContainer) return;

		if (!dragState.isDragging) {
			if (Math.abs(e.clientX - dragState.startX) > 5) {
				dragState.isDragging = true;
				draggingId = dragState.tab.id;
			} else {
				return;
			}
		}

		dragState.currentX = e.clientX;
		dragState.currentY = e.clientY;

		const containerRect = scrollContainer.getBoundingClientRect();
		const scrollZone = 50;
		if (e.clientX < containerRect.left + scrollZone) {
			scrollContainer.scrollLeft -= 10;
		} else if (e.clientX > containerRect.right - scrollZone) {
			scrollContainer.scrollLeft += 10;
		}

		const children = Array.from(scrollContainer.children) as HTMLElement[];
		let closestIndex = -1;
		let minDist = Infinity;

		children.forEach((child, index) => {
			if (!child.classList.contains('tab-item-wrapper')) return;

			const rect = child.getBoundingClientRect();
			const center = rect.left + rect.width / 2;
			const dist = Math.abs(e.clientX - center);

			if (dist < minDist) {
				minDist = dist;
				closestIndex = index;
			}
		});

		if (closestIndex !== -1) {
			const currentIndex = tabManager.tabs.findIndex((t) => t.id === draggingId);
			if (currentIndex !== -1 && currentIndex !== closestIndex) {
				tabManager.reorderTabs(currentIndex, closestIndex);
			}
		}
	}

	function handleWindowMouseUp() {
		if (dragState?.isDragging) {
			justDragged = true;
			setTimeout(() => {
				justDragged = false;
			}, 50);
		}

		draggingId = null;
		dragState = null;
		window.removeEventListener('mousemove', handleWindowMouseMove);
		window.removeEventListener('mouseup', handleWindowMouseUp);
	}

	$effect(() => {
		const activeId = tabManager.activeTabId;
		if (activeId && scrollContainer && !draggingId) {
			const index = tabManager.tabs.findIndex((t) => t.id === activeId);
			if (index !== -1) {
				tick().then(() => {
					setTimeout(() => {
						if (!scrollContainer) return;

						if (index === tabManager.tabs.length - 1) {
							scrollContainer.scrollTo({ left: 99999, behavior: 'smooth' });
							return;
						}

						const tabElements = scrollContainer.children;
						if (tabElements[index]) {
							const el = tabElements[index] as HTMLElement;
							el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
						}
					}, 150);
				});
			}
		}
	});

	async function handleContainerContextMenu(e: MouseEvent) {
		if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains('tab-list-spacer')) return;
		e.preventDefault();

		invoke('show_context_menu', {
			menuType: 'tab_bar',
			path: null,
			tabId: null,
			hasSelection: false,
			x: e.clientX,
			y: e.clientY,
		}).catch(console.error);
	}
</script>

<div class="flex items-center h-full overflow-hidden flex-1 min-w-0">
	<div class="relative flex flex-[0_1_auto] h-full overflow-hidden min-w-0 max-w-full">
		<div
			class="absolute top-0 bottom-0 left-0 w-[40px] z-20 pointer-events-none opacity-0 transition-opacity duration-200 ease-linear bg-[linear-gradient(to_right,var(--color-canvas-default),transparent)]"
			class:opacity-100={showLeftArrow}
		></div>

		<div
			bind:this={scrollContainer}
			class="tab-scroll-list flex flex-row items-center overflow-x-auto overflow-y-hidden gap-1 h-full pl-[10px] scroll-smooth [scrollbar-width:none] [-ms-overflow-style:none]"
			data-tauri-drag-region
			role="tablist"
			tabindex="-1"
			oncontextmenu={handleContainerContextMenu}
			onwheel={(e) => {
				if (e.deltaY !== 0) {
					e.preventDefault();
					e.currentTarget.scrollLeft += e.deltaY;
				}
			}}>
			{#each tabManager.tabs as tab, i (tab.id)}
				<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
				<div
					class="tab-item-wrapper transition-opacity duration-100"
					animate:flip={{ duration: 200 }}
					role="listitem"
					class:opacity-0={draggingId === tab.id}
					class:pointer-events-none={draggingId === tab.id}
					onmousedown={(e) => handleMouseDown(e, tab, e.currentTarget as HTMLElement)}>
					<Tab
						{tab}
						isActive={tabManager.activeTabId === tab.id}
						isLast={i === tabManager.tabs.length - 1}
						onclick={() => {
							if (justDragged) return;
							tabManager.setActive(tab.id);
							ontabclick?.();
						}}
						onclose={() => oncloseTab?.(tab.id)}
						onstartRename={() => tabManager.startRenaming(tab.id)}
						onrename={(newTitle) => oncommitRename?.(tab.id, newTitle)} />
				</div>
			{/each}
		</div>

		{#if draggingId && dragState}
			<div class="fixed z-[10000] pointer-events-none opacity-90 will-change-[left,top]" style:left="{dragState.initialRect.left + (dragState.currentX - dragState.startX)}px" style:top="{dragState.initialRect.top}px">
				<Tab tab={dragState.tab} isActive={tabManager.activeTabId === dragState.tab.id} onclick={() => {}} onclose={() => {}} />
			</div>
		{/if}

		<div
			class="absolute top-0 bottom-0 right-0 w-[40px] z-20 pointer-events-none opacity-0 transition-opacity duration-200 ease-linear bg-[linear-gradient(to_left,var(--color-canvas-default),transparent)]"
			class:opacity-100={showRightArrow}
		></div>
	</div>

	<button
		class="flex items-center justify-center w-7 h-7 m-1 border-none bg-transparent text-(--color-fg-muted) rounded-[8px] cursor-pointer shrink-0 transition-[background,color] duration-100 z-[21] hover:bg-(--color-neutral-muted) hover:text-(--color-fg-default)"
		onclick={onnewTab}
		title="New tab (Ctrl+T)">
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
			><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
	</button>

	<div class="tab-list-spacer flex-1 h-full min-w-[20px]" data-tauri-drag-region></div>
</div>

<style>
	:global(.tab-scroll-list::-webkit-scrollbar) {
		display: none;
	}
</style>
