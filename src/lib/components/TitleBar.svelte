<script lang="ts">
	import { getCurrentWindow } from '@tauri-apps/api/window';
	import { invoke } from '@tauri-apps/api/core';
	import { fly } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import TabList from './TabList.svelte';
	import { tabManager } from '../stores/tabs.svelte.js';
	import { settings } from '../stores/settings.svelte.js';

	let {
		isFocused,
		isScrolled,
		currentFile,
		windowTitle,
		onselectFile,
		ondetach,
		ontabclick,
		zoomLevel,
		onresetZoom,
		oncloseTab,
		oncommitRename,
		onnewTab,
		theme = 'system',
		onSetTheme,
		folderExplorerVisible = false,
		ontoggleFolderExplorer,
		showFolderExplorerButton = false,
		ontoggleSettings,
	} = $props<{
		isFocused: boolean;
		isScrolled: boolean;
		currentFile: string;
		windowTitle: string;
		onselectFile: () => void;
		ondetach?: (tabId: string) => void;
		ontabclick?: () => void;
		zoomLevel?: number;
		onresetZoom?: () => void;
		oncloseTab?: (id: string) => void;
		oncommitRename?: (id: string, newTitle: string) => void;
		onnewTab?: () => void;
		theme?: 'system' | 'dark' | 'light';
		onSetTheme?: (theme: 'system' | 'dark' | 'light') => void;
		folderExplorerVisible?: boolean;
		ontoggleFolderExplorer?: () => void;
		showFolderExplorerButton?: boolean;
		ontoggleSettings?: () => void;
	}>();

	const appWindow = getCurrentWindow();

	// DEBUG: Set this to true to simulate macOS traffic lights on Windows
	const DEBUG_MACOS = false;

	const isMac = typeof navigator !== 'undefined' && (navigator.userAgent.includes('Macintosh') || DEBUG_MACOS);
	const isLinux = typeof navigator !== 'undefined' && navigator.userAgent.includes('Linux') && !isMac;

	let isWin11 = $state(false);

	$effect(() => {
		invoke('is_win11')
			.then((res) => {
				isWin11 = res as boolean;
			})
			.catch(() => {
				isWin11 = false;
			});
	});

	let tooltip = $state({
		visible: false,
		text: '',
		shortcut: '',
		x: 0,
		y: 0,
		align: 'center' as 'left' | 'center' | 'right',
	});

	function showTooltip(e: MouseEvent, text: string, shortcutKey: string = '') {
		const target = e.currentTarget as HTMLElement;
		const rect = target.getBoundingClientRect();
		const modifier = isMac ? 'Cmd' : 'Ctrl';
		const windowWidth = window.innerWidth;
		const edgeThreshold = 100;

		tooltip.text = text;
		tooltip.shortcut = shortcutKey ? `${modifier}+${shortcutKey}` : '';

		if (rect.left < edgeThreshold) {
			tooltip.align = 'left';
			tooltip.x = rect.left;
		} else if (rect.right > windowWidth - edgeThreshold) {
			tooltip.align = 'right';
			tooltip.x = rect.right;
		} else {
			tooltip.align = 'center';
			tooltip.x = rect.left + rect.width / 2;
		}

		tooltip.y = rect.bottom + 8;
		tooltip.visible = true;
	}

	function hideTooltip() {
		tooltip.visible = false;
	}

	let visibleActionIds = $derived.by(() => {
		const list: string[] = [];
		if (zoomLevel && zoomLevel !== 100) list.push('zoom');
		list.push('settings');
		list.push('theme');
		return list;
	});

	let themeMenuOpen = $state(false);

	function handleSetTheme(t: 'system' | 'dark' | 'light') {
		if (onSetTheme) onSetTheme(t);
		themeMenuOpen = false;
	}

	$effect(() => {
		const handleGlobalClick = () => {
			themeMenuOpen = false;
		};
		if (themeMenuOpen) {
			window.addEventListener('click', handleGlobalClick);
		}
		return () => {
			window.removeEventListener('click', handleGlobalClick);
		};
	});

	let tooltipTransform = $derived.by(() => {
		const tx = tooltip.align === 'center' ? '-50%' : tooltip.align === 'right' ? '-100%' : '0';
		const ty = tooltip.visible ? '0' : '-4px';
		return `translateX(${tx}) translateY(${ty})`;
	});

	let tooltipAlignItems = $derived(
		tooltip.align === 'center' ? 'center' : tooltip.align === 'right' ? 'flex-end' : 'flex-start'
	);
