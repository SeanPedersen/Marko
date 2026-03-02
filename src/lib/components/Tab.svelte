<script lang="ts">
	import type { Tab } from '../stores/tabs.svelte.js';
	import { invoke } from '@tauri-apps/api/core';
	import { settings } from '../stores/settings.svelte.js';
	import { tick, untrack } from 'svelte';

	let {
		tab,
		isActive,
		isLast,
		onclick,
		onclose,
		onrename,
		onstartRename,
	} = $props<{
		tab: Tab;
		isActive: boolean;
		isLast?: boolean;
		onclick: () => void;
		onclose: (e: MouseEvent) => void;
		onrename?: (newTitle: string) => void;
		onstartRename?: () => void;
	}>();

	let inputRef = $state<HTMLInputElement | null>(null);
	let editValue = $state(untrack(() => tab.title));

	$effect(() => {
		if (tab.isRenaming && inputRef) {
			editValue = tab.title;
			tick().then(() => {
				if (!inputRef) return;
				inputRef.focus();
				const lastDot = editValue.lastIndexOf('.');
				if (lastDot > 0) {
					inputRef.setSelectionRange(0, lastDot);
				} else {
					inputRef.select();
				}
			});
		}
	});

	function handleClose(e: MouseEvent) {
		e.stopPropagation();
		onclose(e);
	}

	function handleMiddleClick(e: MouseEvent) {
		if (e.button === 1) {
			e.preventDefault();
			e.stopPropagation();
			onclose(e);
		}
	}

	async function handleContextMenu(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();

		invoke('show_context_menu', {
			menuType: 'tab',
			path: tab.path || null,
			tabId: tab.id,
			hasSelection: false,
		}).catch(console.error);
	}

	function handleDoubleClick(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		if (tab.path !== 'HOME') {
			onstartRename?.();
		}
	}

	function handleInputKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			onrename?.(editValue);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			editValue = tab.title;
			onrename?.(tab.title);
		}
	}

	function handleInputBlur() {
		onrename?.(editValue);
	}

	let isHomeTab = $derived(tab.path === 'HOME');
	let showDirtyIndicator = $derived(tab.isDirty && !(settings.autoSave && tab.path));
	let forceShowActions = $derived(!tab.isRenaming && (isActive || showDirtyIndicator || !!tab.isDeleted));
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="group relative flex items-center h-7 {isHomeTab ? 'min-w-[40px] max-w-[40px]' : 'min-w-[100px] max-w-[200px]'} p-0 m-0 {isActive ? 'bg-(--color-tab-active-bg) text-(--color-fg-default)' : 'bg-transparent text-(--color-fg-muted)'} select-none text-[12px] [font-family:var(--font-win,_'Segoe_UI',_sans-serif)] rounded-[8px] transition-[background-color,color] duration-[250ms] ease-[cubic-bezier(0.05,0.95,0.05,0.95)] hover:bg-(--color-neutral-muted)"
	role="group"
	title={isHomeTab ? 'Home' : (tab.path || 'Untitled')}
	oncontextmenu={handleContextMenu}
>
	{#if tab.isRenaming}
		<input
			bind:this={inputRef}
			class="flex-1 h-5 mx-1 ml-2 px-1 border border-(--color-accent-fg) rounded-[4px] bg-(--color-canvas-default) text-(--color-fg-default) [font-family:inherit] text-[inherit] outline-none min-w-0"
			type="text"
			bind:value={editValue}
			onkeydown={handleInputKeydown}
			onblur={handleInputBlur}
			onclick={(e) => e.stopPropagation()}
		/>
	{:else}
		<button
			class="appearance-none bg-transparent border-none text-inherit flex items-center gap-1.5 flex-1 w-full h-full overflow-hidden cursor-pointer [font-family:inherit] text-[inherit] text-left {isHomeTab ? 'px-0 justify-center' : 'pl-3 pr-1'}"
			{onclick}
			onmousedown={handleMiddleClick}
			ondblclick={handleDoubleClick}
		>
			{#if isHomeTab}
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Home">
					<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
					<polyline points="9 22 9 12 15 12 15 22"></polyline>
				</svg>
			{:else}
				<span class="whitespace-nowrap overflow-hidden text-ellipsis">{tab.title}</span>
			{/if}
		</button>
	{/if}
	{#if !isHomeTab}
		<div
			class="flex items-center pr-1 opacity-0 transition-opacity group-hover:opacity-100"
			class:opacity-100={forceShowActions}
		>
			<button
				class="w-[18px] h-[18px] rounded-[4px] scale-[0.8] flex justify-center items-center bg-transparent border-none text-inherit cursor-pointer p-0 transition-[background] duration-100 relative hover:bg-(--color-neutral-muted)"
				onclick={handleClose}
				onmousedown={(e) => e.stopPropagation()}
				title="Close (Ctrl+W)"
			>
				{#if tab.isDeleted}
					<svg class="block group-hover:hidden text-[#d32f2f]" width="12" height="12" viewBox="0 0 16 16">
						<path fill="currentColor" d="M11 1.5v1h3.5a.5.5 0 0 1 0 1h-.538l-.853 10.66A2 2 0 0 1 11.115 16h-6.23a2 2 0 0 1-1.994-1.84L2.038 3.5H1.5a.5.5 0 0 1 0-1H5v-1A1.5 1.5 0 0 1 6.5 0h3A1.5 1.5 0 0 1 11 1.5m-5 0v1h4v-1a.5.5 0 0 0-.5-.5h-3a.5.5 0 0 0-.5.5M4.5 5.029l.5 8.5a.5.5 0 1 0 .998-.06l-.5-8.5a.5.5 0 1 0-.998.06m6.53-.528a.5.5 0 0 0-.528.47l-.5 8.5a.5.5 0 0 0 .998.058l.5-8.5a.5.5 0 0 0-.47-.528M8 4.5a.5.5 0 0 0-.5.5v8.5a.5.5 0 0 0 1 0V5a.5.5 0 0 0-.5-.5"/>
					</svg>
				{:else if showDirtyIndicator}
					<span class="w-2 h-2 bg-(--color-fg-default) rounded-full block group-hover:hidden"></span>
				{/if}
				<svg class="hidden group-hover:block" width="12" height="12" viewBox="0 0 12 12"
					><path fill="currentColor" d="M11 1.7L10.3 1 6 5.3 1.7 1 1 1.7 5.3 6 1 10.3 1.7 11 6 6.7 10.3 11 11 10.3 6.7 6z" /></svg>
			</button>
		</div>
	{/if}
</div>
