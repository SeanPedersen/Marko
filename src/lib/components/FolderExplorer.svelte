<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';
	import { onMount } from 'svelte';

	interface DirEntry {
		name: string;
		path: string;
		is_dir: boolean;
	}

	let {
		folderPath = '',
		visible = true,
		onopenfile,
	} = $props<{
		folderPath: string;
		visible?: boolean;
		onopenfile?: (path: string, options?: { newTab?: boolean }) => void;
	}>();

	let entries = $state<DirEntry[]>([]);
	let expandedDirs = $state<Set<string>>(new Set());
	let dirContents = $state<Map<string, DirEntry[]>>(new Map());
	let loadingDirs = $state<Set<string>>(new Set());

	// Load expanded state from localStorage
	onMount(() => {
		const stored = localStorage.getItem('folder-explorer-expanded');
		if (stored) {
			try {
				expandedDirs = new Set(JSON.parse(stored));
			} catch (e) {
				console.error('Failed to parse expanded dirs:', e);
			}
		}
	});

	// Save expanded state to localStorage
	$effect(() => {
		localStorage.setItem('folder-explorer-expanded', JSON.stringify([...expandedDirs]));
	});

	// Load root directory when folderPath changes
	$effect(() => {
		if (folderPath) {
			loadDirectory(folderPath).then((result) => {
				entries = result;
				// Load any previously expanded directories
				for (const dir of expandedDirs) {
					if (dir.startsWith(folderPath)) {
						loadDirectory(dir).then((contents) => {
							dirContents.set(dir, contents);
							dirContents = new Map(dirContents);
						});
					}
				}
			});
		} else {
			entries = [];
		}
	});

	async function loadDirectory(path: string): Promise<DirEntry[]> {
		try {
			return await invoke('read_directory', { path });
		} catch (e) {
			console.error('Failed to load directory:', e);
			return [];
		}
	}

	async function toggleDir(entry: DirEntry) {
		if (!entry.is_dir) return;

		if (expandedDirs.has(entry.path)) {
			expandedDirs.delete(entry.path);
			expandedDirs = new Set(expandedDirs);
		} else {
			loadingDirs.add(entry.path);
			loadingDirs = new Set(loadingDirs);

			const contents = await loadDirectory(entry.path);
			dirContents.set(entry.path, contents);
			dirContents = new Map(dirContents);

			expandedDirs.add(entry.path);
			expandedDirs = new Set(expandedDirs);

			loadingDirs.delete(entry.path);
			loadingDirs = new Set(loadingDirs);
		}
	}

	function handleFileClick(event: MouseEvent, entry: DirEntry) {
		if (entry.is_dir) {
			toggleDir(entry);
		} else {
			const ext = entry.name.split('.').pop()?.toLowerCase() || '';
			const isMarkdown = ['md', 'markdown', 'mdown', 'mkd'].includes(ext);
			if (isMarkdown && onopenfile) {
				const newTab = event.button === 1; // Middle mouse button
				onopenfile(entry.path, { newTab });
			}
		}
	}

	function getFileIcon(entry: DirEntry): string {
		if (entry.is_dir) {
			return expandedDirs.has(entry.path) ? 'folder-open' : 'folder';
		}
		const ext = entry.name.split('.').pop()?.toLowerCase() || '';
		if (['md', 'markdown', 'mdown', 'mkd'].includes(ext)) {
			return 'markdown';
		}
		return 'file';
	}

	function getDepth(path: string): number {
		if (!folderPath) return 0;
		const relativePath = path.replace(folderPath, '');
		return (relativePath.match(/[/\\]/g) || []).length;
	}

	function getFolderName(path: string): string {
		return path.split(/[/\\]/).pop() || path;
	}
</script>

