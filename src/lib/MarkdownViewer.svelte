<script lang="ts">
	import { invoke, convertFileSrc } from '@tauri-apps/api/core';
	import { listen } from '@tauri-apps/api/event';
	import { onMount, tick } from 'svelte';
	import { openUrl, openPath } from '@tauri-apps/plugin-opener';
	import { open } from '@tauri-apps/plugin-dialog';
	import { getCurrentWindow } from '@tauri-apps/api/window';
	import iconUrl from '../assets/icon.png';

	let currentFile = $state('');
	let htmlContent = $state('');
	let recentFiles = $state<string[]>([]);
	let isFocused = $state(true);
	let scrollTop = $state(0);
	let isScrolled = $derived(scrollTop > 0);
	let markdownBody = $state<HTMLElement | null>(null);
	let liveMode = $state(false);

	const appWindow = getCurrentWindow();

	let windowTitle = $derived(currentFile ? currentFile.split(/[/\\]/).pop() || 'Unknown File' : 'Markdown Viewer');

	// UI state
	let contextMenu = $state({
		show: false,
		x: 0,
		y: 0,
	});

	// Tooltip state
	let tooltip = $state({
		show: false,
		text: '',
		x: 0,
		y: 0,
	});

	async function loadMarkdown(filePath: string) {
		try {
			scrollTop = 0;
			const html = (await invoke('open_markdown', { path: filePath })) as string;

			const parser = new DOMParser();
			const doc = parser.parseFromString(html, 'text/html');
			const imgs = doc.querySelectorAll('img');

			for (const img of imgs) {
				const src = img.getAttribute('src');
				if (src && !src.startsWith('http') && !src.startsWith('data:')) {
					const absolutePath = resolvePath(filePath, src);
					img.setAttribute('src', convertFileSrc(absolutePath));
				} else if (src && isYoutubeLink(src)) {
					const videoId = getYoutubeId(src);
					if (videoId) {
						replaceWithYoutubeEmbed(img, videoId);
					}
				}
			}

			const anchors = doc.querySelectorAll('a');
			for (const a of anchors) {
				const href = a.getAttribute('href');
				if (href && isYoutubeLink(href)) {
					const parent = a.parentElement;
					if (parent && (parent.tagName === 'P' || parent.tagName === 'DIV') && parent.childNodes.length === 1) {
						const videoId = getYoutubeId(href);
						if (videoId) {
							replaceWithYoutubeEmbed(a, videoId);
						}
					}
				}
			}

			// Parse GFM Alerts
			const blockquotes = doc.querySelectorAll('blockquote');
			for (const bq of blockquotes) {
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
						if (firstP.textContent === '' && firstP.nextSibling) {
							firstP.remove();
						}

						while (bq.firstChild) {
							alertDiv.appendChild(bq.firstChild);
						}

						bq.replaceWith(alertDiv);
					}
				}
			}
			if (markdownBody) {
				markdownBody.innerHTML = doc.body.innerHTML;
			}
			htmlContent = doc.body.innerHTML;

			if (liveMode) {
				invoke('watch_file', { path: filePath }).catch(console.error);
			}

			await tick();
			if (filePath) {
				saveRecentFile(filePath);
			}
		} catch (error) {
			console.error('Error loading Markdown file:', error);
		}
	}

	function saveRecentFile(path: string) {
		let files = [...recentFiles];
		files = files.filter((f) => f !== path);
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
		if (currentFile === path) {
			currentFile = '';
			htmlContent = '';
		}
	}

	function getFileName(path: string) {
		return path.split(/[/\\]/).pop() || path;
	}

	async function closeWindow() {
		await appWindow.close();
	}

	function resolvePath(basePath: string, relativePath: string) {
		if (relativePath.match(/^[a-zA-Z]:/) || relativePath.startsWith('/')) {
			return relativePath;
		}

		const parts = basePath.split(/[/\\]/);
		parts.pop();

		const relParts = relativePath.split(/[/\\]/);
		for (const p of relParts) {
			if (p === '.') continue;
			if (p === '..') {
				parts.pop();
			} else {
				parts.push(p);
			}
		}
		return parts.join('/');
	}

	function isYoutubeLink(url: string) {
		return url.includes('youtube.com/watch') || url.includes('youtu.be/');
	}

	function getYoutubeId(url: string) {
		const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
		const match = url.match(regExp);
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
		if (currentFile) {
			await invoke('open_in_notepad', { path: currentFile });
		} else {
			console.error('No file path available to open in editor.');
		}
		contextMenu.show = false;
	}

	async function selectFile() {
		const selected = await open({
			multiple: false,
			filters: [
				{
					name: 'Markdown',
					extensions: ['md'],
				},
			],
		});
		if (selected && typeof selected === 'string') {
			currentFile = selected;
			loadMarkdown(selected);
		}
		contextMenu.show = false;
	}

	async function closeFile() {
		currentFile = '';
		htmlContent = '';
		scrollTop = 0;
		contextMenu.show = false;
		if (liveMode) {
			invoke('unwatch_file').catch(console.error);
		}
	}

	async function openFileLocation() {
		if (currentFile) {
			const dir = currentFile.substring(0, Math.max(currentFile.lastIndexOf('/'), currentFile.lastIndexOf('\\')));
			await openPath(dir);
		}
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
		e.preventDefault();
		contextMenu.x = e.clientX;
		contextMenu.y = e.clientY;
		contextMenu.show = true;
	}

	function hideContextMenu() {
		contextMenu.show = false;
	}

	async function startDragging() {
		try {
			await appWindow.startDragging();
		} catch (e) {
			console.error('Dragging failed:', e);
		}
	}

	function handleMouseOver(event: MouseEvent) {
		let target = event.target as HTMLElement;
		while (target && target.tagName !== 'A' && target !== document.body) {
			target = target.parentElement as HTMLElement;
		}

		if (target && target.tagName === 'A') {
			const anchor = target as HTMLAnchorElement;
			if (anchor.href) {
				tooltip.text = anchor.href;
				const rect = anchor.getBoundingClientRect();
				tooltip.x = rect.left + rect.width / 2;
				tooltip.y = rect.top - 8;
				tooltip.show = true;
			}
		}
	}

	function handleMouseOut(event: MouseEvent) {
		let target = event.target as HTMLElement;
		while (target && target.tagName !== 'A' && target !== document.body) {
			target = target.parentElement as HTMLElement;
		}
		if (target && target.tagName === 'A') {
			tooltip.show = false;
		}
	}

	async function handleDocumentClick(event: MouseEvent) {
		hideContextMenu();

		let target = event.target as HTMLElement;
		while (target && target.tagName !== 'A' && target !== document.body) {
			target = target.parentElement as HTMLElement;
		}

		if (target && target.tagName === 'A' && (target as HTMLAnchorElement).href) {
			const anchor = target as HTMLAnchorElement;
			if (!anchor.href.startsWith('#')) {
				event.preventDefault();
				await openUrl(anchor.href);
			}
		}
	}

	function handleScroll(e: Event) {
		const target = e.target as HTMLElement;
		scrollTop = target.scrollTop;
	}

	async function toggleLiveMode() {
		liveMode = !liveMode;
		if (liveMode && currentFile) {
			await invoke('watch_file', { path: currentFile });
		} else {
			await invoke('unwatch_file');
		}
	}

	onMount(() => {
		loadRecentFiles();

		let unlistenFocus: (() => void) | null = null;
		let unlistenFileChanged: (() => void) | null = null;
		let unlistenPath: (() => void) | null = null;

		const init = async () => {
			unlistenFocus = await appWindow.onFocusChanged(({ payload: focused }) => {
				isFocused = focused;
			});

			unlistenFileChanged = await listen('file-changed', () => {
				if (liveMode && currentFile) {
					loadMarkdown(currentFile);
				}
			});

			unlistenPath = await listen('file-path', (event) => {
				const filePath = event.payload as string;
				if (filePath) {
					currentFile = filePath;
					loadMarkdown(filePath);
				}
			});

			try {
				const args: string[] = await invoke('send_markdown_path');
				console.log('Rust args:', args);

				if (args && args.length > 0) {
					currentFile = args[0];
					loadMarkdown(currentFile);
				}
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

<svelte:document onclick={handleDocumentClick} oncontextmenu={handleContextMenu} onmouseover={handleMouseOver} onmouseout={handleMouseOut} />

<div class="custom-title-bar {isScrolled ? 'scrolled' : ''}" data-tauri-drag-region>
	<div class="window-controls-left">
		<button class="icon-home-btn" onclick={closeFile} aria-label="Go to Home" title="Go to home">
			<img src={iconUrl} alt="icon" class="window-icon" />
		</button>

		<div class="title-actions">
			<button class="title-action-btn" onclick={selectFile} aria-label="Open File" title="Open file">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
					><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
			</button>
			{#if currentFile}
				<button class="title-action-btn" onclick={openFileLocation} aria-label="Open File Location" title="Open folder">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
						><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path><polyline points="15 13 18 13 18 10"></polyline><line
							x1="14"
							y1="14"
							x2="18"
							y2="10"></line
						></svg>
				</button>
				<button class="title-action-btn {liveMode ? 'active' : ''}" onclick={toggleLiveMode} aria-label="Toggle Live Mode" title="Live update mode">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
						><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0z" /><circle cx="12" cy="12" r="3" /></svg>
				</button>
				<button class="title-action-btn" onclick={openInEditor} aria-label="Edit in Notepad" title="Edit in Notepad">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
						><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
				</button>
			{/if}
		</div>
	</div>

	<div class="window-title-container">
		<div class="window-title {isFocused ? 'focused' : 'unfocused'}">
			<span class="title-text {windowTitle.length > 50 ? 'marquee' : ''}">
				{windowTitle}
			</span>
		</div>
	</div>

	<div class="window-controls-right">
		<button class="control-btn" onclick={() => appWindow.minimize()} aria-label="Minimize">
			<svg width="12" height="12" viewBox="0 0 12 12"><rect fill="currentColor" width="10" height="1" x="1" y="6" /></svg>
		</button>
		<button class="control-btn" onclick={() => appWindow.toggleMaximize()} aria-label="Maximize">
			<svg width="12" height="12" viewBox="0 0 12 12"><rect fill="none" stroke="currentColor" stroke-width="1" width="9" height="9" x="1.5" y="1.5" /></svg>
		</button>
		<button class="control-btn close-btn" onclick={() => appWindow.close()} aria-label="Close">
			<svg width="12" height="12" viewBox="0 0 12 12"><path fill="currentColor" d="M11 1.7L10.3 1 6 5.3 1.7 1 1 1.7 5.3 6 1 10.3 1.7 11 6 6.7 10.3 11 11 10.3 6.7 6z" /></svg>
		</button>
	</div>
</div>

{#if contextMenu.show}
	<div
		class="context-menu"
		style="left: {contextMenu.x}px; top: {contextMenu.y}px;"
		onclick={(e) => e.stopPropagation()}
		role="menu"
		tabindex="-1"
		onkeydown={(e) => e.key === 'Escape' && hideContextMenu()}>
		<button class="menu-item" onclick={copySelection}>Copy</button>
		<button class="menu-item" onclick={selectAll}>Select All</button>
		<div class="menu-separator"></div>
		<button class="menu-item" onclick={openFileLocation} disabled={!currentFile}>Open file location</button>
		<button class="menu-item" onclick={openInEditor} disabled={!currentFile}>Open in Notepad</button>
		<div class="menu-separator"></div>
		<button class="menu-item" onclick={closeFile} disabled={!currentFile}>Close</button>
	</div>
{/if}

{#if !currentFile}
	<div class="message">
		<p>Open a Markdown file</p>
		<button class="fluent-btn primary" onclick={selectFile}>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				width="16"
				height="16"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
			Open file
		</button>

		<div class="recent-section">
			<h3>Recent Files</h3>
			{#if recentFiles.length > 0}
				<div class="recent-grid">
					{#each recentFiles as file}
						<div
							class="recent-card"
							onclick={() => {
								currentFile = file;
								loadMarkdown(file);
							}}
							role="button"
							tabindex="0"
							onkeydown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									currentFile = file;
									loadMarkdown(file);
								}
							}}>
							<div class="file-icon">
								<svg
									xmlns="http://www.w3.org/2000/svg"
									width="24"
									height="24"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" /></svg>
							</div>
							<div class="file-info">
								<span class="file-name">{getFileName(file)}</span>
								<span class="file-path" title={file}>{file}</span>
							</div>
							<button class="clear-btn" onclick={(e) => removeRecentFile(file, e as MouseEvent)} title="Remove from history">
								<svg
									xmlns="http://www.w3.org/2000/svg"
									width="14"
									height="14"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
							</button>
						</div>
					{/each}
				</div>
			{:else}
				<p class="empty-recent">Your recently opened files will appear here.</p>
			{/if}
		</div>
	</div>
{:else}
	<article bind:this={markdownBody} contenteditable="false" class="markdown-body" bind:innerHTML={htmlContent} onscroll={handleScroll}></article>
{/if}

{#if tooltip.show}
	<div class="tooltip" style="left: {tooltip.x}px; top: {tooltip.y}px;">
		{tooltip.text}
	</div>
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
		overflow: hidden; /* Prevent body scroll, article handles it */
	}

	.custom-title-bar {
		height: 32px;
		background-color: var(--color-canvas-default);
		display: flex;
		justify-content: space-between;
		align-items: center;
		user-select: none;
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		z-index: 9999;
		font-family: var(--win-font);
		border-bottom: 1px solid transparent;
		transition: border-color 0.2s;
	}

	.custom-title-bar.scrolled {
		border-bottom-color: var(--color-border-muted);
	}

	.window-controls-left {
		display: flex;
		align-items: center;
		padding-left: 10px;
		gap: 12px;
		position: relative;
		z-index: 10000;
	}

	.title-actions {
		display: flex;
		gap: 4px;
	}

	.title-action-btn {
		width: 28px;
		height: 28px;
		display: flex;
		justify-content: center;
		align-items: center;
		background: transparent;
		border: none;
		color: var(--color-fg-muted);
		border-radius: 4px;
		cursor: pointer;
		transition: all 0.1s;
	}

	.title-action-btn.active {
		color: var(--color-accent-fg);
		background: var(--color-canvas-subtle);
	}

	.title-action-btn:hover {
		background: var(--color-canvas-subtle);
		color: var(--color-fg-default);
	}

	.window-icon {
		width: 16px;
		height: 16px;
		opacity: 0.8;
	}

	@media (prefers-color-scheme: light) {
		.window-icon {
			filter: grayscale(1) brightness(0.2);
			opacity: 0.6;
		}
	}

	.icon-home-btn {
		background: transparent;
		border: none;
		padding: 4px;
		margin: -4px;
		border-radius: 4px;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition: background 0.1s;
	}

	.icon-home-btn:hover {
		background: var(--color-canvas-subtle);
	}

	.window-title-container {
		position: absolute;
		left: 0;
		right: 0;
		top: 0;
		bottom: 0;
		display: flex;
		justify-content: center;
		align-items: center;
		pointer-events: none; /* VERY IMPORTANT: Let clicks and drag events pass THROUGH to the bar */
		z-index: 5;
	}

	.window-title {
		font-size: 12px;
		transition: opacity 0.2s;
		white-space: nowrap;
		overflow: hidden;
		max-width: 50%;
		display: flex;
	}

	.window-title.focused {
		opacity: 0.8;
		color: var(--color-fg-default);
	}

	.window-title.unfocused {
		opacity: 0.4;
		color: var(--color-fg-default);
	}

	.title-text.marquee {
		display: inline-block;
		padding-left: 100%;
		animation: marquee 15s linear infinite;
	}

	@keyframes marquee {
		0% {
			transform: translateX(0);
		}
		100% {
			transform: translateX(-100%);
		}
	}

	.window-controls-right {
		display: flex;
		height: 100%;
		position: relative;
		z-index: 10000;
	}

	.control-btn {
		width: 46px;
		height: 32px;
		display: flex;
		justify-content: center;
		align-items: center;
		background: transparent;
		border: none;
		color: var(--color-fg-default);
		opacity: 0.8;
		cursor: default;
		transition: all 0.1s;
	}

	.control-btn:hover {
		background: var(--color-canvas-subtle);
		opacity: 1;
	}

	.close-btn:hover {
		background: #e81123 !important;
	}

	.markdown-body {
		box-sizing: border-box;
		min-width: 200px;
		max-width: 980px;
		margin: 0 auto;
		padding: 45px;
		margin-top: 32px;
		height: calc(100vh - 32px);
		overflow-y: auto;
	}

	:global(.video-container) {
		position: relative;
		padding-bottom: 56.25%; /* 16:9 */
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

	.message {
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: center;
		user-select: none;
		font-family: var(--win-font);
		height: 90vh;
		width: 100%;
		box-sizing: border-box;
		padding: 0 20px;
		color: var(--color-fg-default);
		opacity: 0.8;
	}

	.fluent-btn {
		background: var(--color-canvas-subtle);
		color: var(--color-fg-default);
		border: 1px solid var(--color-border-default);
		padding: 8px 20px;
		border-radius: 6px;
		cursor: pointer;
		font-weight: 500;
		font-family: var(--win-font);
		font-size: 14px;
		transition: all 0.2s cubic-bezier(0.1, 0.9, 0.2, 1);
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
	}

	.fluent-btn.primary {
		background: #0078d4;
		color: white;
		border: 1px solid rgba(0, 0, 0, 0.1);
		margin-top: 20px;
	}

	.recent-section {
		margin-top: 60px;
		width: 100%;
		max-width: 800px;
		padding: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		animation: slideUp 0.6s var(--animation);
		box-sizing: border-box;
		overflow-x: hidden;
	}

	@keyframes slideUp {
		from {
			opacity: 0;
			transform: translateY(20px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.empty-recent {
		font-size: 14px;
		margin-bottom: 20px;
		opacity: 0.5;
		text-align: center;
	}

	.recent-section h3 {
		font-size: 14px;
		font-weight: 600;
		margin-bottom: 20px;
		opacity: 0.8;
		text-align: center;
	}

	.recent-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 220px));
		justify-content: center;
		gap: 12px;
		width: 100%;
		box-sizing: border-box;
	}

	.recent-card {
		position: relative;
		background: var(--color-canvas-subtle);
		border: 1px solid var(--color-border-default);
		border-radius: 8px;
		padding: 12px 16px;
		display: flex;
		align-items: center;
		gap: 12px;
		cursor: pointer;
		transition: all 0.2s cubic-bezier(0.1, 0.9, 0.2, 1);
		text-align: left;
		color: var(--color-fg-default);
		outline: none;
		width: 220px;
		box-sizing: border-box;
	}

	.recent-card:hover {
		background: var(--color-neutral-muted);
		border-color: var(--color-accent-fg);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
	}

	.recent-card:active {
		transform: scale(0.98);
	}

	.file-icon {
		opacity: 0.6;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.file-info {
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.file-name {
		font-size: 13px;
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.file-path {
		font-size: 11px;
		opacity: 0.5;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		margin-top: 2px;
	}

	.clear-btn {
		position: absolute;
		top: 4px;
		right: 4px;
		background: none;
		border: none;
		padding: 4px;
		cursor: pointer;
		opacity: 0;
		transition: opacity 0.2s;
		color: inherit;
		border-radius: 4px;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.recent-card:hover .clear-btn {
		opacity: 0.4;
	}

	.clear-btn:hover {
		opacity: 1 !important;
		background: rgba(255, 0, 0, 0.1);
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

	.context-menu {
		position: fixed;
		background: var(--color-canvas-default);
		border: 1px solid var(--color-border-default);
		border-radius: 8px;
		padding: 4px;
		min-width: 180px;
		z-index: 20000;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
		font-family: var(--win-font);
		animation: menuFade 0.1s ease-out;
	}

	@keyframes menuFade {
		from {
			opacity: 0;
			transform: scale(0.95);
		}
		to {
			opacity: 1;
			transform: scale(1);
		}
	}

	.menu-item {
		width: 100%;
		text-align: left;
		background: transparent;
		border: none;
		color: var(--color-fg-default);
		padding: 6px 12px;
		font-size: 13px;
		border-radius: 4px;
		cursor: default;
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.menu-item:hover:not(:disabled) {
		background: var(--color-neutral-muted);
	}

	.menu-item:disabled {
		opacity: 0.3;
	}

	.menu-separator {
		height: 1px;
		background: var(--color-border-muted);
		margin: 4px 0;
	}
</style>
