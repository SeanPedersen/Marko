<script lang="ts">
	import type { Tab } from '../stores/tabs.svelte.js';

	let { tab, isActive, isLast, onclick, onclose } = $props<{
		tab: Tab;
		isActive: boolean;
		isLast?: boolean;
		onclick: () => void;
		onclose: (e: MouseEvent) => void;
	}>();

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

		const { invoke } = await import('@tauri-apps/api/core');
		invoke('show_context_menu', {
			menuType: 'tab',
			path: tab.path || null,
			tabId: tab.id,
			hasSelection: false,
		}).catch(console.error);
	}

	// home tab has empty path
	let isHomeTab = $derived(tab.path === '');
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="tab {isActive ? 'active' : ''}" class:last={isLast} role="group" title={tab.path || 'Recents'} oncontextmenu={handleContextMenu}>
	<button class="tab-content-btn" {onclick} onmousedown={handleMiddleClick}>
		{#if isHomeTab}
			<span class="tab-icon">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
					><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
			</span>
		{:else}
			<span class="tab-icon">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
					><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
			</span>
		{/if}
		<span class="tab-label">
			{tab.title}
		</span>
	</button>
	<div class="tab-actions">
		<button class="tab-close" onclick={handleClose} title="Close (Ctrl+W)">
			<svg width="12" height="12" viewBox="0 0 12 12"><path fill="currentColor" d="M11 1.7L10.3 1 6 5.3 1.7 1 1 1.7 5.3 6 1 10.3 1.7 11 6 6.7 10.3 11 11 10.3 6.7 6z" /></svg>
		</button>
	</div>
</div>

<style>
	.tab {
		display: flex;
		align-items: center;
		height: 28px;
		min-width: 100px;
		max-width: 200px;
		padding: 0;
		margin: 0;
		background: transparent;
		color: var(--color-fg-muted);
		user-select: none;
		position: relative;
		font-size: 12px;
		font-family: var(--win-font, 'Segoe UI', sans-serif);
		border-radius: 8px;
		transition:
			background-color 0.25s cubic-bezier(0.05, 0.95, 0.05, 0.95),
			color 0.25s cubic-bezier(0.05, 0.95, 0.05, 0.95);
	}

	.tab.last {
		border-right: none;
	}

	/* wrapper styles */
	.tab:hover {
		background-color: var(--color-neutral-muted);
	}

	.tab.active {
		background-color: var(--tab-active-bg, #dee1e6);
		color: var(--color-fg-default);
	}

	@media (prefers-color-scheme: dark) {
		.tab.active {
			--tab-active-bg: #2d2e30;
		}
	}

	.tab-content-btn {
		appearance: none;
		background: transparent;
		border: none;
		color: inherit;
		display: flex;
		align-items: center;
		gap: 6px;
		flex: 1;
		width: 100%;
		height: 100%;
		padding: 0 4px 0 12px;
		overflow: hidden;
		cursor: pointer;
		font-family: inherit;
		font-size: inherit;
		text-align: left;
	}

	.tab-icon {
		display: flex;
		opacity: 0.6;
		flex-shrink: 0;
	}

	.tab-label {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.tab-actions {
		display: flex;
		align-items: center;
		padding-right: 4px;
		opacity: 0;
	}

	.tab:hover .tab-actions,
	.tab.active .tab-actions {
		opacity: 1;
	}

	.tab-close {
		width: 18px;
		height: 18px;
		border-radius: 4px;
		display: flex;
		scale: 0.8;
		justify-content: center;
		align-items: center;
		background: transparent;
		border: none;
		color: inherit;
		cursor: pointer;
		padding: 0;
		transition: background 0.1s;
	}

	.tab-close:hover {
		background-color: var(--color-neutral-muted);
	}
</style>
