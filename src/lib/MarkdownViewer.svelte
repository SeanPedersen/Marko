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

	import HomePage from './components/HomePage.svelte';
	import { tabManager } from './stores/tabs.svelte.js';

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
	let scrollTop = $derived(tabManager.activeTab?.scrollTop ?? 0);
	let isScrolled = $derived(scrollTop > 0);
	let windowTitle = $derived(tabManager.activeTab?.title ?? 'Marko');

	let showHome = $state(false);
	let isDragging = $state(false);
	let tocVisible = $state(localStorage.getItem('toc-visible') !== 'false');
	let folderExplorerVisible = $state(false); // Don't restore on startup - only show when explicitly opened
	let currentFolder = $state(localStorage.getItem('current-folder') || '');

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
		resolve: ((v: 'save' | 'discard' | 'cancel') => void) | null;
	}>({
		show: false,
		title: '',
		message: '',
		kind: 'info',
		showSave: false,
		resolve: null,
	});

	function askCustom(message: string, options: { title: string; kind: 'info' | 'warning' | 'error'; showSave?: boolean }): Promise<'save' | 'discard' | 'cancel'> {
		return new Promise((resolve) => {
			modalState = {
				show: true,
				title: options.title,
				message,
				kind: options.kind,
				showSave: options.showSave ?? false,
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

	$effect(() => {
		const _ = tabManager.activeTabId;
		showHome = false;
	});

	async function loadMarkdown(filePath: string, options: { navigate?: boolean; skipTabManagement?: boolean; newTab?: boolean } = {}) {
		showHome = false;
		try {
			if (options.navigate && tabManager.activeTab) {
				tabManager.navigate(tabManager.activeTab.id, filePath);
			} else if (!options.skipTabManagement) {
				if (options.newTab) {
					const existing = tabManager.tabs.find((t) => t.path === filePath);
					if (existing) {
						tabManager.setActive(existing.id);
					} else {
						tabManager.addTab(filePath);
					}
				} else {
					const existing = tabManager.tabs.find((t) => t.path === filePath);
					if (existing) {
						tabManager.setActive(existing.id);
					} else if (tabManager.activeTab) {
						// Replace current tab
						tabManager.updateTabPath(tabManager.activeTab.id, filePath);
					} else {
						tabManager.addTab(filePath);
					}
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
		// Hide ToC when opening folder explorer
		if (tocVisible) {
			tocVisible = false;
			localStorage.setItem('toc-visible', 'false');
		}
	}

	async function canCloseTab(tabId: string): Promise<boolean> {
		const tab = tabManager.tabs.find((t) => t.id === tabId);
		if (!tab || (!tab.isDirty && tab.path !== '')) return true;

		if (!tab.isDirty) return true;

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
			// Special handling for new (untitled) files
			const fileType = currentFileType;
			const filters = fileType === 'markdown' 
				? [
					{ name: 'Markdown', extensions: ['md'] },
					{ name: 'Text Files', extensions: ['txt', 'json', 'js', 'ts', 'py', 'rs', 'html', 'css', 'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf'] },
					{ name: 'All Files', extensions: ['*'] },
				]
				: [
					{ name: 'Text Files', extensions: ['txt', 'json', 'js', 'ts', 'py', 'rs', 'html', 'css', 'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf'] },
					{ name: 'Markdown', extensions: ['md'] },
					{ name: 'All Files', extensions: ['*'] },
				];
			const selected = await save({
				filters,
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
			return true;
		} catch (e) {
			console.error('Failed to save file', e);
			return false;
		}
	}

	function toggleToc() {
		tocVisible = !tocVisible;
		localStorage.setItem('toc-visible', String(tocVisible));
		// Hide folder explorer when showing ToC (mutually exclusive)
		if (tocVisible && folderExplorerVisible) {
			folderExplorerVisible = false;
			localStorage.setItem('folder-explorer-visible', 'false');
		}
	}

	function toggleFolderExplorer() {
		folderExplorerVisible = !folderExplorerVisible;
		localStorage.setItem('folder-explorer-visible', String(folderExplorerVisible));
		// Hide ToC when showing folder explorer (mutually exclusive)
		if (folderExplorerVisible && tocVisible) {
			tocVisible = false;
			localStorage.setItem('toc-visible', 'false');
		}
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

	function handleNewFile() {
		tabManager.addNewTab();
		showHome = false;
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

	function toggleHome() {
		showHome = !showHome;
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
		if (cmdOrCtrl && !e.shiftKey && key === 't') {
			e.preventDefault();
			tabManager.addHomeTab();
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

	function handleMouseUp(e: MouseEvent) {
		if (e.button === 3) {
			// Back
			e.preventDefault();
			if (tabManager.activeTabId) {
				const path = tabManager.goBack(tabManager.activeTabId);
				if (path) loadMarkdown(path, { skipTabManagement: true });
			}
		} else if (e.button === 4) {
			// Forward
			e.preventDefault();
			if (tabManager.activeTabId) {
				const path = tabManager.goForward(tabManager.activeTabId);
				if (path) loadMarkdown(path, { skipTabManagement: true });
			}
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

		invoke('show_window').catch(console.error);

		const init = async () => {
			const { getCurrentWindow } = await import('@tauri-apps/api/window');
			const { listen } = await import('@tauri-apps/api/event');
			const appWindow = getCurrentWindow();

			// Listen for file-path events (from CLI args, single-instance, file associations)
			const unlistenFilePath = await listen<string>('file-path', (event) => {
				handleFilePath(event.payload);
			});
			unlisteners.push(unlistenFilePath);

			// Check for file passed via URL query param (for detached windows)
			const urlParams = new URLSearchParams(window.location.search);
			const fileParam = urlParams.get('file');
			if (fileParam) {
				handleFilePath(fileParam);
			}

			// Check for initial CLI args
			try {
				const paths = await invoke('send_markdown_path') as string[];
				if (paths.length > 0) {
					handleFilePath(paths[0]);
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
		};
	});

	// Handle CodeMirror content changes
	function handleEditorChange(newContent: string) {
		if (tabManager.activeTabId) {
			tabManager.updateTabRawContent(tabManager.activeTabId, newContent);
		}
	}

	// Reference to the editor for TOC scrolling
	let editorRef = $state<CodeMirrorEditor | null>(null);

	// Handle TOC scroll request
	function handleTocScroll(event: CustomEvent<{ lineNumber: number }>) {
		editorRef?.scrollToLine(event.detail.lineNumber);
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
		showHome={false}
		{zoomLevel}
		onselectFile={selectFile}
		ontoggleHome={toggleHome}
		ononpenFileLocation={openFileLocation}
		onresetZoom={() => (zoomLevel = 100)}
		{theme}
		onSetTheme={(t) => (theme = t)} />
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
			{showHome}
			onselectFile={selectFile}
			ontoggleHome={toggleHome}
			ononpenFileLocation={openFileLocation}
			ondetach={handleDetach}
			ontabclick={() => (showHome = false)}
			{zoomLevel}
			onresetZoom={() => (zoomLevel = 100)}
			oncloseTab={(id) => {
				canCloseTab(id).then((can) => {
					if (can) tabManager.closeTab(id);
				});
			}}
			{theme}
			onSetTheme={(t) => (theme = t)}
			{tocVisible}
			ontoggleToc={toggleToc}
			showTocButton={!showHome && tabManager.activeTab && tabManager.activeTab.path !== '' && currentFileType === 'markdown'}
			{folderExplorerVisible}
			ontoggleFolderExplorer={toggleFolderExplorer}
			showFolderExplorerButton={!!currentFolder} />

	{#if tabManager.activeTab && (tabManager.activeTab.path !== '' || tabManager.activeTab.title !== 'Recents') && !showHome}
		<TableOfContents
			rawContent={tabManager.activeTab?.rawContent ?? ''}
			visible={tocVisible && !folderExplorerVisible && currentFileType === 'markdown'}
			onscrollto={handleTocScroll}
		/>
		<FolderExplorer
			folderPath={currentFolder}
			visible={folderExplorerVisible && !tocVisible}
			onopenfile={loadMarkdown}
		/>
		<div
			class="markdown-container"
			class:toc-open={tocVisible || folderExplorerVisible}
			style="zoom: {zoomLevel / 100}"
			role="presentation"
		>
			<CodeMirrorEditor
				bind:this={editorRef}
				value={tabManager.activeTab?.rawContent ?? ''}
				{theme}
				{zoomLevel}
				readonly={false}
				fileType={currentFileType}
				onchange={handleEditorChange}
			/>
		</div>
	{:else}
		<FolderExplorer
			folderPath={currentFolder}
			visible={folderExplorerVisible && !!currentFolder}
			onopenfile={loadMarkdown}
		/>
		<div class="home-container" class:sidebar-open={folderExplorerVisible && !!currentFolder}>
			<HomePage {recentFiles} {recentFolders} onselectFile={selectFile} onselectFolder={selectFolder} onloadFile={loadMarkdown} onopenFolder={openFolder} onremoveRecentFile={removeRecentFile} onremoveRecentFolder={removeRecentFolder} onnewFile={handleNewFile} />
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
		onconfirm={handleModalConfirm}
		onsave={handleModalSave}
		oncancel={handleModalCancel} />

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
		transition: left 0.15s ease-out;
	}

	.markdown-container.toc-open {
		left: 220px;
	}

	.home-container {
		transition: margin-left 0.15s ease-out;
	}

	.home-container.sidebar-open {
		margin-left: 220px;
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
