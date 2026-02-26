<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import { parseKanban, serializeKanban, detectKanbanFormat, createCard, type KanbanColumn, type KanbanFormat } from '$lib/utils/kanban.js';
	import { serializeMarkoKanban, upgradeToMarko } from '$lib/utils/markoKanban.js';
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
	}: {
		content: string;
		onchange: (s: string) => void;
		readonly?: boolean;
		theme?: 'system' | 'dark' | 'light';
		rawMode?: boolean;
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

	// Add card state per column
	let addingCard = $state<number | null>(null);
	let newCardText = $state('');

	// Inline card editing
	let editingCard = $state<{ colIdx: number; cardIdx: number } | null>(null);
	let editingText = '';

	// Detail pane
	let paneCard = $state<{ colIdx: number; cardIdx: number } | null>(null);

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

	function renderCardMarkdown(text: string): string {
		const html = parseInline(text) as string;
		return DOMPurify.sanitize(html, {
			ALLOWED_TAGS: ['strong', 'em', 'code', 'del', 's', 'a', 'br'],
		});
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
		paneCard = { colIdx, cardIdx };
	}

	function closePane(updatedTitle: string, updatedBody: string) {
		if (!paneCard) return;
		const card = columns[paneCard.colIdx].cards[paneCard.cardIdx];
		if (updatedTitle !== card.text || updatedBody !== card.body) {
			card.text = updatedTitle;
			card.body = updatedBody;
			commit();
		}
		paneCard = null;
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

	function startAddCard(colIdx: number) {
		if (readonly) return;
		addingCard = colIdx;
		newCardText = '';
	}

	function commitAddCard() {
		if (addingCard === null) return;
		const trimmed = newCardText.trim();
		if (trimmed) {
			columns[addingCard].cards.push(createCard(trimmed));
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
<div bind:this={sharedEditorEl} class="shared-card-editor" class:visible={editorVisible}
	style:left="{editorPos.left}px"
	style:top="{editorPos.top}px"
	style:width="{editorPos.width}px"
></div>

<!-- Backdrop: commits on outside click -->
{#if editorVisible}
	<div class="editor-backdrop" onpointerdown={commitEditCard} role="presentation"></div>
{/if}

<div class="kanban-wrapper">
	{#if rawMode}
		<div class="raw-editor">
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
			class="board"
			class:dragging-active={dragSrc !== null}
			role="region"
			aria-label="Kanban board"
			onpointermove={onCardPointerMove}
			onpointerup={onCardPointerUp}
		>
			<div class="board-inner">
			{#if !readonly}<div class="add-column-spacer" aria-hidden="true"></div>{/if}
			<div class="columns-group">
			{#each columns as col, colIdx (col.name + colIdx)}
				<div
					class="column"
					data-col-idx={colIdx}
					role="group"
					aria-label={col.name}
				>
					<div class="column-header">
						<span class="column-name">{col.name}</span>
						<span class="card-count">{col.cards.length}</span>
						<div class="column-actions">
							<button
								class="icon-btn"
								onclick={() => toggleCollapse(colIdx)}
								title={col.collapsed ? 'Expand' : 'Collapse'}
								aria-label={col.collapsed ? 'Expand column' : 'Collapse column'}
							>
								{col.collapsed ? '▶' : '▼'}
							</button>
							{#if !readonly}
								<button
									class="icon-btn delete-col"
									onclick={() => deleteColumn(colIdx)}
									title="Delete column"
									aria-label="Delete column"
								>✕</button>
							{/if}
						</div>
					</div>

					{#if !col.collapsed}
						<div class="cards">
							{#each col.cards as card, cardIdx (card.id)}
								{@const isSrc = dragSrc?.colIdx === colIdx && dragSrc?.cardIdx === cardIdx}
								{@const isEditing = editingCard?.colIdx === colIdx && editingCard?.cardIdx === cardIdx}
								{@const insertBefore = dropTarget?.colIdx === colIdx && dropTarget?.insertIdx === cardIdx}

								{#if insertBefore}
									<div class="drop-line"></div>
								{/if}

								<div
									class="card"
									class:is-src={isSrc}
									class:is-editing={isEditing}
									data-col-idx={colIdx}
									data-card-idx={cardIdx}
									role="listitem"
									onpointerdown={(e) => onCardPointerDown(e, colIdx, cardIdx)}
								>
									<div class="card-main">
										<!-- eslint-disable-next-line svelte/no-at-html-tags -->
										<span
											class="card-text"
											role="button"
											tabindex={readonly ? -1 : 0}
											ondblclick={() => startEditCard(colIdx, cardIdx)}
											onkeydown={(e) => { if (e.key === 'Enter') startEditCard(colIdx, cardIdx); }}
										>{@html renderCardMarkdown(card.text)}</span>
										{#if !readonly && card.body}
											<button
												class="card-expand"
												onclick={(e) => { e.stopPropagation(); openPane(colIdx, cardIdx); }}
												title="Open details"
												aria-label="Open card details"
											>≡</button>
										{/if}
										{#if !readonly}
											<button
												class="card-delete"
												onclick={() => deleteCard(colIdx, cardIdx)}
												title="Delete card"
												aria-label="Delete card"
											>✕</button>
										{/if}
									</div>
									{#if card.body}
										<button
											class="card-footer"
											onclick={(e) => { e.stopPropagation(); openPane(colIdx, cardIdx); }}
										>{bodyPreview(card.body)}</button>
									{/if}
								</div>
							{/each}

							{#if dropTarget?.colIdx === colIdx && dropTarget?.insertIdx === col.cards.length}
								<div class="drop-line"></div>
							{/if}

							{#if addingCard === colIdx}
								<div class="card add-card-form">
									<!-- svelte-ignore a11y_autofocus -->
									<textarea
										class="card-edit-input"
										use:autoresize
										bind:value={newCardText}
										placeholder="Card title…"
										onkeydown={handleNewCardKeydown}
										onblur={commitAddCard}
										autofocus
										autocomplete="off"
										autocorrect="off"
										autocapitalize="off"
										spellcheck="false"
									></textarea>
								</div>
							{/if}
						</div>

						{#if !readonly}
							<button class="add-card-btn" onclick={() => startAddCard(colIdx)}>
								+ Add card
							</button>
						{/if}
					{/if}
				</div>
			{/each}
			</div>

			{#if !readonly}
				<div class="column add-column">
					{#if addingColumn}
						<div class="column-header">
							<!-- svelte-ignore a11y_autofocus -->
							<input
								class="column-name-input"
								bind:value={newColumnName}
								placeholder="Column name…"
								onkeydown={handleNewColumnKeydown}
								onblur={commitAddColumn}
								autofocus
								autocomplete="off"
								autocorrect="off"
								autocapitalize="off"
								spellcheck="false"
							/>
						</div>
					{:else}
						<button class="add-column-btn" onclick={startAddColumn}>
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
		onclose={closePane}
	/>
{/if}

<style>
	.kanban-wrapper {
		display: flex;
		flex-direction: column;
		height: 100%;
		background: var(--color-canvas-default);
		overflow: hidden;
		font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
		-webkit-user-select: none;
		user-select: none;
	}

	.kanban-wrapper :global(textarea),
	.kanban-wrapper :global(input) {
		-webkit-user-select: text;
		user-select: text;
	}

	.raw-editor {
		flex: 1;
		overflow: hidden;
	}

	.board {
		overflow-x: auto;
		overflow-y: hidden;
		height: 100%;
	}

	.board-inner {
		display: inline-flex;
		flex-direction: row;
		min-width: 100%;
		height: 100%;
		gap: 0.75rem;
		padding: 1.5rem;
		align-items: flex-start;
		justify-content: center;
		box-sizing: border-box;
	}

	/* Invisible counterweight so the add-column doesn't shift the center */
	.add-column-spacer {
		width: 280px;
		flex-shrink: 0;
		pointer-events: none;
	}

	.columns-group {
		display: flex;
		flex-direction: row;
		gap: 0.75rem;
		align-items: flex-start;
		height: 100%;
	}

	.board.dragging-active {
		cursor: grabbing;
	}

	.column {
		width: 280px;
		flex-shrink: 0;
		background: var(--color-canvas-subtle);
		border: 1px solid var(--color-border-default);
		border-radius: 8px;
		display: flex;
		flex-direction: column;
		max-height: 100%;
	}

	.column-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 0.75rem;
		border-bottom: 1px solid var(--color-border-default);
		flex-shrink: 0;
	}

	.column-name {
		font-weight: 600;
		font-size: 12px;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--color-fg-muted);
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.card-count {
		font-size: 11px;
		background: var(--color-neutral-muted);
		color: var(--color-fg-muted);
		border-radius: 10px;
		padding: 1px 7px;
		font-weight: 500;
	}

	.column-actions {
		display: flex;
		gap: 2px;
	}

	.icon-btn {
		background: none;
		border: none;
		cursor: pointer;
		color: var(--color-fg-muted);
		font-size: 11px;
		padding: 2px 5px;
		border-radius: 3px;
		line-height: 1;
	}

	.icon-btn:hover {
		background: var(--color-neutral-muted);
		color: var(--color-fg-default);
	}

	.delete-col:hover {
		color: #cf222e;
	}

	.cards {
		padding: 0.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		overflow-y: auto;
		flex: 1;
		min-height: 40px;
	}

	.card {
		background: var(--color-canvas-default);
		border: 1px solid var(--color-border-default);
		border-radius: 6px;
		padding: 0.5rem 0.625rem;
		display: flex;
		flex-direction: column;
		cursor: grab;
		position: relative;
		touch-action: none;
	}

	.card-main {
		display: flex;
		align-items: flex-start;
		width: 100%;
	}

	.card-footer {
		display: block;
		width: 100%;
		margin-top: 0.25rem;
		padding-top: 0.25rem;
		border-top: 1px solid var(--color-border-default);
		background: none;
		border-left: none;
		border-right: none;
		border-bottom: none;
		cursor: pointer;
		color: var(--color-fg-muted);
		font-size: 11px;
		text-align: left;
		line-height: 1.4;
		font-family: inherit;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.card-footer:hover {
		color: var(--color-fg-default);
	}

	.card-expand {
		background: none;
		border: none;
		cursor: pointer;
		color: var(--color-fg-muted);
		font-size: 13px;
		padding: 2px 4px;
		border-radius: 3px;
		opacity: 0;
		flex-shrink: 0;
		line-height: 1;
		transition: opacity 0.1s;
	}

	.card:hover .card-expand {
		opacity: 1;
	}

	.card-expand:hover {
		color: var(--color-accent-fg);
		background: color-mix(in srgb, var(--color-accent-fg) 10%, transparent);
	}

	.board.dragging-active .card {
		cursor: grabbing;
	}

	.card.is-src {
		opacity: 0.35;
	}

	/* Hide card content while shared editor overlays it */
	.card.is-editing {
		visibility: hidden;
	}

	.drop-line {
		height: 3px;
		border-radius: 2px;
		background: var(--color-accent-fg);
		margin: 0 2px;
		flex-shrink: 0;
	}

	.card-text {
		font-size: 13px;
		font-weight: 450;
		color: var(--color-fg-default);
		line-height: 1.45;
		word-break: break-word;
		letter-spacing: -0.01em;
		flex: 1;
	}

	/* Markdown rendered inside cards */
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
	}
	.card-text :global(a:hover) {
		text-decoration: underline;
	}

	.card-delete {
		background: none;
		border: none;
		cursor: pointer;
		color: var(--color-fg-muted);
		font-size: 11px;
		padding: 2px 4px;
		border-radius: 3px;
		opacity: 0;
		flex-shrink: 0;
		line-height: 1;
		transition: opacity 0.1s;
	}

	.card:hover .card-delete {
		opacity: 1;
	}

	.card-delete:hover {
		color: #cf222e;
		background: color-mix(in srgb, #cf222e 10%, transparent);
	}

	/* Shared CodeMirror card editor */
	.shared-card-editor {
		display: none;
		position: fixed;
		z-index: 1000;
		background: var(--color-canvas-default);
		border: 1px solid var(--color-accent-fg);
		border-radius: 6px;
		padding: 0.375rem 0.5rem;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
		box-sizing: border-box;
		min-height: 36px;
		-webkit-user-select: text;
		user-select: text;
	}

	.shared-card-editor.visible {
		display: block;
	}

	.shared-card-editor :global(.cm-editor) {
		outline: none;
	}

	.shared-card-editor :global(.cm-scroller) {
		padding: 0;
		max-height: 180px;
		overflow-y: auto;
	}

	.shared-card-editor :global(.cm-content) {
		font-size: 13px;
		font-weight: 450;
		font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
		letter-spacing: -0.01em;
		line-height: 1.45;
		padding: 0;
		min-height: 20px;
	}

	.shared-card-editor :global(.cm-line) {
		padding: 0;
	}

	/* Backdrop to catch outside-click commits */
	.editor-backdrop {
		position: fixed;
		inset: 0;
		z-index: 999;
	}

	.card-edit-input {
		width: 100%;
		font-size: 13px;
		font-weight: 450;
		font-family: inherit;
		letter-spacing: -0.01em;
		line-height: 1.45;
		border: 1px solid var(--color-accent-fg);
		border-radius: 4px;
		padding: 4px 6px;
		background: var(--color-canvas-default);
		color: var(--color-fg-default);
		resize: none;
		overflow: hidden;
		outline: none;
		box-sizing: border-box;
	}

	.add-card-btn {
		margin: 0 0.5rem 0.5rem;
		padding: 0.375rem 0.5rem;
		background: none;
		border: 1px dashed var(--color-border-default);
		border-radius: 6px;
		color: var(--color-fg-muted);
		font-size: 12px;
		cursor: pointer;
		text-align: left;
		transition: background 0.1s, color 0.1s;
		flex-shrink: 0;
	}

	.add-card-btn:hover {
		background: var(--color-neutral-muted);
		color: var(--color-fg-default);
	}

	.add-column {
		background: none;
		border: 1px dashed var(--color-border-default);
		min-height: 60px;
		align-items: stretch;
	}

	.add-column-btn {
		background: none;
		border: none;
		cursor: pointer;
		color: var(--color-fg-muted);
		font-size: 13px;
		padding: 1rem;
		text-align: left;
		width: 100%;
	}

	.add-column-btn:hover {
		color: var(--color-fg-default);
	}

	.column-name-input {
		flex: 1;
		font-size: 13px;
		font-weight: 600;
		font-family: inherit;
		border: 1px solid var(--color-accent-fg);
		border-radius: 4px;
		padding: 2px 6px;
		background: var(--color-canvas-default);
		color: var(--color-fg-default);
		outline: none;
		min-width: 0;
	}
</style>
