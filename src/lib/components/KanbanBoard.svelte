<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import { parseKanban, serializeKanban, detectKanbanFormat, createCard, type KanbanCard, type KanbanColumn, type KanbanFormat } from '$lib/utils/kanban.js';
	import { serializeMarkoKanban, upgradeToMarko } from '$lib/utils/markoKanban.js';
	import { debounce } from '$lib/utils/debounce.js';
	import type { FileIndex } from '$lib/utils/wikiLinks';
	import CodeMirrorEditor from './CodeMirrorEditor.svelte';
	import CardDetailPane from './CardDetailPane.svelte';
	import Modal from './Modal.svelte';
	import { parseInline } from 'marked';
	import DOMPurify from 'dompurify';
	import { EditorView, keymap } from '@codemirror/view';
	import { EditorState } from '@codemirror/state';
	import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
	import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
	import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
	import { createTheme } from './codemirror/theme.js';

	let {
		content = '',
		onchange,
		readonly = false,
		theme = 'system',
		rawMode = $bindable(false),
		fileIndex = { entries: [], byBasename: new Map(), byFilename: new Map() } as FileIndex,
	}: {
		content: string;
		onchange: (s: string) => void;
		readonly?: boolean;
		theme?: 'system' | 'dark' | 'light';
		rawMode?: boolean;
		fileIndex?: FileIndex;
	} = $props();

	let columns = $state<KanbanColumn[]>([]);
	let frontmatter = $state('');
	let format = $state<KanbanFormat>('obsidian');

	// Pointer-based drag state
	let dragSrc = $state<{ colIdx: number; cardIdx: number } | null>(null);
	let dropTarget = $state<{ colIdx: number; insertIdx: number } | null>(null);
	let ghostEl: HTMLElement | null = null;
	let dragOffsetX = 0;
	let dragOffsetY = 0;

	const DRAG_THRESHOLD = 5;
	let pendingDrag: {
		colIdx: number; cardIdx: number; cardEl: HTMLElement;
		startX: number; startY: number; offsetX: number; offsetY: number;
	} | null = null;

	// Column delete confirmation
	let confirmDeleteCol = $state<number | null>(null);

	// Card delete confirmation
	let confirmDeleteCard = $state<{ colIdx: number; cardIdx: number } | null>(null);

	// Add card state per column ('top' or 'bottom' position)
	let addingCard = $state<{ colIdx: number; position: 'top' | 'bottom' } | null>(null);
	let newCardText = $state('');

	// Inline card editing
	let editingCard = $state<{ colIdx: number; cardIdx: number } | null>(null);
	let editingText = '';

	// Detail pane
	let paneCard = $state<{ colIdx: number; cardIdx: number } | null>(null);
	let paneCardRef: KanbanCard | null = null;

	// Add column state
	let addingColumn = $state(false);
	let newColumnName = $state('');

	// Shared CodeMirror instance for card editing
	let sharedEditorEl: HTMLDivElement;
	let sharedView: EditorView | null = null;
	let editorPos = $state({ left: 0, top: 0, width: 280 });
	let editorVisible = $state(false);

	// Parse content whenever it changes externally (but not when rawMode is active)
	let prevContent = '';
	$effect(() => {
		if (content !== prevContent && !rawMode) {
			const parsed = parseKanban(content);
			columns = parsed.columns;
			frontmatter = parsed.frontmatter;
			format = detectKanbanFormat(content);
			prevContent = content;
		}
	});

	function commit() {
		const hasBody = columns.some((col) => col.cards.some((card) => card.body));
		if (format === 'marko' || hasBody) {
			if (format !== 'marko') {
				format = 'marko';
				frontmatter = upgradeToMarko(frontmatter);
			}
			const serialized = serializeMarkoKanban(columns, frontmatter);
			prevContent = serialized;
			onchange(serialized);
		} else {
			const serialized = serializeKanban(columns, frontmatter);
			prevContent = serialized;
			onchange(serialized);
		}
	}

	// --- Markdown rendering ---

	function renderWikiLinks(html: string): string {
		return html.replace(/\[\[([^\]]+?)(?:\|([^\]]+?))?\]\]/g, (_, target, display) => {
			const label = display || target;
			const escaped = target.replace(/"/g, '&quot;');
			return `<a class="wiki-link" data-target="${escaped}">${label}</a>`;
		});
	}

	function renderCardMarkdown(text: string): string {
		const html = parseInline(text) as string;
		const sanitized = DOMPurify.sanitize(html, {
			ALLOWED_TAGS: ['strong', 'em', 'code', 'del', 's', 'a', 'br'],
		});
		return renderWikiLinks(sanitized);
	}

	function handleCardClick(e: MouseEvent) {
		const link = (e.target as HTMLElement).closest<HTMLAnchorElement>('a.wiki-link');
		if (!link) return;
		e.preventDefault();
		e.stopPropagation();
		const target = link.dataset.target;
		if (!target) return;
		const newTab = e.ctrlKey || e.metaKey || e.button === 1;
		document.dispatchEvent(new CustomEvent('marko:wiki-link', { detail: { target, newTab } }));
	}

	function handleCardAuxClick(e: MouseEvent) {
		if (e.button !== 1) return;
		const link = (e.target as HTMLElement).closest<HTMLAnchorElement>('a.wiki-link');
		if (!link) return;
		e.preventDefault();
		e.stopPropagation();
		const target = link.dataset.target;
		if (!target) return;
		document.dispatchEvent(new CustomEvent('marko:wiki-link', { detail: { target, newTab: true } }));
	}

	function bodyPreview(body: string): string {
		return body.split('\n').find((l) => l.trim()) ?? '';
	}

	// --- Shared CodeMirror editor ---

	onMount(() => {
		initSharedEditor();
	});

	onDestroy(() => {
		sharedView?.destroy();
		sharedView = null;
		debouncedPaneCommit.cancel();
	});

	function initSharedEditor() {
		const state = EditorState.create({
			doc: '',
			extensions: [
				history(),
				EditorView.lineWrapping,
				keymap.of([
					{ key: 'Mod-Enter', run: () => { commitEditCard(); return true; } },
					{ key: 'Escape', run: () => { cancelEditCard(); return true; } },
					...defaultKeymap,
					...historyKeymap,
				]),
				markdown({ base: markdownLanguage }),
				syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
				createTheme(),
				EditorView.contentAttributes.of({
					autocomplete: 'off',
					autocorrect: 'off',
					autocapitalize: 'off',
					spellcheck: 'false',
				}),
				EditorView.updateListener.of((update) => {
					if (update.docChanged) editingText = update.state.doc.toString();
				}),
			],
		});

		sharedView = new EditorView({ state, parent: sharedEditorEl });
	}

	async function startEditCard(colIdx: number, cardIdx: number) {
		if (readonly) return;
		editingCard = { colIdx, cardIdx };
		const text = columns[colIdx].cards[cardIdx].text;
		editingText = text;

		await tick();

		const cardEl = document.querySelector<HTMLElement>(
			`[data-col-idx="${colIdx}"][data-card-idx="${cardIdx}"]`
		);
		if (!cardEl || !sharedView) return;

		const rect = cardEl.getBoundingClientRect();
		editorPos = { left: rect.left, top: rect.top, width: rect.width };

		sharedView.dispatch({
			changes: { from: 0, to: sharedView.state.doc.length, insert: text },
			selection: { anchor: 0, head: text.length },
		});
		editorVisible = true;
		sharedView.focus();
	}

	function commitEditCard() {
		if (!editingCard) return;
		const raw = editingText;
		const sepMatch = raw.match(/\n---\s*(\n|$)/);
		const card = columns[editingCard.colIdx].cards[editingCard.cardIdx];
		if (sepMatch && sepMatch.index !== undefined) {
			const title = raw.slice(0, sepMatch.index).trim();
			const body = raw.slice(sepMatch.index + sepMatch[0].length).trimEnd();
			if (title) {
				card.text = title;
				card.body = body;
				commit();
			}
		} else {
			const trimmed = raw.trim();
			if (trimmed) {
				card.text = trimmed;
				commit();
			}
		}
		editorVisible = false;
		editingCard = null;
		editingText = '';
	}

	function cancelEditCard() {
		editorVisible = false;
		editingCard = null;
		editingText = '';
	}

	// --- Detail pane ---

	function openPane(colIdx: number, cardIdx: number) {
		if (readonly) return;
		if (editorVisible) cancelEditCard();
		paneCardRef = columns[colIdx].cards[cardIdx];
		paneCard = { colIdx, cardIdx };
	}

	const PANE_AUTO_SAVE_DELAY_MS = 1000;
	const debouncedPaneCommit = debounce(() => commit(), PANE_AUTO_SAVE_DELAY_MS);

	function onPaneChange(updatedTitle: string, updatedBody: string) {
		if (!paneCardRef) return;
		paneCardRef.text = updatedTitle;
		paneCardRef.body = updatedBody;
		debouncedPaneCommit.call();
	}

	function closePane(updatedTitle: string, updatedBody: string) {
		if (!paneCard || !paneCardRef) return;
		debouncedPaneCommit.cancel();
		if (updatedTitle !== paneCardRef.text || updatedBody !== paneCardRef.body) {
			paneCardRef.text = updatedTitle;
			paneCardRef.body = updatedBody;
			commit();
		}
		paneCard = null;
		paneCardRef = null;
	}

	// --- Pointer drag & drop ---

	function onCardPointerDown(e: PointerEvent, colIdx: number, cardIdx: number) {
		if (readonly) return;
		// Skip interactive children
		if ((e.target as HTMLElement).closest('input, button, textarea, a')) return;
		if (e.button !== 0) return;

		const cardEl = e.currentTarget as HTMLElement;
		const rect = cardEl.getBoundingClientRect();
		pendingDrag = {
			colIdx, cardIdx, cardEl,
			startX: e.clientX, startY: e.clientY,
			offsetX: e.clientX - rect.left,
			offsetY: e.clientY - rect.top,
		};
		document.body.style.userSelect = 'none';
	}

	function onCardPointerMove(e: PointerEvent) {
		// Activate drag once movement exceeds threshold
		if (pendingDrag && !dragSrc) {
			const dx = e.clientX - pendingDrag.startX;
			const dy = e.clientY - pendingDrag.startY;
			if (Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD) {
				const { colIdx, cardIdx, cardEl, offsetX, offsetY } = pendingDrag;
				dragOffsetX = offsetX;
				dragOffsetY = offsetY;
				const rect = cardEl.getBoundingClientRect();
				ghostEl = cardEl.cloneNode(true) as HTMLElement;
				ghostEl.style.cssText = [
					'position: fixed',
					`width: ${rect.width}px`,
					`left: ${rect.left}px`,
					`top: ${rect.top}px`,
					'pointer-events: none',
					'z-index: 9999',
					'opacity: 0.85',
					'box-shadow: 0 8px 24px rgba(0,0,0,0.25)',
					'transform: rotate(1.5deg)',
					'border-radius: 6px',
				].join(';');
				document.body.appendChild(ghostEl);
				dragSrc = { colIdx, cardIdx };
				document.body.style.cursor = 'grabbing';
			}
		}

		if (!dragSrc || !ghostEl) return;

		const x = e.clientX - dragOffsetX;
		const y = e.clientY - dragOffsetY;
		ghostEl.style.left = `${x}px`;
		ghostEl.style.top = `${y}px`;

		// Hide ghost to hit-test underneath it
		ghostEl.style.visibility = 'hidden';
		const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
		ghostEl.style.visibility = '';

		if (!el) { dropTarget = null; return; }

		const colEl = el.closest<HTMLElement>('[data-col-idx]');
		if (!colEl) { dropTarget = null; return; }

		const colIdx = parseInt(colEl.dataset.colIdx!);
		const cardEl = el.closest<HTMLElement>('[data-card-idx]');

		if (cardEl) {
			const cardIdx = parseInt(cardEl.dataset.cardIdx!);
			const mid = cardEl.getBoundingClientRect().top + cardEl.getBoundingClientRect().height / 2;
			dropTarget = { colIdx, insertIdx: e.clientY < mid ? cardIdx : cardIdx + 1 };
		} else {
			dropTarget = { colIdx, insertIdx: columns[colIdx]?.cards.length ?? 0 };
		}
	}

	function onCardPointerUp(e: PointerEvent) {
		pendingDrag = null;
		document.body.style.userSelect = '';
		document.body.style.cursor = '';

		if (!dragSrc) return;

		if (ghostEl) {
			document.body.removeChild(ghostEl);
			ghostEl = null;
		}

		if (dropTarget) {
			const { colIdx: srcCol, cardIdx: srcCard } = dragSrc;
			const { colIdx: tgtCol, insertIdx } = dropTarget;

			// Skip no-op (dropped back onto same position)
			const isNoOp = srcCol === tgtCol && (srcCard === insertIdx || srcCard + 1 === insertIdx);
			if (!isNoOp) {
				const card = columns[srcCol].cards.splice(srcCard, 1)[0];
				let idx = insertIdx;
				// Adjust for removed element when same column
				if (srcCol === tgtCol && srcCard < insertIdx) idx -= 1;
				idx = Math.max(0, Math.min(idx, columns[tgtCol].cards.length));
				columns[tgtCol].cards.splice(idx, 0, card);
				commit();
			}
		}

		dragSrc = null;
		dropTarget = null;
	}

	// --- Card actions ---

	function deleteCard(colIdx: number, cardIdx: number) {
		if (readonly) return;
		confirmDeleteCard = { colIdx, cardIdx };
	}

	function confirmCardDelete() {
		if (!confirmDeleteCard) return;
		columns[confirmDeleteCard.colIdx].cards.splice(confirmDeleteCard.cardIdx, 1);
		confirmDeleteCard = null;
		commit();
	}

	// --- Add card ---

	function startAddCard(colIdx: number, position: 'top' | 'bottom' = 'bottom') {
		if (readonly) return;
		addingCard = { colIdx, position };
		newCardText = '';
	}

	function commitAddCard() {
		if (addingCard === null) return;
		const trimmed = newCardText.trim();
		if (trimmed) {
			if (addingCard.position === 'top') {
				columns[addingCard.colIdx].cards.unshift(createCard(trimmed));
			} else {
				columns[addingCard.colIdx].cards.push(createCard(trimmed));
			}
			commit();
		}
		addingCard = null;
		newCardText = '';
	}

	function cancelAddCard() {
		addingCard = null;
		newCardText = '';
	}

	// --- Column actions ---

	function toggleCollapse(colIdx: number) {
		columns[colIdx].collapsed = !columns[colIdx].collapsed;
		commit();
	}

	function deleteColumn(colIdx: number) {
		if (readonly) return;
		confirmDeleteCol = colIdx;
	}

	function confirmColumnDelete() {
		if (confirmDeleteCol === null) return;
		columns.splice(confirmDeleteCol, 1);
		confirmDeleteCol = null;
		commit();
	}

	function startAddColumn() {
		if (readonly) return;
		addingColumn = true;
		newColumnName = '';
	}

	function commitAddColumn() {
		const trimmed = newColumnName.trim();
		if (trimmed) {
			columns.push({ name: trimmed, cards: [], collapsed: false });
			commit();
		}
		addingColumn = false;
		newColumnName = '';
	}

	function cancelAddColumn() {
		addingColumn = false;
		newColumnName = '';
	}

	// --- Raw editor ---

	function handleRawChange(newContent: string) {
		prevContent = newContent;
		onchange(newContent);
		const parsed = parseKanban(newContent);
		columns = parsed.columns;
		frontmatter = parsed.frontmatter;
		format = detectKanbanFormat(newContent);
	}

	// --- Autoresize textarea action (add-card form) ---

	function autoresize(node: HTMLTextAreaElement) {
		const resize = () => {
			node.style.height = 'auto';
			node.style.height = `${node.scrollHeight}px`;
		};
		requestAnimationFrame(resize);
		node.addEventListener('input', resize);
		return { destroy() { node.removeEventListener('input', resize); } };
	}

	// --- Keyboard helpers ---

	function handleNewCardKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') { e.preventDefault(); commitAddCard(); }
		if (e.key === 'Escape') cancelAddCard();
	}

	function handleNewColumnKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') { e.preventDefault(); commitAddColumn(); }
		if (e.key === 'Escape') cancelAddColumn();
	}