</script>

<div
	class="h-9 bg-(--color-canvas-default) flex justify-between items-center select-none fixed top-0 left-0 right-0 z-[9999] [font-family:var(--font-win)] border-b transition-[border-color] duration-200 {isScrolled ? 'border-(--color-border-muted)' : 'border-transparent'}"
>
	{#if !isMac && !isWin11 && !isLinux}
		<div class="absolute top-0 left-0 right-0 h-px bg-(--color-window-border-top) z-[10002] pointer-events-none"></div>
	{/if}
	<div class="flex items-center pl-[10px] gap-3 relative z-[10000]" data-tauri-drag-region>
		{#if isMac}
			<div class="flex gap-2 mr-3 items-center pl-[2px] group/lights">
				<button class="w-3 h-3 rounded-full border border-black/10 flex justify-center items-center p-0 cursor-default outline-none relative overflow-hidden active:brightness-90 bg-[#ff5f57] [border-color:#e0443e]" onclick={() => appWindow.close()} aria-label="Close">
					<svg width="6" height="6" viewBox="0 0 6 6" class="opacity-0 text-[#4d0000] transition-opacity duration-100 group-hover/lights:opacity-[0.6]"
						><path d="M0.5 0.5L5.5 5.5M5.5 0.5L0.5 5.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" /></svg>
				</button>
				<button class="w-3 h-3 rounded-full border border-black/10 flex justify-center items-center p-0 cursor-default outline-none relative overflow-hidden active:brightness-90 bg-[#febc2e] [border-color:#d3a125]" onclick={() => appWindow.minimize()} aria-label="Minimize">
					<svg width="6" height="6" viewBox="0 0 6 6" class="opacity-0 text-[#995700] transition-opacity duration-100 group-hover/lights:opacity-[0.6]"><path d="M0.5 3H5.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" /></svg>
				</button>
				<button class="w-3 h-3 rounded-full border border-black/10 flex justify-center items-center p-0 cursor-default outline-none relative overflow-hidden active:brightness-90 bg-[#28c840] [border-color:#1ca431]" onclick={() => appWindow.toggleMaximize()} aria-label="Maximize">
					<svg width="6" height="6" viewBox="0 0 6 6" class="opacity-0 text-[#006500] transition-opacity duration-100 group-hover/lights:opacity-[0.6]"><path d="M0.5 3H5.5M3 0.5V5.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" /></svg>
				</button>
			</div>
		{/if}
		{#if showFolderExplorerButton}
			<button
				class="bg-transparent border-none p-1 rounded-[4px] flex items-center justify-center cursor-pointer transition-[background,color] duration-100 hover:bg-(--color-canvas-subtle) hover:text-(--color-fg-default) {folderExplorerVisible ? 'bg-(--color-canvas-subtle) text-(--color-accent-fg)' : 'text-(--color-fg-muted)'}"
				onclick={ontoggleFolderExplorer}
				aria-label="Toggle File Explorer"
			>
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
				</svg>
			</button>
		{/if}
	</div>

	{#if tabManager.tabs.length > 0 && settings.showTabs}
		<div class="flex flex-1 h-full overflow-hidden min-w-0 transition-[padding-left] duration-[150ms] ease-out">
			<TabList onnewTab={onnewTab ?? (() => tabManager.addNewTab())} {ondetach} {ontabclick} {oncloseTab} {oncommitRename} />
		</div>
	{:else}
		<div class="absolute left-0 right-0 top-0 bottom-0 flex justify-center items-center z-[5]" data-tauri-drag-region>
			<div
				class="text-[12px] transition-opacity duration-200 whitespace-nowrap overflow-hidden max-w-[50%] flex text-(--color-fg-default) {isFocused ? 'opacity-80' : 'opacity-40'}"
				data-tauri-drag-region
			>
				<span data-tauri-drag-region>{windowTitle}</span>
			</div>
		</div>
	{/if}

	<div class="flex gap-1 mr-2 ml-auto z-[10000]" data-tauri-drag-region>
		{#each visibleActionIds as id (id)}
			<div animate:flip={{ duration: 250 }}>
				{#if id === 'zoom'}
					<button
						class="bg-(--color-canvas-subtle) text-(--color-fg-muted) border border-(--color-border-default) rounded-[4px] px-2 py-[2px] text-[11px] cursor-pointer mr-2 flex items-center h-6 self-center transition-all duration-100 hover:text-(--color-fg-default) hover:border-(--color-border-muted)"
						onclick={onresetZoom}
						transition:fly={{ y: -10, duration: 150 }}
						aria-label="Reset Zoom"
						onmouseenter={(e) => showTooltip(e, 'Reset zoom')}
						onmouseleave={hideTooltip}>
						{zoomLevel}%
					</button>
				{:else if id === 'settings'}
					<button
						class="w-7 h-7 flex justify-center items-center bg-transparent border-none text-(--color-fg-muted) rounded-[4px] cursor-pointer transition-all duration-100 hover:bg-(--color-canvas-subtle) hover:text-(--color-fg-default)"
						onclick={ontoggleSettings}
						aria-label="Settings"
						onmouseenter={(e) => showTooltip(e, 'Settings')}
						onmouseleave={hideTooltip}
						transition:fly={{ x: 10, duration: 200 }}>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<circle cx="12" cy="12" r="3"></circle>
							<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
						</svg>
					</button>
				{:else if id === 'theme'}
					<div class="relative">
						<button
							class="w-7 h-7 flex justify-center items-center bg-transparent border-none rounded-[4px] cursor-pointer transition-all duration-100 hover:bg-(--color-canvas-subtle) hover:text-(--color-fg-default) {themeMenuOpen ? 'text-(--color-accent-fg) bg-(--color-canvas-subtle)' : 'text-(--color-fg-muted)'}"
							onclick={(e) => {
								e.stopPropagation();
								themeMenuOpen = !themeMenuOpen;
								if (themeMenuOpen) hideTooltip();
							}}
							aria-label="Change Theme"
							onmouseenter={(e) => {
								if (!themeMenuOpen) showTooltip(e, 'Change Theme');
							}}
							onmouseleave={hideTooltip}
							transition:fly={{ x: 10, duration: 200 }}>
							{#if theme === 'light'}
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
									><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line
										x1="4.22"
										y1="4.22"
										x2="5.64"
										y2="5.64"></line
									><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line
										x1="4.22"
										y1="19.78"
										x2="5.64"
										y2="18.36"></line
									><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>
							{:else if theme === 'dark'}
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
									><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
							{:else}
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
									><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
							{/if}
						</button>
						{#if themeMenuOpen}
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<div class="absolute top-full right-0 mt-1 bg-(--color-canvas-default) border border-(--color-border-default) rounded-[6px] shadow-[0_8px_24px_rgba(0,0,0,0.2)] p-1 flex flex-col w-[120px] z-[10005]" transition:fly={{ y: 5, duration: 150 }} onclick={(e) => e.stopPropagation()}>
								<button class="bg-transparent border-none text-left px-3 py-[6px] text-[12px] cursor-pointer rounded-[4px] [font-family:var(--font-win)] hover:bg-(--color-canvas-subtle) {theme === 'system' ? 'text-(--color-accent-fg) font-semibold' : 'text-(--color-fg-default)'}" onclick={() => handleSetTheme('system')}> Follow System </button>
								<button class="bg-transparent border-none text-left px-3 py-[6px] text-[12px] cursor-pointer rounded-[4px] [font-family:var(--font-win)] hover:bg-(--color-canvas-subtle) {theme === 'light' ? 'text-(--color-accent-fg) font-semibold' : 'text-(--color-fg-default)'}" onclick={() => handleSetTheme('light')}> Light </button>
								<button class="bg-transparent border-none text-left px-3 py-[6px] text-[12px] cursor-pointer rounded-[4px] [font-family:var(--font-win)] hover:bg-(--color-canvas-subtle) {theme === 'dark' ? 'text-(--color-accent-fg) font-semibold' : 'text-(--color-fg-default)'}" onclick={() => handleSetTheme('dark')}> Dark </button>
							</div>
						{/if}
					</div>
				{/if}
			</div>
		{/each}
	</div>

	<div class="flex h-full relative z-[10000]" data-tauri-drag-region>
		{#if isLinux}
			<div class="flex items-center gap-[6px] pl-[10px] pr-[6px] h-full" data-tauri-drag-region>
				<button class="w-6 h-6 rounded-full flex justify-center items-center bg-(--color-canvas-subtle) text-(--color-fg-muted) border-none cursor-default transition-colors duration-100 hover:bg-(--color-neutral-muted) hover:text-(--color-fg-default)" onclick={() => appWindow.minimize()} aria-label="Minimize">
					<svg width="12" height="12" viewBox="0 0 12 12"><rect fill="currentColor" width="10" height="1" x="1" y="6" /></svg>
				</button>
				<button class="w-6 h-6 rounded-full flex justify-center items-center bg-(--color-canvas-subtle) text-(--color-fg-muted) border-none cursor-default transition-colors duration-100 hover:bg-(--color-neutral-muted) hover:text-(--color-fg-default)" onclick={() => appWindow.toggleMaximize()} aria-label="Maximize">
					<svg width="12" height="12" viewBox="0 0 12 12"><rect fill="none" stroke="currentColor" stroke-width="1" width="9" height="9" x="1.5" y="1.5" /></svg>
				</button>
				<button class="w-6 h-6 rounded-full flex justify-center items-center bg-(--color-canvas-subtle) text-(--color-fg-muted) border-none cursor-default transition-colors duration-100 hover:bg-[#e81123] hover:text-white" onclick={() => appWindow.close()} aria-label="Close">
					<svg width="12" height="12" viewBox="0 0 12 12"><path fill="currentColor" d="M11 1.7L10.3 1 6 5.3 1.7 1 1 1.7 5.3 6 1 10.3 1.7 11 6 6.7 10.3 11 11 10.3 6.7 6z" /></svg>
				</button>
			</div>
		{:else if !isMac}
			<button class="w-[46px] h-8 flex justify-center items-center bg-transparent border-none text-(--color-fg-default) opacity-80 cursor-default transition-all duration-100 hover:bg-(--color-canvas-subtle) hover:opacity-100" onclick={() => appWindow.minimize()} aria-label="Minimize">
				<svg width="12" height="12" viewBox="0 0 12 12"><rect fill="currentColor" width="10" height="1" x="1" y="6" /></svg>
			</button>
			<button class="w-[46px] h-8 flex justify-center items-center bg-transparent border-none text-(--color-fg-default) opacity-80 cursor-default transition-all duration-100 hover:bg-(--color-canvas-subtle) hover:opacity-100" onclick={() => appWindow.toggleMaximize()} aria-label="Maximize">
				<svg width="12" height="12" viewBox="0 0 12 12"><rect fill="none" stroke="currentColor" stroke-width="1" width="9" height="9" x="1.5" y="1.5" /></svg>
			</button>
			<button
				class="w-[46px] h-8 flex justify-center items-center bg-transparent border-none text-(--color-fg-default) opacity-80 cursor-default transition-all duration-100 hover:opacity-100 hover:bg-[#e81123] hover:text-white"
				onclick={() => {
					console.log('Close button clicked');
					appWindow.close();
				}}
				aria-label="Close">
				<svg width="12" height="12" viewBox="0 0 12 12"><path fill="currentColor" d="M11 1.7L10.3 1 6 5.3 1.7 1 1 1.7 5.3 6 1 10.3 1.7 11 6 6.7 10.3 11 11 10.3 6.7 6z" /></svg>
			</button>
		{/if}
	</div>
</div>

<div
	class="fixed flex flex-col whitespace-nowrap gap-[2px] bg-(--color-canvas-overlay) text-(--color-fg-default) px-2 py-1 rounded-[6px] text-[11px] [font-family:var(--font-win),'Segoe_UI',sans-serif] pointer-events-none z-[10005] shadow-[0_4px_12px_rgba(0,0,0,0.15)] border border-(--color-border-default) transition-[opacity,transform] duration-150 {tooltip.visible ? 'opacity-100' : 'opacity-0'}"
	style="left: {tooltip.x}px; top: {tooltip.y}px; transform: {tooltipTransform}; align-items: {tooltipAlignItems};"
>
	<span>{tooltip.text}</span>
	{#if tooltip.shortcut}
		<span class="text-(--color-fg-muted) text-[10px]">{tooltip.shortcut}</span>
	{/if}
</div>
