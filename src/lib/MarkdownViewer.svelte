<script lang="ts">
	import { invoke, convertFileSrc } from '@tauri-apps/api/core';
	import { listen } from '@tauri-apps/api/event';
	import { onMount, tick } from 'svelte';
	import { openUrl } from '@tauri-apps/plugin-opener';
	import { open } from '@tauri-apps/plugin-dialog';
	import Installer from './Installer.svelte';
	import Uninstaller from './Uninstaller.svelte';
	import TitleBar from './components/TitleBar.svelte';
	import ContextMenu from './components/ContextMenu.svelte';
	import HomePage from './components/HomePage.svelte';
	import { tabManager } from './stores/tabs.svelte.js';

	// syntax highlighting & latex
	import hljs from 'highlight.js';
	import 'highlight.js/styles/github-dark.css';
	import 'katex/dist/katex.min.css';
	// @ts-ignore
	import renderMathInElement from 'katex/dist/contrib/auto-render';

	let mode = $state<'loading' | 'app' | 'installer' | 'uninstall'>('loading');

	let recentFiles = $state<string[]>([]);
	let isFocused = $state(true);
	let markdownBody = $state<HTMLElement | null>(null);
	let liveMode = $state(false);

	// derived from tab manager
	let currentFile = $derived(tabManager.activeTab?.path ?? '');
	let htmlContent = $derived(tabManager.activeTab?.content ?? '');
	let scrollTop = $derived(tabManager.activeTab?.scrollTop ?? 0);
	let isScrolled = $derived(scrollTop > 0);
	let windowTitle = $derived(tabManager.activeTab?.title ?? 'Markdown Viewer');

	// ui state
	let contextMenu = $state({ show: false, x: 0, y: 0 });
	let tooltip = $state({ show: false, text: '', x: 0, y: 0 });

	async function loadMarkdown(filePath: string) {
		try {
			tabManager.addTab(filePath);
			const activeId = tabManager.activeTabId;
			if (!activeId) return;

			const html = (await invoke('open_markdown', { path: filePath })) as string;

			const parser = new DOMParser();
			const doc = parser.parseFromString(html, 'text/html');

			// resolve relative image paths
			for (const img of doc.querySelectorAll('img')) {
				const src = img.getAttribute('src');
				if (src && !src.startsWith('http') && !src.startsWith('data:')) {
					img.setAttribute('src', convertFileSrc(resolvePath(filePath, src)));
				} else if (src && isYoutubeLink(src)) {
					const videoId = getYoutubeId(src);
					if (videoId) replaceWithYoutubeEmbed(img, videoId);
				}
			}

			// convert youtube links to embeds
			for (const a of doc.querySelectorAll('a')) {
				const href = a.getAttribute('href');
				if (href && isYoutubeLink(href)) {
					const parent = a.parentElement;
					if (parent && (parent.tagName === 'P' || parent.tagName === 'DIV') && parent.childNodes.length === 1) {
						const videoId = getYoutubeId(href);
						if (videoId) replaceWithYoutubeEmbed(a, videoId);
					}
				}
			}

			// parse gfm alerts
			for (const bq of doc.querySelectorAll('blockquote')) {
				const firstP = bq.querySelector('p');
				if (firstP) {
					const text = firstP.textContent || '';
					const match = text.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i);
					if (match) {
						const alertIcons: Record<string, string> = {
							note: '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"></path></svg>',
							tip: '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 1.5c-2.363 0-4 1.69-4 3.75 0 .984.424 1.625.984 2.304l.214.253c.223.264.47.556.673.848.284.411.537.896.621 1.49a.75.75 0 0 1-1.484.21c-.044-.312-.18-.692-.41-1.025-.23-.333-.524-.681-.797-1.004l-.213-.252C2.962 7.325 2.5 6.395 2.5 5.25c0-2.978 2.304-5.25 5.5-5.25S13.5 2.272 13.5 5.25c0 1.145-.462 2.075-1.087 2.819l-.213.252c-.273.323-.567.671-.797 1.004-.23.333-.366.713-.41 1.025a.75.75 0 0 1-1.484-.21c.084-.594.337-1.079.621-1.49.203-.292.45-.584.673-.848l.214-.253c.56-.679.984-1.32.984-2.304 0-2.06-1.637-3.75-4-3.75ZM5.75 12h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5ZM6.25 14.5h3.5a.75.75 0 0 1 0 1.5h-3.5a.75.75 0 0 1 0-1.5Z"></path></svg>',
							important:
								'<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0 1 14.25 13H8.06l-2.573 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Zm1.75-.25a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25Zm7 2.25v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"></path></svg>',
							warning:
								'<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.03 11.315a1.75 1.75 0 0 1-1.543 2.573H1.97a1.75 1.75 0 0 1-1.543-2.573ZM9 4.25a.75.75 0 0 0-1.5 0V9a.75.75 0 0 0 1.5 0ZM9 11a1 1 0 1 0-2 0 1 1 0 0 0 2 0Z"></path></svg>',
							caution:
								'<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M4.47.22A.749.749 0 0 1 5 0h6c.199 0 .39.079.53.22l4.25 4.25c.141.14.22.331.22.53v6a.749.749 0 0 1-.22.53l-4.25 4.25A.749.749 0 0 1 11 16H5a.749.749 0 0 1-.53-.22L.22 11.53A.749.749 0 0 1 0 11V5c0-.199.079-.39.22-.53Zm.84 1.28L1.5 5.31v5.38l3.81 3.81h5.38l3.81-3.81V5.31L10.69 1.5ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"></path></svg>',
						};

						const type = match[1].toLowerCase();
						const alertDiv = doc.createElement('div');
						alertDiv.className = `markdown-alert markdown-alert-${type}`;

						const titleP = doc.createElement('p');
						titleP.className = 'markdown-alert-title';
						titleP.innerHTML = `${alertIcons[type] || ''} <span>${type.charAt(0).toUpperCase() + type.slice(1)}</span>`;

						alertDiv.appendChild(titleP);

						firstP.textContent = text.replace(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i, '').trim() || '';
						if (firstP.textContent === '' && firstP.nextSibling) firstP.remove();

						while (bq.firstChild) alertDiv.appendChild(bq.firstChild);
						bq.replaceWith(alertDiv);
					}
				}
			}

			tabManager.updateTabContent(activeId, doc.body.innerHTML);

			if (liveMode) invoke('watch_file', { path: filePath }).catch(console.error);

			await tick();
			if (filePath) saveRecentFile(filePath);
		} catch (error) {
			console.error('Error loading Markdown file:', error);
		}
	}

	function renderRichContent() {
		if (!markdownBody) return;

		markdownBody.querySelectorAll('pre code').forEach((block) => {
			hljs.highlightElement(block as HTMLElement);

			const pre = block.parentElement;
			if (pre && pre.tagName === 'PRE') {
				pre.querySelectorAll('.lang-label').forEach((l) => l.remove());
				const langClass = Array.from(block.classList).find((c) => c.startsWith('language-'));
				if (langClass) {
					const label = document.createElement('span');
					label.className = 'lang-label';
					label.textContent = langClass.replace('language-', '');
					pre.appendChild(label);
				}
			}
		});

		renderMathInElement(markdownBody, {
			delimiters: [
				{ left: '$$', right: '$$', display: true },
				{ left: '$', right: '$', display: false },
				{ left: '\\(', right: '\\)', display: false },
				{ left: '\\[', right: '\\]', display: true },
			],
			throwOnError: false,
		});
	}

	$effect(() => {
		if (htmlContent && markdownBody) renderRichContent();
	});

	$effect(() => {
		const tab = tabManager.activeTab;
		if (tab && markdownBody) markdownBody.scrollTop = tab.scrollTop;
	});

	function saveRecentFile(path: string) {
		let files = [...recentFiles].filter((f) => f !== path);
		files.unshift(path);
		recentFiles = files.slice(0, 4);
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

	function removeRecentFile(path: string, event: MouseEvent) {
		event.stopPropagation();
		recentFiles = recentFiles.filter((f) => f !== path);
		localStorage.setItem('recent-files', JSON.stringify(recentFiles));
		if (currentFile === path) tabManager.closeTab(tabManager.activeTabId!);
	}

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

	function isYoutubeLink(url: string) {
		return url.includes('youtube.com/watch') || url.includes('youtu.be/');
	}

	function getYoutubeId(url: string) {
		const match = url.match(/^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/);
		return match && match[2].length === 11 ? match[2] : null;
	}

	function replaceWithYoutubeEmbed(element: Element, videoId: string) {
		const container = element.ownerDocument.createElement('div');
		container.className = 'video-container';
		const iframe = element.ownerDocument.createElement('iframe');
		iframe.src = `https://www.youtube.com/embed/${videoId}`;
		iframe.title = 'YouTube video player';
		iframe.frameBorder = '0';
		iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
		iframe.allowFullscreen = true;
		container.appendChild(iframe);
		element.replaceWith(container);
	}

	async function openInEditor() {
		if (currentFile) await invoke('open_in_notepad', { path: currentFile });
		contextMenu.show = false;
	}

	async function selectFile() {
		const selected = await open({
			multiple: false,
			filters: [{ name: 'Markdown', extensions: ['md'] }],
		});
		if (selected && typeof selected === 'string') loadMarkdown(selected);
		contextMenu.show = false;
	}

	async function closeFile() {
		if (tabManager.activeTabId) tabManager.closeTab(tabManager.activeTabId);
		contextMenu.show = false;
		if (liveMode && tabManager.tabs.length === 0) invoke('unwatch_file').catch(console.error);
	}

	async function openFileLocation() {
		if (currentFile) await invoke('open_file_folder', { path: currentFile });
		contextMenu.show = false;
	}

	async function copySelection() {
		document.execCommand('copy');
		contextMenu.show = false;
	}

	async function selectAll() {
		if (markdownBody) {
			const range = document.createRange();
			range.selectNodeContents(markdownBody);
			const selection = window.getSelection();
			if (selection) {
				selection.removeAllRanges();
				selection.addRange(range);
			}
		}
		contextMenu.show = false;
	}

	function handleContextMenu(e: MouseEvent) {
		if (mode !== 'app') return;
		e.preventDefault();
		contextMenu = { show: true, x: e.clientX, y: e.clientY };
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
		contextMenu.show = false;
		let target = event.target as HTMLElement;
		while (target && target.tagName !== 'A' && target !== document.body) target = target.parentElement as HTMLElement;
		if (target?.tagName === 'A') {
			const anchor = target as HTMLAnchorElement;
			if (anchor.href && !anchor.href.startsWith('#')) {
				event.preventDefault();
				await openUrl(anchor.href);
			}
		}
	}

	function handleScroll(e: Event) {
		if (tabManager.activeTabId) {
			tabManager.updateTabScroll(tabManager.activeTabId, (e.target as HTMLElement).scrollTop);
		}
	}

	async function toggleLiveMode() {
		liveMode = !liveMode;
		if (liveMode && currentFile) {
			await invoke('watch_file', { path: currentFile });
			if (tabManager.activeTabId) await loadMarkdown(currentFile);
		} else {
			await invoke('unwatch_file');
		}
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (mode !== 'app') return;
		if (e.ctrlKey && e.key === 'w') {
			e.preventDefault();
			if (tabManager.activeTabId) tabManager.closeTab(tabManager.activeTabId);
		}
		if (e.ctrlKey && e.key === 't') {
			e.preventDefault();
			tabManager.addHomeTab();
		}
		if (e.ctrlKey && e.key === 'Tab') {
			e.preventDefault();
			tabManager.cycleTab(e.shiftKey ? 'prev' : 'next');
		}
	}

	async function handleDetach(tabId: string) {
		const tab = tabManager.tabs.find((t) => t.id === tabId);
		if (!tab || !tab.path) return;

		const path = tab.path;
		tabManager.closeTab(tabId);

		const label = 'window-' + Date.now();
		const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
		const webview = new WebviewWindow(label, {
			url: 'index.html?file=' + encodeURIComponent(path),
			title: 'Markdown Viewer - ' + path.split(/[/\\]/).pop(),
			width: 1000,
			height: 800,
		});
	}

	onMount(() => {
		loadRecentFiles();
		let unlistenFocus: (() => void) | null = null;
		let unlistenFileChanged: (() => void) | null = null;
		let unlistenPath: (() => void) | null = null;

		const init = async () => {
			const { getCurrentWindow } = await import('@tauri-apps/api/window');
			const appWindow = getCurrentWindow();
			mode = (await invoke('get_app_mode')) as any;

			// Handle query param for detached windows
			const urlParams = new URLSearchParams(window.location.search);
			const fileParam = urlParams.get('file');
			if (fileParam) {
				const decodedPath = decodeURIComponent(fileParam);
				// Small delay to ensure everything is ready?
				setTimeout(() => loadMarkdown(decodedPath), 100);
			}

			unlistenFocus = await appWindow.onFocusChanged(({ payload: focused }) => {
				isFocused = focused;
			});
			unlistenFileChanged = await listen('file-changed', () => {
				if (liveMode && currentFile) loadMarkdown(currentFile);
			});
			unlistenPath = await listen('file-path', (event) => {
				const filePath = event.payload as string;
				if (filePath) loadMarkdown(filePath);
			});

			try {
				const args: string[] = await invoke('send_markdown_path');
				if (args?.length > 0) loadMarkdown(args[0]);
			} catch (error) {
				console.error('Error receiving Markdown file path:', error);
			}
		};

		init();

		return () => {
			if (unlistenFocus) unlistenFocus();
			if (unlistenFileChanged) unlistenFileChanged();
			if (unlistenPath) unlistenPath();
		};
	});
</script>

<svelte:document onclick={handleDocumentClick} oncontextmenu={handleContextMenu} onmouseover={handleMouseOver} onmouseout={handleMouseOut} onkeydown={handleKeyDown} />

{#if mode === 'loading'}
	<div class="loading-screen"></div>
{:else if mode === 'installer'}
	<Installer />
{:else if mode === 'uninstall'}
	<Uninstaller />
{:else}
	<TitleBar
		{isFocused}
		{isScrolled}
		{currentFile}
		{liveMode}
		{windowTitle}
		onselectFile={selectFile}
		oncloseFile={closeFile}
		ononpenFileLocation={openFileLocation}
		ontoggleLiveMode={toggleLiveMode}
		onopenInEditor={openInEditor}
		ondetach={handleDetach} />

	<ContextMenu
		show={contextMenu.show}
		x={contextMenu.x}
		y={contextMenu.y}
		{currentFile}
		oncopy={copySelection}
		onselectAll={selectAll}
		onopenFileLocation={openFileLocation}
		onopenInEditor={openInEditor}
		oncloseFile={closeFile}
		onhide={() => (contextMenu.show = false)} />

	{#if currentFile}
	<div class="markdown-container">
		<article bind:this={markdownBody} contenteditable="false" class="markdown-body" bind:innerHTML={htmlContent} onscroll={handleScroll}></article>
	</div>
	{:else}
		<HomePage {recentFiles} onselectFile={selectFile} onloadFile={loadMarkdown} onremoveRecentFile={removeRecentFile} />
	{/if}

	{#if tooltip.show}
		<div class="tooltip" style="left: {tooltip.x}px; top: {tooltip.y}px;">
			{tooltip.text}
		</div>
	{/if}
{/if}

<style>
	:root {
		--animation: cubic-bezier(0.05, 0.95, 0.05, 0.95);
		scroll-behavior: smooth !important;
		background-color: var(--color-canvas-default);
	}

	:global(body) {
		background-color: var(--color-canvas-default);
		margin: 0;
		padding: 0;
		color: var(--color-fg-default);
		overflow: hidden;
	}

	.markdown-body {
		box-sizing: border-box;
		min-width: 200px;
		margin: 36px 0px 0px 0px;
		padding:50px clamp(calc(calc(50% - 390px)), 5vw, 50px);
		height: calc(100vh - 36px);
		overflow-y: auto;
	}

	:global(.video-container) {
		position: relative;
		padding-bottom: 56.25%;
		height: 0;
		overflow: hidden;
		max-width: 100%;
		margin: 1em 0;
	}

	:global(.video-container iframe) {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		border-radius: 8px;
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
</style>