</script>

<Modal
	show={confirmDeleteCol !== null}
	title="Delete column"
	message={confirmDeleteCol !== null ? `Delete "${columns[confirmDeleteCol]?.name}" and all its cards?` : ''}
	kind="warning"
	confirmLabel="Delete"
	onconfirm={confirmColumnDelete}
	oncancel={() => { confirmDeleteCol = null; }}
/>

<Modal
	show={confirmDeleteCard !== null}
	title="Delete card"
	message={confirmDeleteCard !== null ? `Delete "${columns[confirmDeleteCard.colIdx]?.cards[confirmDeleteCard.cardIdx]?.text}"?` : ''}
	kind="warning"
	confirmLabel="Delete"
	onconfirm={confirmCardDelete}
	oncancel={() => { confirmDeleteCard = null; }}
/>

<!-- Shared CodeMirror instance for card editing (always mounted, hidden when inactive) -->
<div bind:this={sharedEditorEl}
	class="shared-editor {editorVisible ? 'block' : 'hidden'} fixed z-[1000] bg-(--color-canvas-default) border border-(--color-accent-fg) rounded-[6px] px-2 py-[6px] shadow-[0_4px_16px_rgba(0,0,0,0.18)] box-border min-h-[36px] select-text"
	style:left="{editorPos.left}px"
	style:top="{editorPos.top}px"
	style:width="{editorPos.width}px"
