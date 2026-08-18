<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';
	import { onMount, tick } from 'svelte';
	import { debounce } from '$lib/utils/debounce';
	import { settings } from '$lib/stores/settings.svelte';

	type SortMode = 'az' | 'modified';

	interface DirEntry {
		name: string;
		path: string;
		is_dir: boolean;
		modified_at: number;
	}

	interface ContentSearchResult {
		path: string;
		hits: number;
	}

	let {
		folderPath = '',
		visible = true,
		activePath = '',
		onopenfile,
		onfileschanged,
		onswitchfolder,
		refreshKey = 0,
		sidebarPosition = 'left',
		recentFolders = [],
	} = $props<{
		folderPath: string;
		visible?: boolean;
		activePath?: string;
		onopenfile?: (path: string, options?: { newTab?: boolean }) => void;
		onfileschanged?: (removed: string[], added: string[]) => void;
		onswitchfolder?: (path: string) => void;
		refreshKey?: number;
		sidebarPosition?: 'left' | 'right';
		recentFolders?: string[];
	}>();

	let entries = $state<DirEntry[]>([]);
	let expandedDirs = $state<Set<string>>(new Set());
	let dirContents = $state<Map<string, DirEntry[]>>(new Map());
	let knownFiles = new Set<string>();
	let loadingDirs = $state<Set<string>>(new Set());
	let sortMode = $state<SortMode>('az');
	let searchOpen = $state(false);
	let searchQuery = $state('');
	let searchInputEl = $state<HTMLInputElement | null>(null);
	let gitStatuses = $state<Map<string, string>>(new Map());
	let isSyncing = $state(false);
	let newFileDir = $state<string | null>(null);
	let newFileName = $state('');
	let newFileInputEl = $state<HTMLInputElement | null>(null);
	let isGitRepo = $state(false);
	let gitAhead = $state(0);
	let gitBehind = $state(0);
	let contentResults = $state<ContentSearchResult[]>([]);
	let contentSearching = $state(false);
	let isResizing = $state(false);
	let folderPickerOpen = $state(false);
	let folderPickerEl = $state<HTMLDivElement | null>(null);

	// Other recent folders (exclude current)
	let otherFolders = $derived(recentFolders.filter((f: string) => f !== folderPath));

	function toggleFolderPicker() {
		if (otherFolders.length === 0) return;
		folderPickerOpen = !folderPickerOpen;
	}

	function handlePickerFolder(path: string) {
		folderPickerOpen = false;
		onswitchfolder?.(path);
	}

	function handlePickerClickOutside(e: MouseEvent) {
		if (folderPickerOpen && folderPickerEl && !folderPickerEl.contains(e.target as Node)) {
			folderPickerOpen = false;
		}
	}

	$effect(() => {
		if (folderPickerOpen) {
			document.addEventListener('mousedown', handlePickerClickOutside);
			return () => document.removeEventListener('mousedown', handlePickerClickOutside);
		}
	});

	const RESIZE_MIN = 160;
	const RESIZE_MAX = 480;

	function handleResizeStart(e: MouseEvent) {
		e.preventDefault();
		isResizing = true;
		document.body.style.userSelect = 'none';
		document.body.style.cursor = 'col-resize';
		const startX = e.clientX;
		const startWidth = settings.folderExplorerWidth;

		function onMouseMove(e: MouseEvent) {
			const delta = sidebarPosition === 'right' ? startX - e.clientX : e.clientX - startX;
			settings.folderExplorerWidth = Math.max(RESIZE_MIN, Math.min(RESIZE_MAX, startWidth + delta));
		}

		function onMouseUp() {
			isResizing = false;
			document.body.style.userSelect = '';
			document.body.style.cursor = '';
			window.removeEventListener('mousemove', onMouseMove);
			window.removeEventListener('mouseup', onMouseUp);
		}

		window.addEventListener('mousemove', onMouseMove);
		window.addEventListener('mouseup', onMouseUp);
	}

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

	// Reset knownFiles when the folder itself changes (not just refreshKey)
	let prevFolder = '';
	$effect(() => {
		if (folderPath !== prevFolder) {
			knownFiles = new Set();
			prevFolder = folderPath;
		}
	});

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

	// Fetch git status when folder or refreshKey changes
	$effect(() => {
		const _refresh = refreshKey;
		if (folderPath) {
			invoke('get_git_status', { path: folderPath }).then((result) => {
				gitStatuses = new Map(Object.entries(result as Record<string, string>));
				isGitRepo = true;
				fetchAheadBehind();
			}).catch(() => {
				gitStatuses = new Map();
				isGitRepo = false;
				gitAhead = 0;
				gitBehind = 0;
			});
		} else {
			gitStatuses = new Map();
			isGitRepo = false;
			gitAhead = 0;
			gitBehind = 0;
		}
	});

	function fetchAheadBehind() {
		if (!folderPath) return;
		invoke('get_git_ahead_behind', { path: folderPath }).then((result) => {
			const ab = result as { ahead: number; behind: number } | null;
			gitAhead = ab?.ahead ?? 0;
			gitBehind = ab?.behind ?? 0;
		}).catch(() => {
			gitAhead = 0;
			gitBehind = 0;
		});
	}

	async function handleSync() {
		if (isSyncing || !folderPath) return;
		isSyncing = true;
		try {
			await invoke('git_sync', { path: folderPath });
		} catch (e) {
			console.error('Git sync failed:', e);
		} finally {
			isSyncing = false;
			fetchAheadBehind();
		}
	}

	const STATUS_PRIORITY: Record<string, number> = {
		conflicted: 5,
		modified: 4,
		staged_modified: 4,
		staged: 3,
		untracked: 2,
		deleted: 1,
		renamed: 1,
	};

	function getDirStatus(dirPath: string): string | undefined {
		let best: string | undefined;
		let bestPriority = 0;
		for (const [filePath, status] of gitStatuses) {
			if (filePath.startsWith(dirPath + '/')) {
				const p = STATUS_PRIORITY[status] ?? 0;
				if (p > bestPriority) {
					bestPriority = p;
					best = status;
				}
			}
		}
		return best;
	}

	function getEntryStatus(entry: DirEntry): string | undefined {
		if (entry.is_dir) return getDirStatus(entry.path);
		return gitStatuses.get(entry.path);
	}

	function statusBadge(status: string): { letter: string; color: string } {
		switch (status) {
			case 'modified':
			case 'staged_modified':
				return { letter: 'M', color: '#d29922' };
			case 'staged':
				return { letter: 'A', color: '#3fb950' };
			case 'untracked':
				return { letter: 'U', color: '#3fb950' };
			case 'deleted':
				return { letter: 'D', color: '#f85149' };
			case 'conflicted':
				return { letter: 'C', color: '#f85149' };
			case 'renamed':
				return { letter: 'R', color: '#3fb950' };
			default:
				return { letter: '?', color: 'inherit' };
		}
	}

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
			isDir: entry.is_dir,
			x: event.clientX,
			y: event.clientY,
		}).catch(console.error);
	}

	function handleFileClick(event: MouseEvent, entry: DirEntry) {
		if (entry.is_dir) {
			toggleDir(entry);
		} else {
			const ext = entry.name.split('.').pop()?.toLowerCase() || '';
			const isMarkdown = ['md', 'markdown', 'mdown', 'mkd', 'txt', 'mmd', 'html', 'htm'].includes(ext);
			if (isMarkdown && onopenfile) {
				const newTab = event.button === 1; // Middle mouse button
				onopenfile(entry.path, { newTab });
			}
		}
	}

	function getFileIcon(entry: DirEntry): string {
		if (entry.is_dir) {
			return isExpanded(entry.path) ? 'folder-open' : 'folder';
		}
		const ext = entry.name.split('.').pop()?.toLowerCase() || '';
		if (['md', 'markdown', 'mdown', 'mkd', 'txt', 'mmd', 'html', 'htm'].includes(ext)) {
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

	function getRelativePath(filePath: string): string {
		if (!folderPath) return '';
		const rel = filePath.slice(folderPath.length).replace(/^[/\\]/, '');
		const parts = rel.split(/[/\\]/);
		return parts.length > 1 ? parts.slice(0, -1).join('/') : '';
	}

	function highlightName(name: string, query: string): { before: string; match: string; after: string } | null {
		const idx = name.toLowerCase().indexOf(query.toLowerCase());
		if (idx === -1) return null;
		return { before: name.slice(0, idx), match: name.slice(idx, idx + query.length), after: name.slice(idx + query.length) };
	}

	function toggleSearch() {
		searchOpen = !searchOpen;
		if (searchOpen) {
			// Focus after the transition starts
			requestAnimationFrame(() => searchInputEl?.focus());
		} else {
			searchQuery = '';
		}
	}

	function handleSearchKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			searchOpen = false;
			searchQuery = '';
		}
	}

	// Eagerly load all subdirectories when search opens for deep filtering
	async function loadAllDirs(items: DirEntry[]) {
		const toLoad: DirEntry[] = [];
		for (const entry of items) {
			if (entry.is_dir && !dirContents.has(entry.path)) {
				toLoad.push(entry);
			}
		}
		if (toLoad.length === 0) return;
		const results = await Promise.all(toLoad.map(async (e) => ({ path: e.path, children: await loadDirectory(e.path) })));
		for (const { path, children } of results) {
			dirContents.set(path, children);
		}
		dirContents = new Map(dirContents);
		// Recurse into newly loaded children
		const allChildren = results.flatMap(r => r.children);
		await loadAllDirs(allChildren);
	}

	$effect(() => {
		if (searchOpen && entries.length > 0) {
			loadAllDirs(entries);
		}
	});

	function matchesSearch(entry: DirEntry): boolean {
		if (!searchQuery) return true;
		const query = searchQuery.toLowerCase();
		if (entry.name.toLowerCase().includes(query)) return true;
		if (entry.is_dir) {
			return hasMatchingDescendant(entry.path, query);
		}
		return false;
	}

	function hasMatchingDescendant(dirPath: string, query: string): boolean {
		const children = dirContents.get(dirPath);
		if (!children) return false;
		for (const child of children) {
			if (child.name.toLowerCase().includes(query)) return true;
			if (child.is_dir && hasMatchingDescendant(child.path, query)) return true;
		}
		return false;
	}

	// Auto-expand directories that contain matches when searching
	let searchExpandedDirs = $derived.by(() => {
		if (!searchQuery) return new Set<string>();
		const dirs = new Set<string>();
		const query = searchQuery.toLowerCase();
		function walk(items: DirEntry[]) {
			for (const entry of items) {
				if (entry.is_dir && hasMatchingDescendant(entry.path, query)) {
					dirs.add(entry.path);
					const children = dirContents.get(entry.path);
					if (children) walk(children);
				}
			}
		}
		walk(entries);
		return dirs;
	});

	// Flat list of all loaded files whose name matches the query
	const nameMatchFiles = $derived.by(() => {
		if (!searchQuery) return [];
		const query = searchQuery.toLowerCase();
		const matches: DirEntry[] = [];
		function walk(items: DirEntry[]) {
			for (const entry of items) {
				if (entry.is_dir) {
					const children = dirContents.get(entry.path);
					if (children) walk(children);
				} else if (entry.name.toLowerCase().includes(query)) {
					matches.push(entry);
				}
			}
		}
		walk(entries);
		return matches;
	});

	// Content results excluding files already surfaced by name match
	const filteredContentResults = $derived.by(() => {
		const nameMatchPaths = new Set(nameMatchFiles.map((f) => f.path));
		return contentResults.filter((r) => !nameMatchPaths.has(r.path));
	});

	const contentSearchDebounce = debounce(async (query: string, folder: string) => {
		try {
			const results = await invoke<ContentSearchResult[]>('search_file_content', {
				folderPath: folder,
				query,
			});
			contentResults = results;
		} catch (e) {
			console.error('Content search failed:', e);
			contentResults = [];
		} finally {
			contentSearching = false;
		}
	}, 300);

	$effect(() => {
		const query = searchQuery;
		const folder = folderPath;
		if (!query) {
			contentSearchDebounce.cancel();
			contentResults = [];
			contentSearching = false;
			return;
		}
		contentSearching = true;
		contentSearchDebounce.call(query, folder);
		return () => contentSearchDebounce.cancel();
	});

	function isExpanded(path: string): boolean {
		if (searchQuery) return searchExpandedDirs.has(path);
		return expandedDirs.has(path);
	}

	async function handleNewFileClickRoot(e: MouseEvent) {
		e.stopPropagation();
		newFileDir = folderPath;
		newFileName = '';
		await tick();
		newFileInputEl?.focus();
	}

	function handleNewFileKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			createNewFile();
		} else if (e.key === 'Escape') {
			cancelNewFile();
		}
	}

	function cancelNewFile() {
		newFileDir = null;
		newFileName = '';
	}

	async function createNewFile() {
		if (!newFileDir) return;
		let name = newFileName.trim();
		if (!name) { cancelNewFile(); return; }
		if (!name.includes('.')) name += '.md';

		const path = newFileDir + '/' + name;
		const dir = newFileDir;
		cancelNewFile();

		try {
			await invoke('save_file_content', { path, content: '' });
			const contents = await loadDirectory(dir);
			if (dir === folderPath) {
				entries = contents;
			} else {
				dirContents.set(dir, contents);
				dirContents = new Map(dirContents);
			}
			onopenfile?.(path);
		} catch (err) {
			console.error('Failed to create file:', err);
		}
	}
