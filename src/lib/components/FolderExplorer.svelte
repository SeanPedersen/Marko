<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';
	import { onMount } from 'svelte';

	type SortMode = 'az' | 'modified';

	interface DirEntry {
		name: string;
		path: string;
		is_dir: boolean;
		modified_at: number;
	}

	let {
		folderPath = '',
		visible = true,
		onopenfile,
		onfileschanged,
		refreshKey = 0,
	} = $props<{
		folderPath: string;
		visible?: boolean;
		onopenfile?: (path: string, options?: { newTab?: boolean }) => void;
		onfileschanged?: (removed: string[], added: string[]) => void;
		refreshKey?: number;
	}>();

	let entries = $state<DirEntry[]>([]);
	let expandedDirs = $state<Set<string>>(new Set());
	let dirContents = $state<Map<string, DirEntry[]>>(new Map());
	let knownFiles = new Set<string>();
	let loadingDirs = $state<Set<string>>(new Set());
	let sortMode = $state<SortMode>('az');

	function getSortPrefsMap(): Record<string, SortMode> {
		try {
			return JSON.parse(localStorage.getItem('folder-explorer-sort') || '{}');
		} catch {
			return {};
		}
	}

	function saveSortPref(folder: string, mode: SortMode) {
		const prefs = getSortPrefsMap();
		prefs[folder] = mode;
		localStorage.setItem('folder-explorer-sort', JSON.stringify(prefs));
	}

	function sortEntries(items: DirEntry[]): DirEntry[] {
		return [...items].sort((a, b) => {
			// Directories always first
			if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
			if (sortMode === 'modified') return b.modified_at - a.modified_at;
			return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
		});
	}

	function toggleSort() {
		sortMode = sortMode === 'az' ? 'modified' : 'az';
		if (folderPath) saveSortPref(folderPath, sortMode);
	}

	// Load expanded state and sort preference from localStorage
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

	function collectFilePaths(rootEntries: DirEntry[], dirMap: Map<string, DirEntry[]>): Set<string> {
		const paths = new Set<string>();
		function walk(items: DirEntry[]) {
			for (const e of items) {
				if (!e.is_dir) paths.add(e.path);
				else {
					const children = dirMap.get(e.path);
					if (children) walk(children);
				}
			}
		}
		walk(rootEntries);
		return paths;
	}

	// Load root directory when folderPath or refreshKey changes
	$effect(() => {
		const _refresh = refreshKey;
		if (folderPath) {
			// Restore sort preference for this folder
			const prefs = getSortPrefsMap();
			if (prefs[folderPath]) sortMode = prefs[folderPath];
			else sortMode = 'az';

			loadDirectory(folderPath).then(async (result) => {
				entries = result;
				// Load any previously expanded directories
				const expandedLoads: Promise<void>[] = [];
				for (const dir of expandedDirs) {
					if (dir.startsWith(folderPath)) {
						expandedLoads.push(
							loadDirectory(dir).then((contents) => {
								dirContents.set(dir, contents);
								dirContents = new Map(dirContents);
							})
						);
					}
				}
				await Promise.all(expandedLoads);

				const newFiles = collectFilePaths(entries, dirContents);
				if (knownFiles.size > 0 && onfileschanged) {
					const removed = [...knownFiles].filter((p) => !newFiles.has(p));
					const added = [...newFiles].filter((p) => !knownFiles.has(p));
					if (removed.length > 0 || added.length > 0) {
						onfileschanged(removed, added);
					}
				}
				knownFiles = newFiles;
			});
		} else {
			entries = [];
			knownFiles = new Set();
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

	function handleContextMenu(event: MouseEvent, entry: DirEntry) {
		event.preventDefault();
		event.stopPropagation();
		invoke('show_context_menu', {
			menuType: 'file_tree',
			path: entry.path,
			tabId: null,
			hasSelection: false,
		}).catch(console.error);
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
			oncontextmenu={(event) => handleContextMenu(event, entry)}
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
		{@const children = sortEntries(dirContents.get(entry.path) || [])}
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
			<button
				class="sort-toggle"
				onclick={toggleSort}
				title={sortMode === 'az' ? 'Sorted A–Z (click for recent)' : 'Sorted by recent (click for A–Z)'}
				aria-label="Toggle sort mode"
			>
				{#if sortMode === 'az'}
					<svg width="22" height="14" viewBox="0 0 34 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
						<path d="M3 17L7 5l4 12" /><path d="M4.5 13h5" />
						<path d="M27 6v12" /><path d="M23 14l4 4 4-4" />
					</svg>
				{:else}
					<svg width="22" height="14" viewBox="0 0 34 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<circle cx="9" cy="13" r="7" /><path d="M9 9v4l2.5 2.5" />
						<path d="M28 18V6" /><path d="M24 10l4-4 4 4" />
					</svg>
				{/if}
			</button>
		</div>
		<ul class="explorer-list">
			{#each sortEntries(entries) as entry}
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
		flex: 1;
	}

	.sort-toggle {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 28px;
		height: 22px;
		padding: 0;
		border: none;
		border-radius: 4px;
		background: none;
		color: var(--color-fg-muted);
		cursor: pointer;
		transition: color 0.1s, background 0.1s;
	}

	.sort-toggle:hover {
		color: var(--color-fg-default);
		background: var(--color-neutral-muted);
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
