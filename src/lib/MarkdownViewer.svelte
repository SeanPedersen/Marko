<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';
	import { onMount, tick } from 'svelte';
	import { openUrl } from '@tauri-apps/plugin-opener';
	import { open, save } from '@tauri-apps/plugin-dialog';
	import Installer from './Installer.svelte';
	import Uninstaller from './Uninstaller.svelte';
	import TitleBar from './components/TitleBar.svelte';
	import CodeMirrorEditor from './components/CodeMirrorEditor.svelte';
	import TableOfContents from './components/TableOfContents.svelte';
	import FolderExplorer from './components/FolderExplorer.svelte';
	import Modal from './components/Modal.svelte';
	import EditorHeader from './components/EditorHeader.svelte';

	import HomePage from './components/HomePage.svelte';
	import SettingsModal from './components/SettingsModal.svelte';
	import { tabManager, type Tab } from './stores/tabs.svelte.js';
	import { settings, EDITOR_WIDTH_VALUES } from './stores/settings.svelte.js';
	import { debounce } from './utils/debounce.js';
	import { parseHeadings } from './utils/parseHeadings.js';
	import { buildFileIndex, resolveWikiLink, type FileIndex } from './utils/wikiLinks.js';
	import { parseFrontmatter } from './utils/frontmatter.js';
	import KanbanBoard from './components/KanbanBoard.svelte';

	let mode = $state<'loading' | 'app' | 'installer' | 'uninstall'>('loading');

	let recentFiles = $state<string[]>([]);
	let recentFolders = $state<string[]>([]);
	let isFocused = $state(true);

	// derived from tab manager
	let currentFile = $derived(tabManager.activeTab?.path ?? '');
	let currentFileType = $derived.by((): 'markdown' | 'text' => {
		if (!currentFile) return 'text';
		const ext = currentFile.split('.').pop()?.toLowerCase();
		const markdownExts = ['md', 'markdown', 'mdown', 'mkd'];
		return markdownExts.includes(ext || '') ? 'markdown' : 'text';
	});
	let hasHeadings = $derived(parseHeadings(tabManager.activeTab?.rawContent ?? '').length > 0);
	let isKanban = $derived.by(() => {
		if (currentFileType !== 'markdown') return false;
		const { fields } = parseFrontmatter(tabManager.activeTab?.rawContent ?? '');
		return fields.some(
			(f) => (f.key === 'kanban-plugin' || f.key === 'marko-kanban-plugin') && f.value === 'board'
		);
	});
	let kanbanRawMode = $state(false);
	$effect(() => { if (!isKanban) kanbanRawMode = false; });
	let scrollTop = $derived(tabManager.activeTab?.scrollTop ?? 0);
	let isScrolled = $derived(scrollTop > 0);
	let windowTitle = $derived(tabManager.activeTab?.title ?? 'Marko');
	let canGoBack = $derived(tabManager.activeTabId ? tabManager.canGoBack(tabManager.activeTabId) : false);
	let canGoForward = $derived(tabManager.activeTabId ? tabManager.canGoForward(tabManager.activeTabId) : false);

	let showHome = $derived(tabManager.activeTab?.path === 'HOME');
	let folderRefreshKey = $state(0);
	let isDragging = $state(false);
	let tocVisible = $state(localStorage.getItem('toc-visible') !== 'false');
	let folderExplorerVisible = $state(false); // Don't restore on startup - only show when explicitly opened
	let currentFolder = $state(localStorage.getItem('current-folder') || '');
	let settingsVisible = $state(false);

	// Git status for current file
	let currentFileGitStatus = $state<string | null>(null);

	// Wiki-links: track all markdown files in the current folder
	let allMarkdownFiles = $state<string[]>([]);
	let currentFileDir = $derived(
		currentFile
			? currentFile.substring(0, Math.max(currentFile.lastIndexOf('/'), currentFile.lastIndexOf('\\')))
			: ''
	);
	let indexRoot = $derived(currentFileDir);

	let fileIndex = $derived<FileIndex>(
		indexRoot
			? buildFileIndex(allMarkdownFiles, indexRoot)
			: { entries: [], byBasename: new Map(), byFilename: new Map() }
	);

	// Theme State
	let theme = $state<'system' | 'dark' | 'light'>('system');

	onMount(() => {
		const storedTheme = localStorage.getItem('theme') as 'system' | 'dark' | 'light' | null;
		if (storedTheme) theme = storedTheme;
		// Clear the forced background color from app.html
		document.documentElement.style.removeProperty('background-color');
	});

	$effect(() => {
		localStorage.setItem('theme', theme);
		invoke('save_theme', { theme }).catch(console.error);

		if (theme === 'system') {
			delete document.documentElement.dataset.theme;
		} else {
			document.documentElement.dataset.theme = theme;
		}
	});

	// ui state
	let tooltip = $state({ show: false, text: '', x: 0, y: 0 });
	let modalState = $state<{
		show: boolean;
		title: string;
		message: string;
		kind: 'info' | 'warning' | 'error';
		showSave: boolean;
		okOnly: boolean;
		resolve: ((v: 'save' | 'discard' | 'cancel') => void) | null;
	}>({
		show: false,
		title: '',
		message: '',
		kind: 'info',
		showSave: false,
		okOnly: false,
		resolve: null,
	});

	function askCustom(message: string, options: { title: string; kind: 'info' | 'warning' | 'error'; showSave?: boolean; okOnly?: boolean }): Promise<'save' | 'discard' | 'cancel'> {
		return new Promise((resolve) => {
			modalState = {
				show: true,
				title: options.title,
				message,
				kind: options.kind,
				showSave: options.showSave ?? false,
				okOnly: options.okOnly ?? false,
				resolve,
			};
		});
	}

	function handleModalSave() {
		if (modalState.resolve) modalState.resolve('save');
		modalState.show = false;
	}

	function handleModalConfirm() {
		if (modalState.resolve) modalState.resolve('discard');
		modalState.show = false;
	}

	function handleModalCancel() {
		if (modalState.resolve) modalState.resolve('cancel');
		modalState.show = false;
	}

	async function loadMarkdown(filePath: string, options: { navigate?: boolean; skipTabManagement?: boolean; newTab?: boolean } = {}) {
		try {
			const isOnHome = tabManager.activeTab?.path === 'HOME';

			if (options.navigate && tabManager.activeTab && !isOnHome) {
				tabManager.navigate(tabManager.activeTab.id, filePath);
			} else if (!options.skipTabManagement) {
				const existing = tabManager.tabs.find((t) => t.path === filePath);
				if (existing) {
					tabManager.setActive(existing.id);
				} else if (options.newTab || isOnHome) {
					tabManager.addTab(filePath);
				} else if (tabManager.activeTab) {
					// Replace current tab
					tabManager.updateTabPath(tabManager.activeTab.id, filePath);
				} else {
					tabManager.addTab(filePath);
				}
			}
			const activeId = tabManager.activeTabId;
			if (!activeId) return;

			const ext = filePath.split('.').pop()?.toLowerCase();
			const isMarkdown = ['md', 'markdown', 'mdown', 'mkd'].includes(ext || '');
			const tab = tabManager.tabs.find((t) => t.id === activeId);

			if (isMarkdown) {
				if (tab) tab.isEditing = true; // Milkdown is always "editing" but WYSIWYG
				const content = (await invoke('read_file_content', { path: filePath })) as string;
				tabManager.setTabRawContent(activeId, content);
			} else {
				if (tab) tab.isEditing = true;
				const content = (await invoke('read_file_content', { path: filePath })) as string;
				tabManager.setTabRawContent(activeId, content);
			}

			await tick();
			if (filePath) saveRecentFile(filePath);
		} catch (error) {
			console.error('Error loading file:', error);
			const errStr = String(error);
			if (errStr.includes('The system cannot find the file specified') || errStr.includes('No such file or directory')) {
				deleteRecentFile(filePath);
				if (tabManager.activeTab && tabManager.activeTab.path === filePath) {
					tabManager.closeTab(tabManager.activeTab.id);
				}
			}
		}
	}

	function saveRecentFile(path: string) {
		let files = [...recentFiles].filter((f) => f !== path);
		files.unshift(path);
		recentFiles = files.slice(0, 9);
		localStorage.setItem('recent-files', JSON.stringify(recentFiles));
	}

	function loadRecentFiles() {
		const stored = localStorage.getItem('recent-files');
		if (stored) {
			try {
				recentFiles = JSON.parse(stored);
			} catch (e) {
				console.error('Error parsing recent files:', e);
			}
		}
	}

	function deleteRecentFile(path: string) {
		recentFiles = recentFiles.filter((f) => f !== path);
		localStorage.setItem('recent-files', JSON.stringify(recentFiles));
	}

	function removeRecentFile(path: string, event: MouseEvent) {
		event.stopPropagation();
		deleteRecentFile(path);
		if (currentFile === path) tabManager.closeTab(tabManager.activeTabId!);
	}

	function saveRecentFolder(path: string) {
		let folders = [...recentFolders].filter((f) => f !== path);
		folders.unshift(path);
		recentFolders = folders.slice(0, 6);
		localStorage.setItem('recent-folders', JSON.stringify(recentFolders));
	}

	function loadRecentFolders() {
		const stored = localStorage.getItem('recent-folders');
		if (stored) {
			try {
				recentFolders = JSON.parse(stored);
			} catch (e) {
				console.error('Error parsing recent folders:', e);
			}
		}
	}

	function deleteRecentFolder(path: string) {
		recentFolders = recentFolders.filter((f) => f !== path);
		localStorage.setItem('recent-folders', JSON.stringify(recentFolders));
	}

	function removeRecentFolder(path: string, event: MouseEvent) {
		event.stopPropagation();
		deleteRecentFolder(path);
		if (currentFolder === path) {
			currentFolder = '';
			localStorage.setItem('current-folder', '');
			folderExplorerVisible = false;
			localStorage.setItem('folder-explorer-visible', 'false');
		}
	}

	function openFolder(path: string) {
		currentFolder = path;
		localStorage.setItem('current-folder', path);
		folderExplorerVisible = true;
		localStorage.setItem('folder-explorer-visible', 'true');
		saveRecentFolder(path);
	}

	async function saveTab(tab: Tab): Promise<boolean> {
		if (!tab.path) return false;
		try {
			await invoke('save_file_content', { path: tab.path, content: tab.rawContent });
			tab.isDirty = false;
			tab.isDeleted = false;
			return true;
		} catch (e) {
			console.error('Failed to save file', e);
			return false;
		}
	}

	async function canCloseTab(tabId: string): Promise<boolean> {
		const tab = tabManager.tabs.find((t) => t.id === tabId);
		if (!tab || (!tab.isDirty && tab.path !== '')) return true;

		if (!tab.isDirty) return true;

		if (settings.autoSave && tab.path) {
			if (tabManager.activeTabId === tabId) debouncedSave.cancel();
			await saveTab(tab);
			return true;
		}

		const response = await askCustom(`You have unsaved changes in "${tab.title}". Do you want to save them before closing?`, {
			title: 'Unsaved Changes',
			kind: 'warning',
			showSave: true,
		});

		if (response === 'cancel') return false;
		if (response === 'save') {
			return await saveContent();
		}

		return true; // discard
	}

	async function saveContent(): Promise<boolean> {
		const tab = tabManager.activeTab;
		if (!tab) return false;

		let targetPath = tab.path;

		if (!targetPath) {
			// New files default to .md, saved in the currently opened folder
			const selected = await save({
				defaultPath: currentFolder
					? `${currentFolder}/untitled.md`
					: 'untitled.md',
				filters: [
					{ name: 'Markdown', extensions: ['md'] },
					{ name: 'Text Files', extensions: ['txt', 'json', 'js', 'ts', 'py', 'rs', 'html', 'css', 'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf'] },
					{ name: 'All Files', extensions: ['*'] },
				],
			});
			if (selected) {
				targetPath = selected;
			} else {
				return false; // User cancelled save dialog
			}
		}

		try {
			await invoke('save_file_content', { path: targetPath, content: tab.rawContent });
			if (tab.path === '') {
				// We just saved an untitled tab for the first time
				tabManager.updateTabPath(tab.id, targetPath);
				saveRecentFile(targetPath);
			}
			tab.isDirty = false;
			tab.isDeleted = false;
			// Refresh git status after save
			invoke('get_file_git_status', { path: targetPath }).then((result) => {
				currentFileGitStatus = result as string | null;
			}).catch(() => {});
			return true;
		} catch (e) {
			console.error('Failed to save file', e);
			return false;
		}
	}

	function toggleToc() {
		tocVisible = !tocVisible;
		localStorage.setItem('toc-visible', String(tocVisible));
	}

	function toggleFolderExplorer() {
		folderExplorerVisible = !folderExplorerVisible;
		localStorage.setItem('folder-explorer-visible', String(folderExplorerVisible));
	}

	function toggleSettings() {
		settingsVisible = !settingsVisible;
	}

	async function selectFolder() {
		const selected = await open({
			multiple: false,
			directory: true,
		});
		if (selected && typeof selected === 'string') {
			openFolder(selected);
		}
	}

	async function handleNewFile() {
		// Must have a folder open to create files
		if (!currentFolder) {
			// Open folder picker first
			const selected = await open({
				multiple: false,
				directory: true,
			});
			if (!selected || typeof selected !== 'string') return;
			openFolder(selected);
		}

		// Generate unique filename (checks both open tabs and files on disk)
		const filename = await nextUntitledFilename();
		const newPath = `${currentFolder}/${filename}`;

		try {
			await invoke('save_file_content', { path: newPath, content: '' });
			await loadMarkdown(newPath, { newTab: true });
			saveRecentFile(newPath);
			// Start rename mode so user can change the name if desired
			if (tabManager.activeTabId) {
				tabManager.startRenaming(tabManager.activeTabId);
			}
		} catch (e) {
			console.error('Failed to create new file:', e);
		}
	}

	async function nextUntitledFilename(): Promise<string> {
		// macOS and Windows are case-insensitive, Linux is case-sensitive
		const isCaseInsensitive = navigator.userAgent.includes('Macintosh') || navigator.userAgent.includes('Windows');
		const normalize = (s: string) => isCaseInsensitive ? s.toLowerCase() : s;

		// Collect existing names from open tabs
		const existingNames = new Set(
			tabManager.tabs
				.filter((t) => normalize(t.title).startsWith(normalize('Untitled')))
				.map((t) => normalize(t.title.replace(/\.md$/i, '')))
		);

		// Also check files on disk in the current folder
		if (currentFolder) {
			try {
				const entries = await invoke('read_directory', { path: currentFolder }) as { name: string; is_dir: boolean }[];
				for (const entry of entries) {
					if (!entry.is_dir && normalize(entry.name).startsWith(normalize('Untitled'))) {
						existingNames.add(normalize(entry.name.replace(/\.md$/i, '')));
					}
				}
			} catch (e) {
				// Folder might not exist or be readable, ignore
			}
		}

		if (!existingNames.has(normalize('Untitled'))) return 'Untitled.md';

		for (let i = 1; ; i++) {
			const candidate = `Untitled ${i}`;
			if (!existingNames.has(normalize(candidate))) return `${candidate}.md`;
		}
	}

	// Collect all markdown files in a folder recursively (for wiki-link autocomplete)
	async function collectMarkdownFiles(folder: string): Promise<string[]> {
		const files: string[] = [];
		try {
			const entries = await invoke('read_directory', { path: folder }) as { name: string; path: string; is_dir: boolean }[];
			for (const entry of entries) {
				if (entry.is_dir) {
					// Skip hidden directories
					if (!entry.name.startsWith('.')) {
						files.push(...await collectMarkdownFiles(entry.path));
					}
				} else if (entry.name.endsWith('.md') || entry.name.endsWith('.markdown') || entry.name.endsWith('.mdown') || entry.name.endsWith('.mkd')) {
					files.push(entry.path);
				}
			}
		} catch (e) {
			// Directory might not exist or be readable
		}
		return files;
	}

	async function selectFile() {
		const selected = await open({
			multiple: false,
			filters: [
				{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd'] },
				{ name: 'Text Files', extensions: ['txt', 'json', 'js', 'ts', 'py', 'rs', 'html', 'css', 'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf'] },
				{ name: 'All Files', extensions: ['*'] },
			],
		});
		if (selected && typeof selected === 'string') loadMarkdown(selected);
	}

	async function closeFile() {
		if (tabManager.activeTabId) {
			if (await canCloseTab(tabManager.activeTabId)) {
				tabManager.closeTab(tabManager.activeTabId);
			}
		}
	}

	async function openFileLocation() {
		if (currentFile) await invoke('open_file_folder', { path: currentFile });
	}

	function handleContextMenu(e: MouseEvent) {
		if (mode !== 'app') return;

		const target = e.target as HTMLElement;
		if (!target.closest('.cm-editor')) return;

		e.preventDefault();

		const selection = window.getSelection();
		const hasSelection = selection ? selection.toString().length > 0 : false;

		invoke('show_context_menu', {
			menuType: 'document',
			path: currentFile || null,
			tabId: null,
			hasSelection,
		}).catch(console.error);
	}

	function handleMouseOver(event: MouseEvent) {
		if (mode !== 'app') return;
		let target = event.target as HTMLElement;
		while (target && target.tagName !== 'A' && target !== document.body) target = target.parentElement as HTMLElement;
		if (target?.tagName === 'A') {
			const anchor = target as HTMLAnchorElement;
			if (anchor.href) {
				const rect = anchor.getBoundingClientRect();
				tooltip = { show: true, text: anchor.href, x: rect.left + rect.width / 2, y: rect.top - 8 };
			}
		}
	}

	function handleMouseOut(event: MouseEvent) {
		let target = event.target as HTMLElement;
		while (target && target.tagName !== 'A' && target !== document.body) target = target.parentElement as HTMLElement;
		if (target?.tagName === 'A') tooltip.show = false;
	}

	async function handleDocumentClick(event: MouseEvent) {
		if (mode !== 'app') return;
		let target = event.target as HTMLElement;
		while (target && target.tagName !== 'A' && target !== document.body) target = target.parentElement as HTMLElement;
		if (target?.tagName === 'A') {
			const anchor = target as HTMLAnchorElement;
			const rawHref = anchor.getAttribute('href');
			if (!rawHref) return;

			if (rawHref.startsWith('#')) return;
			const isMarkdown = ['.md', '.markdown', '.mdown', '.mkd'].some((ext) => {
				const urlNoHash = rawHref.split('#')[0].split('?')[0];
				return urlNoHash.toLowerCase().endsWith(ext);
			});

			if (isMarkdown && !rawHref.match(/^[a-z]+:\/\//i)) {
				event.preventDefault();
				const urlNoHash = rawHref.split('#')[0].split('?')[0];
				const resolved = resolvePath(currentFile, urlNoHash);
				await loadMarkdown(resolved, { navigate: true });
				return;
			}

			if (anchor.href) {
				event.preventDefault();
				try {
					await openUrl(anchor.href);
				} catch (error) {
					console.error('Failed to open URL:', anchor.href, error);
				}
			}
		}
	}

	let zoomLevel = $state(100);

	function resolvePath(basePath: string, relativePath: string) {
		if (relativePath.match(/^[a-zA-Z]:/) || relativePath.startsWith('/')) return relativePath;
		const parts = basePath.split(/[/\\]/);
		parts.pop();
		for (const p of relativePath.split(/[/\\]/)) {
			if (p === '.') continue;
			if (p === '..') parts.pop();
			else parts.push(p);
		}
		return parts.join('/');
	}

	async function handleUndoCloseTab() {
		const path = tabManager.popRecentlyClosed();
		if (path) {
			await loadMarkdown(path);
		}
	}

	async function handleDetach(tabId: string) {
		if (!(await canCloseTab(tabId))) return;
		const tab = tabManager.tabs.find((t) => t.id === tabId);
		if (!tab || !tab.path) return;

		const path = tab.path;
		tabManager.closeTab(tabId);

		const label = 'window-' + Date.now();
		const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
		const webview = new WebviewWindow(label, {
			url: 'index.html?file=' + encodeURIComponent(path),
			title: 'Marko - ' + path.split(/[/\\]/).pop(),
			width: 1000,
			height: 800,
		});
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (mode !== 'app') return;

		const cmdOrCtrl = e.ctrlKey || e.metaKey;
		const key = e.key.toLowerCase();
		const code = e.code;

		if (cmdOrCtrl && key === 'w') {
			e.preventDefault();
			closeFile();
		}
		if (cmdOrCtrl && key === 'n') {
			e.preventDefault();
			handleNewFile();
		}
			if (cmdOrCtrl && key === 's') {
			e.preventDefault();
			saveContent();
		}

		if (cmdOrCtrl && e.shiftKey && key === 't') {
			e.preventDefault();
			handleUndoCloseTab();
		}
		if (cmdOrCtrl && code === 'Tab') {
			e.preventDefault();
			tabManager.cycleTab(e.shiftKey ? 'prev' : 'next');
		}
		if (cmdOrCtrl && (key === '=' || key === '+')) {
			e.preventDefault();
			zoomLevel = Math.min(zoomLevel + 10, 500);
		}
		if (cmdOrCtrl && key === '-') {
			e.preventDefault();
			zoomLevel = Math.max(zoomLevel - 10, 25);
		}
		if (cmdOrCtrl && key === '0') {
			e.preventDefault();
			zoomLevel = 100;
		}
		if (cmdOrCtrl && e.shiftKey && key === 'e') {
			e.preventDefault();
			toggleToc();
		}
	}

	function handleGoBack() {
		if (tabManager.activeTabId) {
			const path = tabManager.goBack(tabManager.activeTabId);
			if (path) loadMarkdown(path, { skipTabManagement: true });
		}
	}

	function handleGoForward() {
		if (tabManager.activeTabId) {
			const path = tabManager.goForward(tabManager.activeTabId);
			if (path) loadMarkdown(path, { skipTabManagement: true });
		}
	}

	function handleMouseUp(e: MouseEvent) {
		if (e.button === 3) {
			// Back
			e.preventDefault();
			handleGoBack();
		} else if (e.button === 4) {
			// Forward
			e.preventDefault();
			handleGoForward();
		}
	}

	async function handleFilePath(path: string) {
		if (!path) return;
		const isDir = await invoke('is_directory', { path }) as boolean;
		if (isDir) {
			openFolder(path);
		} else {
			loadMarkdown(path);
		}
	}

	onMount(() => {
		loadRecentFiles();
		loadRecentFolders();

		let unlisteners: (() => void)[] = [];

		// Handle wiki-link click events
		const handleWikiLink = async (e: Event) => {
			const detail = (e as CustomEvent<{ target: string; newTab?: boolean }>).detail;
			if (!detail?.target) return;

			const result = resolveWikiLink(detail.target, fileIndex, currentFile, indexRoot);
			const openInNewTab = detail.newTab ?? false;

			if (result.status === 'found' && result.path) {
				await loadMarkdown(result.path, { navigate: !openInNewTab, newTab: openInNewTab });
			} else if (result.status === 'not-found' && result.suggestedPath) {
				const answer = await askCustom(`Create "${detail.target}.md"?`, {
					title: 'File Not Found',
					kind: 'info',
					showSave: false,
				});
				if (answer === 'discard') { // "Confirm" button maps to 'discard'
					try {
						await invoke('save_file_content', { path: result.suggestedPath, content: `# ${detail.target}\n\n` });
						folderRefreshKey++;
						await loadMarkdown(result.suggestedPath, { navigate: !openInNewTab, newTab: openInNewTab });
					} catch (err) {
						console.error('Failed to create file:', err);
					}
				}
			} else if (result.status === 'ambiguous' && result.candidates && result.candidates.length > 0) {
				// For now, pick the first candidate
				await loadMarkdown(result.candidates[0].path, { navigate: !openInNewTab, newTab: openInNewTab });
			}
		};

		document.addEventListener('marko:wiki-link', handleWikiLink);
		unlisteners.push(() => document.removeEventListener('marko:wiki-link', handleWikiLink));

		// Handle regular markdown link clicks from the live preview ([text](url))
		const handleLink = async (e: Event) => {
			const detail = (e as CustomEvent<{ url: string; newTab?: boolean }>).detail;
			if (!detail?.url) return;

			const rawUrl = detail.url;
			if (rawUrl.startsWith('#')) return;

			const isMarkdown = ['.md', '.markdown', '.mdown', '.mkd'].some((ext) => {
				const urlNoHash = rawUrl.split('#')[0].split('?')[0];
				return urlNoHash.toLowerCase().endsWith(ext);
			});

			if (isMarkdown && !rawUrl.match(/^[a-z]+:\/\//i)) {
				const urlNoHash = rawUrl.split('#')[0].split('?')[0];
				const resolved = resolvePath(currentFile, urlNoHash);
				await loadMarkdown(resolved, { navigate: !detail.newTab, newTab: detail.newTab ?? false });
				return;
			}

			try {
				await openUrl(rawUrl);
			} catch (err) {
				console.error('Failed to open URL:', rawUrl, err);
			}
		};

		document.addEventListener('marko:link', handleLink);
		unlisteners.push(() => document.removeEventListener('marko:link', handleLink));

		invoke('show_window').catch(console.error);

		const init = async () => {
			const { getCurrentWindow } = await import('@tauri-apps/api/window');
			const { listen } = await import('@tauri-apps/api/event');
			const appWindow = getCurrentWindow();

			// Flush pending saves on window close to prevent data loss
			const unlistenClose = await appWindow.onCloseRequested(async (event) => {
				event.preventDefault();
				debouncedSave.cancel();

				const dirtyTabs = tabManager.tabs.filter((t) => t.isDirty && t.path && t.path !== 'HOME');
				if (dirtyTabs.length > 0) {
					await Promise.all(dirtyTabs.map(saveTab));
				}

				appWindow.destroy();
			});
			unlisteners.push(unlistenClose);

			// Listen for file-path events (from CLI args, single-instance, file associations)
			const unlistenFilePath = await listen<string>('file-path', (event) => {
				handleFilePath(event.payload);
			});
			unlisteners.push(unlistenFilePath);

			const unlistenCopyName = await listen<string>('menu-file-copy-name', (event) => {
				const name = event.payload.split(/[/\\]/).pop() || event.payload;
				navigator.clipboard.writeText(name).catch(console.error);
			});
			unlisteners.push(unlistenCopyName);

			const unlistenCopyPath = await listen<string>('menu-file-copy-path', (event) => {
				navigator.clipboard.writeText(event.payload).catch(console.error);
			});
			unlisteners.push(unlistenCopyPath);

			const unlistenFolderChanged = await listen('folder-changed', () => {
				debouncedFolderRefresh.call();
			});
			unlisteners.push(unlistenFolderChanged);

			const unlistenFileTrash = await listen<string>('menu-file-trash', async (event) => {
				const path = event.payload;
				try {
					await invoke('trash_file', { path });
					const openTab = tabManager.tabs.find((t) => t.path === path);
					if (openTab) tabManager.closeTab(openTab.id);
					folderRefreshKey++;
				} catch (e) {
					console.error('Failed to trash file:', e);
				}
			});
			unlisteners.push(unlistenFileTrash);

			// Document format context menu events
			const unlistenDocCodeBlock = await listen('menu-doc-code-block', () => {
				editorRef?.wrapSelection('code_block');
			});
			unlisteners.push(unlistenDocCodeBlock);

			const unlistenDocQuote = await listen('menu-doc-quote', () => {
				editorRef?.wrapSelection('quote');
			});
			unlisteners.push(unlistenDocQuote);

			// Tab context menu events
			const unlistenTabNew = await listen('menu-tab-new', () => {
				handleNewFile();
			});
			unlisteners.push(unlistenTabNew);

			const unlistenTabUndo = await listen('menu-tab-undo', () => {
				handleUndoCloseTab();
			});
			unlisteners.push(unlistenTabUndo);

			const unlistenTabRename = await listen<string>('menu-tab-rename', (event) => {
				tabManager.startRenaming(event.payload);
			});
			unlisteners.push(unlistenTabRename);

			const unlistenTabClose = await listen<string>('menu-tab-close', async (event) => {
				const tabId = event.payload;
				if (await canCloseTab(tabId)) {
					tabManager.closeTab(tabId);
				}
			});
			unlisteners.push(unlistenTabClose);

			const unlistenTabCloseOthers = await listen<string>('menu-tab-close-others', async (event) => {
				const tabId = event.payload;
				// Close all other tabs (with confirmation for dirty ones)
				const otherTabs = tabManager.tabs.filter((t) => t.id !== tabId);
				for (const tab of otherTabs) {
					if (await canCloseTab(tab.id)) {
						tabManager.closeTab(tab.id);
					}
				}
			});
			unlisteners.push(unlistenTabCloseOthers);

			const unlistenTabCloseRight = await listen<string>('menu-tab-close-right', async (event) => {
				const tabId = event.payload;
				const index = tabManager.tabs.findIndex((t) => t.id === tabId);
				if (index === -1) return;
				const rightTabs = tabManager.tabs.slice(index + 1);
				for (const tab of rightTabs) {
					if (await canCloseTab(tab.id)) {
						tabManager.closeTab(tab.id);
					}
				}
			});
			unlisteners.push(unlistenTabCloseRight);

			// Check for file passed via URL query param (for detached windows)
			const urlParams = new URLSearchParams(window.location.search);
			const fileParam = urlParams.get('file');
			if (fileParam) {
				handleFilePath(fileParam);
			}

			// Check for initial CLI args or macOS file association paths
			try {
				const paths = await invoke('send_markdown_path') as string[];
				if (paths.length > 0) {
					handleFilePath(paths[0]);
				} else {
					// On macOS, the Opened event (file association) may arrive after
					// the frontend initializes. Retry a few times to catch it.
					let retries = 0;
					const maxRetries = 5;
					const retryInterval = setInterval(async () => {
						retries++;
						try {
							const retryPaths = await invoke('send_markdown_path') as string[];
							if (retryPaths.length > 0) {
								clearInterval(retryInterval);
								handleFilePath(retryPaths[0]);
							} else if (retries >= maxRetries) {
								clearInterval(retryInterval);
							}
						} catch {
							clearInterval(retryInterval);
						}
					}, 300);
				}
			} catch (e) {
				console.error('Failed to get startup paths:', e);
			}

			try {
				const appModePromise = invoke('get_app_mode');
				const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000));
				const appMode = await Promise.race([appModePromise, timeoutPromise]) as any;
				mode = appMode;
			} catch (e) {
				console.error('Failed to get app mode, defaulting to app', e);
				mode = 'app';
			}
		};

		init();

		return () => {
			unlisteners.forEach((u) => u());
			debouncedFolderRefresh.cancel();
			invoke('unwatch_folder').catch(console.error);
		};
	});

	$effect(() => {
		if (currentFolder) {
			invoke('watch_folder', { path: currentFolder }).catch(console.error);
		} else {
			invoke('unwatch_folder').catch(console.error);
		}
	});

	// Collect markdown files for wiki-link autocomplete from the current file's directory.
	$effect(() => {
		const root = indexRoot;
		const _ = folderRefreshKey; // Also react to folder refresh
		if (root) {
			collectMarkdownFiles(root).then(files => {
				allMarkdownFiles = files;
			});
		} else {
			allMarkdownFiles = [];
		}
	});

	// Fetch git status of the current file when it changes or after save
	$effect(() => {
		const file = currentFile;
		if (file) {
			invoke('get_file_git_status', { path: file }).then((result) => {
				currentFileGitStatus = (result as string | null);
			}).catch(() => {
				currentFileGitStatus = null;
			});
		} else {
			currentFileGitStatus = null;
		}
	});

	async function handleGitCommit(message: string) {
		if (!currentFile) return;
		try {
			await invoke('git_commit_file', { path: currentFile, message });
			const result = await invoke('get_file_git_status', { path: currentFile });
			currentFileGitStatus = result as string | null;
			folderRefreshKey++;
		} catch (e) {
			console.error('Git commit failed:', e);
		}
	}

	async function handleGitRevert() {
		if (!currentFile) return;
		try {
			await invoke('git_revert_file', { path: currentFile });
			// Reload file content from disk
			const content = await invoke('read_file_content', { path: currentFile }) as string;
			if (tabManager.activeTabId) {
				tabManager.setTabRawContent(tabManager.activeTabId, content);
				const tab = tabManager.activeTab;
				if (tab) tab.isDirty = false;
			}
			const result = await invoke('get_file_git_status', { path: currentFile });
			currentFileGitStatus = result as string | null;
			folderRefreshKey++;
		} catch (e) {
			console.error('Git revert failed:', e);
		}
	}

	const AUTO_SAVE_DELAY_MS = 300;
	const debouncedSave = debounce(() => saveContent(), AUTO_SAVE_DELAY_MS);

	const FOLDER_REFRESH_DELAY_MS = 500;
	const debouncedFolderRefresh = debounce(() => { folderRefreshKey++; }, FOLDER_REFRESH_DELAY_MS);

	function handleFilesChanged(removed: string[], added: string[]) {
		for (const tab of tabManager.tabs) {
			if (!tab.path || tab.path === 'HOME') continue;
			if (!removed.includes(tab.path)) continue;

			// File was removed — check if it was renamed (1 removed + 1 added in same dir)
			const tabDir = tab.path.substring(0, Math.max(tab.path.lastIndexOf('/'), tab.path.lastIndexOf('\\')));
			const addedInSameDir = added.filter((p) => {
				const dir = p.substring(0, Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')));
				return dir === tabDir;
			});

			if (addedInSameDir.length === 1) {
				tabManager.renameTab(tab.id, addedInSameDir[0]);
				tab.isDeleted = false;
				// Remove from added so it's not matched again
				added.splice(added.indexOf(addedInSameDir[0]), 1);
			} else {
				tab.isDeleted = true;
			}
		}

		// Clear isDeleted for files that reappeared
		for (const addedPath of added) {
			for (const tab of tabManager.tabs) {
				if (tab.path === addedPath && tab.isDeleted) tab.isDeleted = false;
			}
		}
	}

	// Cancel pending auto-save when switching tabs
	$effect(() => {
		const _ = tabManager.activeTabId;
		debouncedSave.cancel();
	});

	// Handle CodeMirror content changes
	function handleEditorChange(newContent: string) {
		if (tabManager.activeTabId) {
			tabManager.updateTabRawContent(tabManager.activeTabId, newContent);

			if (settings.autoSave && tabManager.activeTab?.path) {
				debouncedSave.call();
			}
		}
	}

	// Reference to the editor for TOC scrolling
	let editorRef = $state<CodeMirrorEditor | null>(null);
	// Handle TOC scroll request
	function handleTocScroll(event: CustomEvent<{ lineNumber: number }>) {
		editorRef?.scrollToLine(event.detail.lineNumber);
	}

	// Handle tab rename (files are always saved, so this renames on disk)
	async function handleCommitRename(id: string, newTitle: string) {
		const tab = tabManager.tabs.find((t) => t.id === id);
		if (!tab || !tab.path) {
			tabManager.cancelRenaming(id);
			editorRef?.focus();
			return;
		}

		// If the title hasn't changed, just cancel
		if (tab.title === newTitle.trim()) {
			tabManager.cancelRenaming(id);
			editorRef?.focus();
			return;
		}

		let filename = newTitle.trim();
		if (!filename) {
			tabManager.cancelRenaming(id);
			editorRef?.focus();
			return;
		}

		// Preserve the original extension if user didn't provide one
		const oldExt = tab.path.includes('.') ? tab.path.substring(tab.path.lastIndexOf('.')) : '';
		if (!filename.includes('.') && oldExt) {
			filename += oldExt;
		}

		const dir = tab.path.substring(0, Math.max(tab.path.lastIndexOf('/'), tab.path.lastIndexOf('\\')));
		const newPath = dir + '/' + filename;

		// Check for collision before renaming
		const collision = await checkFileCollision(dir, filename, tab.path);
		if (collision) {
			await askCustom(`A file named "${filename}" already exists in this folder.`, {
				title: 'File Already Exists',
				kind: 'warning',
				okOnly: true,
			});
			// Trigger re-focus of rename input by toggling isRenaming
			tabManager.cancelRenaming(id);
			await tick();
			tabManager.startRenaming(id);
			return;
		}

		try {
			await invoke('rename_file', { oldPath: tab.path, newPath });
			tabManager.renameTab(id, newPath);
			tabManager.cancelRenaming(id);
			saveRecentFile(newPath);
			deleteRecentFile(tab.path);
		} catch (e) {
			console.error('Failed to rename file:', e);
			tabManager.cancelRenaming(id);
		}
		editorRef?.focus();
	}

	async function checkFileCollision(dir: string, filename: string, currentPath: string): Promise<boolean> {
		// macOS and Windows are case-insensitive, Linux is case-sensitive
		const isCaseInsensitive = navigator.userAgent.includes('Macintosh') || navigator.userAgent.includes('Windows');
		const normalize = (s: string) => isCaseInsensitive ? s.toLowerCase() : s;
		const targetName = normalize(filename);

		try {
			const entries = await invoke('read_directory', { path: dir }) as { name: string; path: string; is_dir: boolean }[];
			for (const entry of entries) {
				if (entry.is_dir) continue;
				// Skip the current file (we're renaming it)
				if (entry.path === currentPath) continue;
				if (normalize(entry.name) === targetName) {
					return true;
				}
			}
		} catch (e) {
			// If we can't read the directory, allow the rename and let it fail naturally
		}
		return false;
	}
</script>

<svelte:document
	onclick={handleDocumentClick}
	oncontextmenu={handleContextMenu}
	onmouseover={handleMouseOver}
	onmouseout={handleMouseOut}
	onkeydown={handleKeyDown}
	onmouseup={handleMouseUp} />

{#if mode === 'loading'}
	<TitleBar
		{isFocused}
		isScrolled={false}
		currentFile={''}
		windowTitle="Marko"
		{zoomLevel}
		onselectFile={selectFile}
		onresetZoom={() => (zoomLevel = 100)}
		{theme}
		onSetTheme={(t) => (theme = t)}
		ontoggleSettings={toggleSettings} />
	<div class="loading-screen">
		<svg class="spinner" viewBox="0 0 50 50">
			<circle class="path" cx="25" cy="25" r="20" fill="none" stroke-width="4"></circle>
		</svg>
	</div>
{:else if mode === 'installer'}
	<Installer />
{:else if mode === 'uninstall'}
	<Uninstaller />
{:else}
		<TitleBar
			{isFocused}
			{isScrolled}
			{currentFile}
			{windowTitle}
			onselectFile={selectFile}
			ondetach={handleDetach}
			{zoomLevel}
			onresetZoom={() => (zoomLevel = 100)}
			oncloseTab={(id) => {
				canCloseTab(id).then((can) => {
					if (can) tabManager.closeTab(id);
				});
			}}
			oncommitRename={handleCommitRename}
			onnewTab={handleNewFile}
			{theme}
			onSetTheme={(t) => (theme = t)}
			{folderExplorerVisible}
			ontoggleFolderExplorer={toggleFolderExplorer}
			showFolderExplorerButton={!!currentFolder}
			ontoggleSettings={toggleSettings} />

	{#if tabManager.activeTab && tabManager.activeTab.path !== 'HOME'}
		<TableOfContents
			rawContent={tabManager.activeTab?.rawContent ?? ''}
			visible={tocVisible && currentFileType === 'markdown' && !isKanban}
			onscrollto={handleTocScroll}
			sidebarPosition={settings.sidebarPosition}
			editorWidth={EDITOR_WIDTH_VALUES[settings.editorWidth]}
		/>
		<FolderExplorer
			folderPath={currentFolder}
			visible={folderExplorerVisible}
			onopenfile={loadMarkdown}
			onfileschanged={handleFilesChanged}
			refreshKey={folderRefreshKey}
			sidebarPosition={settings.sidebarPosition}
		/>
		<div
			class="markdown-container"
			class:sidebar-open={folderExplorerVisible}
			class:sidebar-right={settings.sidebarPosition === 'right'}
			style={zoomLevel !== 100 ? `transform: scale(${zoomLevel / 100}); transform-origin: top left; width: ${10000 / zoomLevel}%; height: ${10000 / zoomLevel}%;` : ''}
			role="presentation"
		>
			<EditorHeader
				filePath={currentFile}
				folderPath={currentFolder}
				{canGoBack}
				{canGoForward}
				ongoback={handleGoBack}
				ongoforward={handleGoForward}
				editorWidth={EDITOR_WIDTH_VALUES[settings.editorWidth]}
				{tocVisible}
				ontoggleToc={toggleToc}
				showTocButton={tabManager.activeTab && tabManager.activeTab.path !== 'HOME' && tabManager.activeTab.path !== '' && currentFileType === 'markdown' && hasHeadings && !isKanban}
				onopenFileLocation={openFileLocation}
				gitStatus={currentFileGitStatus}
				oncommit={handleGitCommit}
				onrevert={handleGitRevert}
				{isKanban}
				rawMode={kanbanRawMode}
				ontogglerawmode={() => { kanbanRawMode = !kanbanRawMode; }}
			/>
			{#if isKanban}
				<KanbanBoard
					content={tabManager.activeTab?.rawContent ?? ''}
					onchange={handleEditorChange}
					readonly={false}
					{theme}
					bind:rawMode={kanbanRawMode}
				/>
			{:else}
				<CodeMirrorEditor
					bind:this={editorRef}
					value={tabManager.activeTab?.rawContent ?? ''}
					{theme}
					readonly={false}
					fileType={currentFileType}
					onchange={handleEditorChange}
					editorWidth={EDITOR_WIDTH_VALUES[settings.editorWidth]}
					{fileIndex}
				/>
			{/if}
		</div>
	{:else}
		<FolderExplorer
			folderPath={currentFolder}
			visible={folderExplorerVisible && !!currentFolder}
			onopenfile={loadMarkdown}
			onfileschanged={handleFilesChanged}
			refreshKey={folderRefreshKey}
			sidebarPosition={settings.sidebarPosition}
		/>
		<div class="home-container" class:sidebar-open={folderExplorerVisible} class:sidebar-right={settings.sidebarPosition === 'right'}>
			<HomePage {recentFiles} {recentFolders} onselectFile={selectFile} onselectFolder={selectFolder} onloadFile={loadMarkdown} onopenFolder={openFolder} onremoveRecentFile={removeRecentFile} onremoveRecentFolder={removeRecentFolder} onnewFile={handleNewFile} onsettings={toggleSettings} />
		</div>
	{/if}

	{#if tooltip.show}
		<div class="tooltip" style="left: {tooltip.x}px; top: {tooltip.y}px;">
			{tooltip.text}
		</div>
	{/if}

	<Modal
		show={modalState.show}
		title={modalState.title}
		message={modalState.message}
		kind={modalState.kind}
		showSave={modalState.showSave}
		okOnly={modalState.okOnly}
		onconfirm={handleModalConfirm}
		onsave={handleModalSave}
		oncancel={handleModalCancel} />

	<SettingsModal
		show={settingsVisible}
		onclose={() => (settingsVisible = false)} />

	{#if isDragging}
		<div class="drag-overlay" role="presentation">
			<div class="drag-message">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="48"
					height="48"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round">
					<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
					<polyline points="17 8 12 3 7 8" />
					<line x1="12" y1="3" x2="12" y2="15" />
				</svg>
				<span>Drop to open files</span>
			</div>
		</div>
	{/if}
{/if}

<style>
	:root {
		--animation: cubic-bezier(0.05, 0.95, 0.05, 0.95);
		scroll-behavior: smooth !important;
		background-color: var(--color-canvas-default);
		--color-canvas-default: #ffffff;
		--color-canvas-subtle: #f6f8fa;
		--color-fg-default: #24292f;
		--color-fg-muted: #656d76;
		--color-border-default: #d1d9e0;
		--color-accent-fg: #0969da;
		--color-neutral-muted: rgba(175, 184, 193, 0.2);
		--win-font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
	}

	:global(body) {
		background-color: var(--color-canvas-default);
		margin: 0;
		padding: 0;
		color: var(--color-fg-default);
		overflow: hidden;
	}

	.markdown-container {
		position: fixed;
		top: 36px;
		left: 0;
		right: 0;
		bottom: 0;
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}

	.markdown-container.sidebar-open {
		left: clamp(0px, 1184px - 100vw, calc(232px - 2rem));
	}

	.markdown-container.sidebar-open.sidebar-right {
		left: 0;
		right: clamp(0px, 1184px - 100vw, calc(232px - 2rem));
	}

	.home-container {
		position: fixed;
		top: 36px;
		left: 0;
		right: 0;
		bottom: 0;
		overflow-y: auto;
		transition: left 0.15s ease-out, right 0.15s ease-out;
	}

	.home-container.sidebar-open {
		left: clamp(0px, 1184px - 100vw, calc(232px - 2rem));
	}

	.home-container.sidebar-open.sidebar-right {
		left: 0;
		right: clamp(0px, 1184px - 100vw, calc(232px - 2rem));
	}

	.tooltip {
		position: fixed;
		background: var(--color-canvas-default);
		color: var(--color-fg-default);
		padding: 6px 10px;
		border-radius: 4px;
		font-size: 12px;
		pointer-events: none;
		z-index: 10000;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
		border: 1px solid var(--color-border-default);
		font-family: var(--win-font);
		white-space: nowrap;
		max-width: 400px;
		overflow: hidden;
		text-overflow: ellipsis;
		transform: translate(-50%, -100%);
		transition: opacity 0.15s ease-out;
		opacity: 1;
	}

	.tooltip::after {
		content: '';
		position: absolute;
		bottom: -6px;
		left: 50%;
		transform: translateX(-50%);
		border-left: 6px solid transparent;
		border-right: 6px solid transparent;
		border-top: 6px solid var(--color-canvas-default);
	}

	.drag-overlay {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 120, 212, 0.15);
		backdrop-filter: blur(4px);
		border: 3px dashed #0078d4;
		margin: 12px;
		border-radius: 12px;
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 40000;
		pointer-events: none;
		animation: fadeIn 0.15s ease-out;
	}

	.drag-message {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 16px;
		color: #0078d4;
		font-family: var(--win-font);
		font-weight: 500;
		font-size: 18px;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
			transform: scale(0.98);
		}
		to {
			opacity: 1;
			transform: scale(1);
		}
	}

	.loading-screen {
		position: fixed;
		top: 36px;
		left: 0;
		width: 100%;
		height: calc(100% - 36px);
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-canvas-default);
		z-index: 5000;
	}

	.spinner {
		animation: rotate 2s linear infinite;
		z-index: 2;
		width: 50px;
		height: 50px;
	}

	.spinner .path {
		stroke: var(--color-accent-fg);
		stroke-linecap: round;
		animation: dash 1.5s ease-in-out infinite;
	}

	@keyframes rotate {
		100% {
			transform: rotate(360deg);
		}
	}

	@keyframes dash {
		0% {
			stroke-dasharray: 1, 150;
			stroke-dashoffset: 0;
		}
		50% {
			stroke-dasharray: 90, 150;
			stroke-dashoffset: -35;
		}
		100% {
			stroke-dasharray: 90, 150;
			stroke-dashoffset: -124;
		}
	}
</style>