</script>

{#snippet renderEntry(entry: DirEntry, depth: number)}
	{@const icon = getFileIcon(entry)}
	{@const isMarkdown = !entry.is_dir && ['md', 'markdown', 'mdown', 'mkd', 'txt', 'mmd', 'html', 'htm'].includes(entry.name.split('.').pop()?.toLowerCase() || '')}
	{@const isLoading = loadingDirs.has(entry.path)}
	{@const entryGitStatus = getEntryStatus(entry)}
	{@const badge = entryGitStatus ? statusBadge(entryGitStatus) : null}
	{@const isActive = !entry.is_dir && entry.path === activePath}
	<li class="relative" style="padding-left: {depth * 12 + 8}px">
		{#if entry.is_dir}
			<div
				class="flex items-center w-full py-[3px] px-2 border-none bg-none text-(--color-fg-default) text-[12.5px] leading-[1.4] text-left cursor-pointer overflow-hidden transition-[color,background] duration-100 gap-[6px] hover:bg-(--color-neutral-muted)"
				role="button"
				tabindex="0"
				onclick={(event) => handleFileClick(event, entry)}
				onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleFileClick(e as unknown as MouseEvent, entry); }}
				oncontextmenu={(event) => handleContextMenu(event, entry)}
				title={entry.path}
			>
				<span class="flex items-center justify-center shrink-0">
					{#if isLoading}
						<svg class="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<circle cx="12" cy="12" r="10" stroke-dasharray="30 60" />
						</svg>
					{:else if icon === 'folder-open'}
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v1" />
							<path d="M22 11H8l-2 8h16l-2-8z" />
						</svg>
					{:else}
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
						</svg>
					{/if}
				</span>
				<span class="overflow-hidden text-ellipsis whitespace-nowrap flex-1" style={badge ? `color: ${badge.color}` : ''}>{entry.name}</span>
				{#if badge}
					<span class="text-[10px] font-bold leading-none shrink-0 ml-auto [font-family:'SF_Mono','Monaco','Menlo',monospace]" style="color: {badge.color}">{badge.letter}</span>
				{/if}
				<span class="flex items-center justify-center ml-auto transition-transform duration-[150ms] ease-linear {isExpanded(entry.path) ? 'rotate-90' : ''}">
					<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<polyline points="9 18 15 12 9 6" />
					</svg>
				</span>
			</div>
		{:else}
			<button
				class="flex items-center w-full py-[3px] px-2 border-none text-[12.5px] leading-[1.4] text-left overflow-hidden transition-[color,background] duration-100 gap-[6px] {isMarkdown ? (isActive ? 'text-(--color-accent-fg) bg-(--color-neutral-muted) cursor-pointer' : 'text-(--color-fg-muted) bg-none cursor-pointer hover:text-(--color-accent-fg) hover:bg-(--color-neutral-muted)') : 'text-(--color-fg-muted) bg-none opacity-50 cursor-default'}"
				onclick={(event) => handleFileClick(event, entry)}
				onauxclick={(event) => { if (event.button === 1) handleFileClick(event, entry); }}
				oncontextmenu={(event) => handleContextMenu(event, entry)}
				title={entry.path}
			>
				<span class="flex items-center justify-center shrink-0">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
						<polyline points="14 2 14 8 20 8" />
					</svg>
				</span>
				<span class="overflow-hidden text-ellipsis whitespace-nowrap flex-1" style={badge ? `color: ${badge.color}` : ''}>{entry.name}</span>
				{#if badge}
					<span class="text-[10px] font-bold leading-none shrink-0 ml-auto [font-family:'SF_Mono','Monaco','Menlo',monospace]" style="color: {badge.color}">{badge.letter}</span>
				{/if}
			</button>
		{/if}
	</li>
	{#if entry.is_dir && isExpanded(entry.path)}
		{@const children = sortEntries(dirContents.get(entry.path) || []).filter(matchesSearch)}
		{#if newFileDir === entry.path}
			<li class="relative flex items-center gap-[6px] pt-[2px] pb-[2px] pr-2" style="padding-left: {(depth + 1) * 12 + 8}px">
				<span class="flex items-center justify-center shrink-0">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
						<polyline points="14 2 14 8 20 8" />
					</svg>
				</span>
				<input
					bind:this={newFileInputEl}
					bind:value={newFileName}
					onkeydown={handleNewFileKeydown}
					onblur={cancelNewFile}
					class="flex-1 min-w-0 border border-(--color-accent-fg) rounded-[3px] bg-(--color-canvas-subtle) text-(--color-fg-default) text-[12.5px] [font-family:inherit] outline-none py-[1px] px-[5px]"
					type="text"
					placeholder="filename.md"
					spellcheck="false"
				/>
			</li>
		{/if}
		{#each children as child}
			{@render renderEntry(child, depth + 1)}
		{/each}
		{#if children.length === 0 && !loadingDirs.has(entry.path) && newFileDir !== entry.path}
			<li class="relative py-2 px-3" style="padding-left: {(depth + 1) * 12 + 8}px">
				<span class="text-(--color-fg-muted) text-[11px] italic">Empty folder</span>
			</li>
		{/if}
	{/if}
{/snippet}

{#if visible && folderPath}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div
		class="fixed top-9 bottom-0 w-[5px] z-[51] cursor-col-resize outline-none"
		style="{sidebarPosition === 'right' ? `right: ${settings.folderExplorerWidth - 2}px` : `left: ${settings.folderExplorerWidth - 2}px`}"
		onmousedown={handleResizeStart}
		role="separator"
		tabindex="-1"
		aria-label="Resize sidebar"
		aria-orientation="vertical"
	></div>
	<nav
		class="explorer-nav fixed top-9 bottom-0 overflow-y-auto overflow-x-hidden z-50 [font-family:var(--font-win)] pt-2 {sidebarPosition === 'right' ? 'left-auto right-0 border-l border-(--color-border-default) animate-slide-in-right' : 'left-0 border-r border-(--color-border-default) animate-slide-in'}"
		style="background-color: var(--color-canvas-default); width: {settings.folderExplorerWidth}px"
		aria-label="File explorer"
	>
		<div class="px-3 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.5px] text-(--color-fg-muted) flex items-center gap-[6px]">
			{#if searchOpen}
				<div class="flex items-center gap-1 flex-1 min-w-0 bg-(--color-canvas-subtle) border border-(--color-border-default) rounded-[4px] py-[2px] px-[6px] animate-search-expand">
					<svg class="shrink-0 text-(--color-fg-muted)" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
					</svg>
					<input
						bind:this={searchInputEl}
						bind:value={searchQuery}
						onkeydown={handleSearchKeydown}
						class="flex-1 min-w-0 border-none bg-none text-(--color-fg-default) text-[11px] [font-family:inherit] outline-none py-[2px] placeholder:text-(--color-fg-muted) placeholder:opacity-60 normal-case tracking-normal font-normal"
						type="text"
						placeholder="Filter files..."
						spellcheck="false"
					/>
					<button class="flex items-center justify-center shrink-0 w-[18px] h-[18px] p-0 border-none rounded-[3px] bg-none text-(--color-fg-muted) cursor-pointer transition-[color,background] duration-100 hover:text-(--color-fg-default) hover:bg-(--color-neutral-muted)" onclick={toggleSearch} aria-label="Close search">
						<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
							<path d="M18 6 6 18" /><path d="m6 6 12 12" />
						</svg>
					</button>
				</div>
			{:else}
				{#if isGitRepo}
					<button
						class="flex items-center justify-center shrink-0 w-7 h-[22px] p-0 border-none rounded-[4px] bg-none text-(--color-fg-muted) cursor-pointer transition-[color,background] duration-100 gap-[3px] disabled:opacity-50 disabled:cursor-default hover:enabled:text-(--color-fg-default) hover:enabled:bg-(--color-neutral-muted)"
						onclick={handleSync}
						disabled={isSyncing}
						title={isSyncing ? 'Syncing...' : 'Git pull & push'}
						aria-label="Git sync"
					>
						{#if gitBehind > 0}
							<span class="flex items-center gap-[1px] text-[10px] font-semibold [font-family:'SF_Mono','Monaco','Menlo',monospace] leading-none text-[#d29922]" title="{gitBehind} behind remote">
								<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
									<path d="M12 5v14" /><path d="m19 12-7 7-7-7" />
								</svg>
								{gitBehind}
							</span>
						{/if}
						{#if gitAhead > 0}
							<span class="flex items-center gap-[1px] text-[10px] font-semibold [font-family:'SF_Mono','Monaco','Menlo',monospace] leading-none text-[#3fb950]" title="{gitAhead} ahead of remote">
								<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
									<path d="M12 19V5" /><path d="m5 12 7-7 7 7" />
								</svg>
								{gitAhead}
							</span>
						{/if}
						<svg class:animate-spin={isSyncing} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M21.5 2v6h-6" /><path d="M2.5 22v-6h6" />
							<path d="M2.5 11.5a10 10 0 0 1 18.4-4.5" /><path d="M21.5 12.5a10 10 0 0 1-18.4 4.5" />
						</svg>
					</button>
				{/if}
				<div class="relative flex-1 min-w-0" bind:this={folderPickerEl}>
					<button
						class="overflow-hidden text-ellipsis whitespace-nowrap w-full text-left bg-none border-none p-0 text-inherit font-inherit tracking-inherit uppercase text-[11px] font-semibold {otherFolders.length > 0 ? 'cursor-pointer hover:text-(--color-fg-default)' : 'cursor-default'} flex items-center gap-[3px]"
						onclick={toggleFolderPicker}
						title={folderPath}
					>
						<span class="overflow-hidden text-ellipsis whitespace-nowrap">{getFolderName(folderPath)}</span>
						{#if otherFolders.length > 0}
							<svg class="shrink-0 transition-transform duration-150 {folderPickerOpen ? 'rotate-180' : ''}" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
								<polyline points="6 9 12 15 18 9" />
							</svg>
						{/if}
					</button>
					{#if folderPickerOpen}
						<div class="absolute top-full left-0 mt-1 min-w-[180px] max-w-[280px] bg-(--color-canvas-default) border border-(--color-border-default) rounded-[6px] shadow-[0_4px_12px_rgba(0,0,0,0.15)] z-[100] py-1 animate-menu-fade normal-case tracking-normal font-normal">
							{#each otherFolders as folder}
								<button
									class="flex items-center gap-2 w-full text-left bg-none border-none px-3 py-[5px] text-[12px] text-(--color-fg-muted) cursor-pointer hover:bg-(--color-neutral-muted) hover:text-(--color-fg-default) transition-[color,background] duration-100"
									onclick={() => handlePickerFolder(folder)}
									title={folder}
								>
									<svg class="shrink-0 opacity-60" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
										<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
									</svg>
									<span class="overflow-hidden text-ellipsis whitespace-nowrap">{getFolderName(folder)}</span>
								</button>
							{/each}
						</div>
					{/if}
				</div>
				<button
					class="flex items-center justify-center shrink-0 w-7 h-[22px] p-0 border-none rounded-[4px] bg-none text-(--color-fg-muted) cursor-pointer transition-[color,background] duration-100 hover:text-(--color-fg-default) hover:bg-(--color-neutral-muted)"
					onclick={handleNewFileClickRoot}
					title="New file"
					aria-label="New file"
				>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
						<path d="M12 5v14" /><path d="M5 12h14" />
					</svg>
				</button>
				<button
					class="flex items-center justify-center shrink-0 w-7 h-[22px] p-0 border-none rounded-[4px] bg-none text-(--color-fg-muted) cursor-pointer transition-[color,background] duration-100 hover:text-(--color-fg-default) hover:bg-(--color-neutral-muted)"
					onclick={toggleSearch}
					title="Search files"
					aria-label="Search files"
				>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
					</svg>
				</button>
				<button
					class="flex items-center justify-center shrink-0 w-7 h-[22px] p-0 border-none rounded-[4px] bg-none text-(--color-fg-muted) cursor-pointer transition-[color,background] duration-100 hover:text-(--color-fg-default) hover:bg-(--color-neutral-muted)"
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
			{/if}
		</div>
		{#if searchQuery}
			<!-- FLAT SEARCH RESULTS -->
			<div class="px-2 pb-2">
				<div class="text-[10px] font-semibold uppercase tracking-[0.5px] text-(--color-fg-muted) px-2 pt-3 pb-1">
					Name matches
				</div>
				{#if nameMatchFiles.length > 0}
					<ul class="list-none m-0 p-0">
						{#each nameMatchFiles as entry}
							{@const badge = gitStatuses.get(entry.path) ? statusBadge(gitStatuses.get(entry.path)!) : null}
							{@const relPath = getRelativePath(entry.path)}
							{@const hl = highlightName(entry.name, searchQuery)}
							{@const isActiveResult = entry.path === activePath}
							<li>
								<button
									class="flex items-center w-full py-[3px] px-2 border-none text-[12.5px] leading-[1.4] text-left overflow-hidden gap-[6px] cursor-pointer {isActiveResult ? 'text-(--color-accent-fg) bg-(--color-neutral-muted)' : 'text-(--color-fg-muted) bg-none hover:text-(--color-accent-fg) hover:bg-(--color-neutral-muted)'}"
									onclick={(e) => handleFileClick(e, entry)}
									onauxclick={(e) => { if (e.button === 1) handleFileClick(e, entry); }}
									oncontextmenu={(e) => handleContextMenu(e, entry)}
									title={entry.path}
								>
									<svg class="shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
										<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" />
									</svg>
									<span class="flex-1 min-w-0 overflow-hidden">
										<span class="block overflow-hidden text-ellipsis whitespace-nowrap" style={badge ? `color: ${badge.color}` : ''}>
											{#if hl}{hl.before}<span class="text-(--color-fg-default) font-semibold">{hl.match}</span>{hl.after}{:else}{entry.name}{/if}
										</span>
										{#if relPath}
											<span class="block text-[10.5px] text-(--color-fg-muted) opacity-60 overflow-hidden text-ellipsis whitespace-nowrap">{relPath}</span>
										{/if}
									</span>
									{#if badge}
										<span class="text-[10px] font-bold shrink-0" style="color: {badge.color}">{badge.letter}</span>
									{/if}
								</button>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="text-(--color-fg-muted) text-[11px] italic px-2 py-1 m-0">No name matches</p>
				{/if}

				<div class="text-[10px] font-semibold uppercase tracking-[0.5px] text-(--color-fg-muted) px-2 pt-3 pb-1 flex items-center gap-2">
					<span>Content matches</span>
					{#if contentSearching}
						<svg class="animate-spin shrink-0" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
							<circle cx="12" cy="12" r="10" stroke-dasharray="30 60" />
						</svg>
					{/if}
				</div>
				{#if !contentSearching && filteredContentResults.length === 0}
					<p class="text-(--color-fg-muted) text-[11px] italic px-2 py-1 m-0">No content matches</p>
				{/if}
				{#if filteredContentResults.length > 0}
					<ul class="list-none m-0 p-0">
						{#each filteredContentResults as result}
							{@const fileName = result.path.split(/[/\\]/).pop() ?? result.path}
							{@const badge = gitStatuses.get(result.path) ? statusBadge(gitStatuses.get(result.path)!) : null}
							{@const relPath = getRelativePath(result.path)}
							<li>
								<button
									class="flex items-center w-full py-[3px] px-2 border-none bg-none text-[12.5px] leading-[1.4] text-left overflow-hidden gap-[6px] text-(--color-fg-muted) cursor-pointer hover:text-(--color-accent-fg) hover:bg-(--color-neutral-muted)"
									onclick={() => onopenfile?.(result.path)}
									onauxclick={(e) => { if (e.button === 1) { e.preventDefault(); onopenfile?.(result.path, { newTab: true }); } }}
									title={result.path}
								>
									<svg class="shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
										<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" />
									</svg>
									<span class="flex-1 min-w-0 overflow-hidden">
										<span class="block overflow-hidden text-ellipsis whitespace-nowrap" style={badge ? `color: ${badge.color}` : ''}>{fileName}</span>
										{#if relPath}
											<span class="block text-[10.5px] text-(--color-fg-muted) opacity-60 overflow-hidden text-ellipsis whitespace-nowrap">{relPath}</span>
										{/if}
									</span>
									<span class="text-[10px] font-semibold shrink-0 text-(--color-fg-muted) font-mono">{result.hits}</span>
									{#if badge}
										<span class="text-[10px] font-bold shrink-0" style="color: {badge.color}">{badge.letter}</span>
									{/if}
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{:else}
			<!-- EXISTING TREE VIEW -->
			<ul class="list-none m-0 p-0">
				{#if newFileDir === folderPath}
					<li class="relative flex items-center gap-[6px] pt-[2px] pb-[2px] pr-2" style="padding-left: 8px">
						<span class="flex items-center justify-center shrink-0">
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
								<polyline points="14 2 14 8 20 8" />
							</svg>
						</span>
						<input
							bind:this={newFileInputEl}
							bind:value={newFileName}
							onkeydown={handleNewFileKeydown}
							onblur={cancelNewFile}
							class="flex-1 min-w-0 border border-(--color-accent-fg) rounded-[3px] bg-(--color-canvas-subtle) text-(--color-fg-default) text-[12.5px] [font-family:inherit] outline-none py-[1px] px-[5px]"
							type="text"
							placeholder="filename.md"
							spellcheck="false"
						/>
					</li>
				{/if}
				{#each sortEntries(entries).filter(matchesSearch) as entry}
					{@render renderEntry(entry, 0)}
				{/each}
				{#if sortEntries(entries).filter(matchesSearch).length === 0}
					<li class="relative py-2 px-3">
						<span class="text-(--color-fg-muted) text-[11px] italic">{searchQuery ? 'No matches' : 'No files found'}</span>
					</li>
				{/if}
			</ul>
		{/if}
	</nav>
{/if}

<style>
	.explorer-nav::-webkit-scrollbar {
		width: 4px;
	}

	.explorer-nav::-webkit-scrollbar-track {
		background: transparent;
	}

	.explorer-nav::-webkit-scrollbar-thumb {
		background: var(--color-neutral-muted);
		border-radius: 2px;
	}
</style>