{#snippet renderEntry(entry: DirEntry, depth: number)}
	{@const icon = getFileIcon(entry)}
	{@const isMarkdown = !entry.is_dir && ['md', 'markdown', 'mdown', 'mkd'].includes(entry.name.split('.').pop()?.toLowerCase() || '')}
	{@const isLoading = loadingDirs.has(entry.path)}
	<li class="explorer-item" style="padding-left: {depth * 12 + 8}px">
		<button
			class="explorer-link"
			class:is-dir={entry.is_dir}
			class:is-markdown={isMarkdown}
			class:disabled={!entry.is_dir && !isMarkdown}
			onclick={(event) => handleFileClick(event, entry)}
			onauxclick={(event) => { if (event.button === 1) handleFileClick(event, entry); }}
			title={entry.path}
		>
			<span class="icon">
				{#if isLoading}
					<svg class="spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<circle cx="12" cy="12" r="10" stroke-dasharray="30 60" />
					</svg>
				{:else if icon === 'folder'}
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
					</svg>
				{:else if icon === 'folder-open'}
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v1" />
						<path d="M22 11H8l-2 8h16l-2-8z" />
					</svg>
				{:else if icon === 'markdown'}
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
						<polyline points="14 2 14 8 20 8" />
					</svg>
				{:else}
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
						<polyline points="14 2 14 8 20 8" />
					</svg>
				{/if}
			</span>
			<span class="name">{entry.name}</span>
			{#if entry.is_dir}
				<span class="chevron" class:expanded={expandedDirs.has(entry.path)}>
					<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<polyline points="9 18 15 12 9 6" />
					</svg>
				</span>
			{/if}
		</button>
	</li>
	{#if entry.is_dir && expandedDirs.has(entry.path)}
		{@const children = dirContents.get(entry.path) || []}
		{#each children as child}
			{@render renderEntry(child, depth + 1)}
		{/each}
		{#if children.length === 0 && !loadingDirs.has(entry.path)}
			<li class="explorer-item empty" style="padding-left: {(depth + 1) * 12 + 8}px">
				<span class="empty-text">Empty folder</span>
			</li>
		{/if}
	{/if}
{/snippet}

{#if visible && folderPath}
	<nav class="explorer-sidebar" aria-label="File explorer">
		<div class="explorer-header">
			<span class="header-text" title={folderPath}>{getFolderName(folderPath)}</span>
		</div>
		<ul class="explorer-list">
			{#each entries as entry}
				{@render renderEntry(entry, 0)}
			{/each}
			{#if entries.length === 0}
				<li class="explorer-item empty">
					<span class="empty-text">No files found</span>
				</li>
			{/if}
		</ul>
	</nav>
{/if}

<style>
	.explorer-sidebar {
		position: fixed;
		top: 36px;
		left: 0;
		bottom: 0;
		width: 220px;
		background: var(--color-canvas-default);
		border-right: 1px solid var(--color-border-default);
		overflow-y: auto;
		overflow-x: hidden;
		z-index: 50;
		font-family: var(--win-font);
		padding-top: 8px;
		animation: slideIn 0.15s ease-out;
	}

	@keyframes slideIn {
		from {
			transform: translateX(-100%);
			opacity: 0;
		}
		to {
			transform: translateX(0);
			opacity: 1;
		}
	}

	.explorer-header {
		padding: 4px 12px 8px;
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		color: var(--color-fg-muted);
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.header-text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.explorer-list {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.explorer-item {
		position: relative;
	}

	.explorer-item.empty {
		padding: 8px 12px;
	}

	.empty-text {
		color: var(--color-fg-muted);
		font-size: 11px;
		font-style: italic;
	}

	.explorer-link {
		display: flex;
		align-items: center;
		width: 100%;
		padding: 3px 8px;
		border: none;
		background: none;
		color: var(--color-fg-muted);
		font-size: 12.5px;
		line-height: 1.4;
		text-align: left;
		cursor: pointer;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		transition: color 0.1s, background 0.1s;
		gap: 6px;
	}

	.explorer-link:hover {
		color: var(--color-fg-default);
		background: var(--color-neutral-muted);
	}

	.explorer-link.is-dir {
		color: var(--color-fg-default);
	}

	.explorer-link.is-markdown {
		color: var(--color-fg-muted);
	}

	.explorer-link.is-markdown:hover {
		color: var(--color-accent-fg);
	}

	.explorer-link.disabled {
		opacity: 0.5;
		cursor: default;
	}

	.explorer-link.disabled:hover {
		background: none;
		color: var(--color-fg-muted);
	}

	.icon {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		flex: 1;
	}

	.chevron {
		display: flex;
		align-items: center;
		justify-content: center;
		margin-left: auto;
		transition: transform 0.15s ease;
	}

	.chevron.expanded {
		transform: rotate(90deg);
	}

	.spinner {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}

	/* Scrollbar styling */
	.explorer-sidebar::-webkit-scrollbar {
		width: 4px;
	}

	.explorer-sidebar::-webkit-scrollbar-track {
		background: transparent;
	}

	.explorer-sidebar::-webkit-scrollbar-thumb {
		background: var(--color-neutral-muted);
		border-radius: 2px;
	}
</style>