></div>

<!-- Backdrop: commits on outside click -->
{#if editorVisible}
	<div class="fixed inset-0 z-[999]" onpointerdown={commitEditCard} role="presentation"></div>
{/if}

<div class="kanban-board flex flex-col h-full bg-(--color-canvas-default) overflow-hidden [font-family:'Inter',system-ui,-apple-system,BlinkMacSystemFont,'Segoe_UI',sans-serif] select-none">
	{#if rawMode}
		<div class="flex-1 overflow-hidden">
			<CodeMirrorEditor
				value={content}
				{theme}
				{readonly}
				fileType="markdown"
				onchange={handleRawChange}
				editorWidth="720px"
			/>
		</div>
	{:else}
		<div
			class="overflow-x-auto overflow-y-hidden h-full {dragSrc !== null ? 'cursor-grabbing' : ''}"
			role="region"
			aria-label="Kanban board"
			onpointermove={onCardPointerMove}
			onpointerup={onCardPointerUp}
		>
			<div class="inline-flex flex-row min-w-full h-full gap-3 p-6 items-start justify-center box-border">
			{#if !readonly}<div class="w-[280px] shrink-0 pointer-events-none" aria-hidden="true"></div>{/if}
			<div class="flex flex-row gap-3 items-start h-full">
			{#each columns as col, colIdx (col.name + colIdx)}
				<div
					class="w-[280px] shrink-0 bg-(--color-canvas-subtle) border border-(--color-border-default) rounded-[8px] flex flex-col max-h-full"
					data-col-idx={colIdx}
					role="group"
					aria-label={col.name}
				>
					<div class="flex items-center gap-2 px-3 py-[10px] border-b border-(--color-border-default) shrink-0">
						{#if !readonly && !col.collapsed}
							<button
								class="bg-none border-none cursor-pointer text-(--color-fg-muted) text-[14px] px-[5px] py-[2px] rounded-[3px] leading-none hover:bg-(--color-neutral-muted) hover:text-(--color-fg-default)"
								onclick={() => startAddCard(colIdx, 'top')}
								title="Add card to top"
								aria-label="Add card to top"
							>+</button>
						{/if}
						<span class="font-semibold text-[12px] tracking-[0.04em] uppercase text-(--color-fg-muted) flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{col.name}</span>
						<span class="text-[11px] bg-(--color-neutral-muted) text-(--color-fg-muted) rounded-[10px] px-[7px] py-[1px] font-medium">{col.cards.length}</span>
						<div class="flex gap-[2px]">
							<button
								class="bg-none border-none cursor-pointer text-(--color-fg-muted) text-[11px] px-[5px] py-[2px] rounded-[3px] leading-none hover:bg-(--color-neutral-muted) hover:text-(--color-fg-default)"
								onclick={() => toggleCollapse(colIdx)}
								title={col.collapsed ? 'Expand' : 'Collapse'}
								aria-label={col.collapsed ? 'Expand column' : 'Collapse column'}
							>
								{col.collapsed ? '▶' : '▼'}
							</button>
							{#if !readonly}
								<button
									class="bg-none border-none cursor-pointer text-(--color-fg-muted) text-[11px] px-[5px] py-[2px] rounded-[3px] leading-none hover:bg-(--color-neutral-muted) hover:text-[#cf222e]"
									onclick={() => deleteColumn(colIdx)}
									title="Delete column"
									aria-label="Delete column"
								>✕</button>
							{/if}
						</div>
					</div>

					{#if !col.collapsed}
						<div class="p-2 flex flex-col gap-[6px] overflow-y-auto flex-1 min-h-[40px]">
							{#if addingCard?.colIdx === colIdx && addingCard.position === 'top'}
								<div class="bg-(--color-canvas-default) border border-(--color-border-default) rounded-[6px] px-[10px] py-2 flex flex-col">
									<!-- svelte-ignore a11y_autofocus -->
									<textarea
										class="w-full text-[13px] [font-family:inherit] tracking-[-0.01em] leading-[1.45] border border-(--color-accent-fg) rounded-[4px] px-[6px] py-1 bg-(--color-canvas-default) text-(--color-fg-default) resize-none overflow-hidden outline-none box-border"
										use:autoresize
										bind:value={newCardText}
										placeholder="Card title…"
										onkeydown={handleNewCardKeydown}
										onblur={commitAddCard}
										autofocus
										autocomplete="off"
										autocapitalize="off"
										spellcheck="false"
									></textarea>
								</div>
							{/if}
							{#each col.cards as card, cardIdx (card.id)}
								{@const isSrc = dragSrc?.colIdx === colIdx && dragSrc?.cardIdx === cardIdx}
								{@const isEditing = editingCard?.colIdx === colIdx && editingCard?.cardIdx === cardIdx}
								{@const insertBefore = dropTarget?.colIdx === colIdx && dropTarget?.insertIdx === cardIdx}

								{#if insertBefore}
									<div class="h-[3px] rounded-[2px] bg-(--color-accent-fg) mx-[2px] shrink-0"></div>
								{/if}

								<div
									class="kanban-card bg-(--color-canvas-default) border border-(--color-border-default) rounded-[6px] px-[10px] py-2 flex flex-col cursor-grab relative touch-none {isSrc ? 'opacity-35' : ''} {isEditing ? 'invisible' : ''} {dragSrc !== null ? '[&]:cursor-grabbing' : ''}"
									data-col-idx={colIdx}
									data-card-idx={cardIdx}
									role="listitem"
									onpointerdown={(e) => onCardPointerDown(e, colIdx, cardIdx)}
								>
									<div class="flex items-start w-full">
										<!-- eslint-disable-next-line svelte/no-at-html-tags -->
										<span
											class="card-text flex-1 text-(--color-fg-default) leading-[1.45] break-words tracking-[-0.01em]"
											role="button"
											tabindex={readonly ? -1 : 0}
											onclick={handleCardClick}
											onauxclick={handleCardAuxClick}
											ondblclick={() => startEditCard(colIdx, cardIdx)}
											onkeydown={(e) => { if (e.key === 'Enter') startEditCard(colIdx, cardIdx); }}
										>{@html renderCardMarkdown(card.text)}</span>
										{#if !readonly && card.body}
											<button
												class="card-action bg-none border-none cursor-pointer text-(--color-fg-muted) text-[13px] px-1 py-[2px] rounded-[3px] opacity-0 shrink-0 leading-none transition-opacity duration-100 hover:text-(--color-accent-fg) hover:bg-[color-mix(in_srgb,var(--color-accent-fg)_10%,transparent)]"
												onclick={(e) => { e.stopPropagation(); openPane(colIdx, cardIdx); }}
												title="Open details"
												aria-label="Open card details"
											>≡</button>
										{/if}
										{#if !readonly}
											<button
												class="card-action bg-none border-none cursor-pointer text-(--color-fg-muted) text-[11px] px-1 py-[2px] rounded-[3px] opacity-0 shrink-0 leading-none transition-opacity duration-100 hover:text-[#cf222e] hover:bg-[color-mix(in_srgb,#cf222e_10%,transparent)]"
												onclick={() => deleteCard(colIdx, cardIdx)}
												title="Delete card"
												aria-label="Delete card"
											>✕</button>
										{/if}
									</div>
									{#if card.body}
										<button
											class="block w-full mt-1 pt-1 border-t border-(--color-border-default) border-l-0 border-r-0 border-b-0 cursor-pointer text-(--color-fg-muted) text-[11px] text-left leading-[1.4] [font-family:inherit] bg-none whitespace-nowrap overflow-hidden text-ellipsis hover:text-(--color-fg-default)"
											onclick={(e) => { e.stopPropagation(); openPane(colIdx, cardIdx); }}
										>{bodyPreview(card.body)}</button>
									{/if}
								</div>
							{/each}

							{#if dropTarget?.colIdx === colIdx && dropTarget?.insertIdx === col.cards.length}
								<div class="h-[3px] rounded-[2px] bg-(--color-accent-fg) mx-[2px] shrink-0"></div>
							{/if}

							{#if addingCard?.colIdx === colIdx && addingCard.position === 'bottom'}
								<div class="bg-(--color-canvas-default) border border-(--color-border-default) rounded-[6px] px-[10px] py-2 flex flex-col">
									<!-- svelte-ignore a11y_autofocus -->
									<textarea
										class="w-full text-[13px] [font-family:inherit] tracking-[-0.01em] leading-[1.45] border border-(--color-accent-fg) rounded-[4px] px-[6px] py-1 bg-(--color-canvas-default) text-(--color-fg-default) resize-none overflow-hidden outline-none box-border"
										use:autoresize
										bind:value={newCardText}
										placeholder="Card title…"
										onkeydown={handleNewCardKeydown}
										onblur={commitAddCard}
										autofocus
										autocomplete="off"
										autocapitalize="off"
										spellcheck="false"
									></textarea>
								</div>
							{/if}
						</div>

						{#if !readonly}
							<button class="mx-2 mb-2 px-2 py-[6px] bg-none border border-dashed border-(--color-border-default) rounded-[6px] text-(--color-fg-muted) text-[12px] cursor-pointer text-left transition-[background,color] duration-100 shrink-0 hover:bg-(--color-neutral-muted) hover:text-(--color-fg-default)" onclick={() => startAddCard(colIdx, 'bottom')}>
								+ Add card
							</button>
						{/if}
					{/if}
				</div>
			{/each}
			</div>

			{#if !readonly}
				<div class="w-[280px] shrink-0 flex flex-col bg-none border border-dashed border-(--color-border-default) rounded-[8px] min-h-[60px] items-stretch">
					{#if addingColumn}
						<div class="flex items-center gap-2 px-3 py-[10px] shrink-0">
							<!-- svelte-ignore a11y_autofocus -->
							<input
								class="flex-1 text-[13px] font-semibold [font-family:inherit] border border-(--color-accent-fg) rounded-[4px] px-[6px] py-[2px] bg-(--color-canvas-default) text-(--color-fg-default) outline-none min-w-0"
								bind:value={newColumnName}
								placeholder="Column name…"
								onkeydown={handleNewColumnKeydown}
								onblur={commitAddColumn}
								autofocus
								autocomplete="off"
								autocapitalize="off"
								spellcheck="false"
							/>
						</div>
					{:else}
						<button class="bg-none border-none cursor-pointer text-(--color-fg-muted) text-[13px] p-4 text-left w-full hover:text-(--color-fg-default)" onclick={startAddColumn}>
							+ Add column
						</button>
					{/if}
				</div>
			{/if}
			</div>
		</div>
	{/if}
</div>

{#if paneCard !== null}
	<CardDetailPane
		card={columns[paneCard.colIdx].cards[paneCard.cardIdx]}
		{theme}
		{readonly}
		{fileIndex}
		onclose={closePane}
		onchange={onPaneChange}
	/>
{/if}

<style>
	/* Allow text selection inside textarea/input */
	.kanban-board :global(textarea),
	.kanban-board :global(input) {
		-webkit-user-select: text;
		user-select: text;
	}

	/* Non-standard font weights not expressible as Tailwind utilities */
	.card-text {
		font-size: 13px;
		font-weight: 450;
	}

	.card-text :global(strong) { font-weight: 650; }
	.card-text :global(em) { font-style: italic; }
	.card-text :global(del),
	.card-text :global(s) { text-decoration: line-through; }
	.card-text :global(code) {
		font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
		font-size: 11px;
		background: var(--color-neutral-muted);
		padding: 1px 4px;
		border-radius: 3px;
	}
	.card-text :global(a) {
		color: var(--color-accent-fg);
		text-decoration: none;
		cursor: pointer;
	}
	.card-text :global(a:hover) {
		text-decoration: underline;
	}
	.card-text :global(a.wiki-link) {
		border-bottom: 1px dashed var(--color-accent-fg);
	}
	.card-text :global(a.wiki-link:hover) {
		border-bottom-style: solid;
	}

	/* Show action buttons on card hover */
	.kanban-card:hover .card-action {
		opacity: 1;
	}

	/* Shared CodeMirror card editor */
	.shared-editor :global(.cm-editor) {
		outline: none;
	}

	.shared-editor :global(.cm-scroller) {
		padding: 0;
		max-height: 180px;
		overflow-y: auto;
	}

	.shared-editor :global(.cm-content) {
		font-size: 13px;
		font-weight: 450;
		font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
		letter-spacing: -0.01em;
		line-height: 1.45;
		padding: 0;
		min-height: 20px;
	}

	.shared-editor :global(.cm-line) {
		padding: 0;
	}
</style>
