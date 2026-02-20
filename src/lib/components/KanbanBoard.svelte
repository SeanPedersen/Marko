<script lang="ts">
	import { parseKanban, serializeKanban, type KanbanColumn } from '$lib/utils/kanban.js';
	import CodeMirrorEditor from './CodeMirrorEditor.svelte';
	import Modal from './Modal.svelte';

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

	// Add card state per column
	let addingCard = $state<number | null>(null);
	let newCardText = $state('');

	// Inline card editing
	let editingCard = $state<{ colIdx: number; cardIdx: number } | null>(null);
	let editingText = $state('');

	// Add column state
	let addingColumn = $state(false);
	let newColumnName = $state('');

	// Parse content whenever it changes externally (but not when rawMode is active)
	let prevContent = '';
	$effect(() => {
		if (content !== prevContent && !rawMode) {
			const parsed = parseKanban(content);
			columns = parsed.columns;
			frontmatter = parsed.frontmatter;
			prevContent = content;
		}
	});

	function commit() {
		const serialized = serializeKanban(columns, frontmatter);
		prevContent = serialized;
		onchange(serialized);
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

	// --- Card editing ---

	function deleteCard(colIdx: number, cardIdx: number) {
		if (readonly) return;
		columns[colIdx].cards.splice(cardIdx, 1);
		commit();
	}

	function startEditCard(colIdx: number, cardIdx: number) {
		if (readonly) return;
		editingCard = { colIdx, cardIdx };
		editingText = columns[colIdx].cards[cardIdx].text;
	}

	function commitEditCard() {
		if (!editingCard) return;
		const trimmed = editingText.trim();
		if (trimmed) {
			columns[editingCard.colIdx].cards[editingCard.cardIdx].text = trimmed;
			commit();
		}
		editingCard = null;
		editingText = '';
	}

	function cancelEditCard() {
		editingCard = null;
		editingText = '';
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
			columns[addingCard].cards.push({ id: crypto.randomUUID(), text: trimmed, checked: false });
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
	}

	// --- Autoresize textarea action ---

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

	function handleCardKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') { e.preventDefault(); commitEditCard(); }
		if (e.key === 'Escape') cancelEditCard();
	}

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
	onconfirm={confirmColumnDelete}
	oncancel={() => { confirmDeleteCol = null; }}
/>

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
			{#each columns as col, colIdx (col.name + colIdx)}
				<div
					class="column"
					data-col-idx={colIdx}
					role="group"
					aria-label={col.name}
				>
					<div class="column-header">
						<span class="column-name">{col.name}</span>
						{#if !col.collapsed}
							<span class="card-count">{col.cards.length}</span>
						{/if}
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
								{@const insertBefore = dropTarget?.colIdx === colIdx && dropTarget?.insertIdx === cardIdx}

								{#if insertBefore}
									<div class="drop-line"></div>
								{/if}

								<div
									class="card"
									class:is-src={isSrc}
									data-col-idx={colIdx}
									data-card-idx={cardIdx}
									role="listitem"
									onpointerdown={(e) => onCardPointerDown(e, colIdx, cardIdx)}
								>
									{#if editingCard?.colIdx === colIdx && editingCard?.cardIdx === cardIdx}
										<!-- svelte-ignore a11y_autofocus -->
										<textarea
											class="card-edit-input"
											use:autoresize
											bind:value={editingText}
											onkeydown={handleCardKeydown}
											onblur={commitEditCard}
											autofocus
										></textarea>
									{:else}
										<span
											class="card-text"
											role="button"
											tabindex={readonly ? -1 : 0}
											ondblclick={() => startEditCard(colIdx, cardIdx)}
											onkeydown={(e) => { if (e.key === 'Enter') startEditCard(colIdx, cardIdx); }}
										>{card.text}</span>
										{#if !readonly}
											<button
												class="card-delete"
												onclick={() => deleteCard(colIdx, cardIdx)}
												title="Delete card"
												aria-label="Delete card"
											>✕</button>
										{/if}
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
	{/if}
</div>

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
		display: flex;
		flex-direction: row;
		gap: 0.75rem;
		padding: 1.5rem;
		overflow-x: auto;
		overflow-y: hidden;
		height: 100%;
		align-items: flex-start;
		box-sizing: border-box;
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
		align-items: flex-start;
		cursor: grab;
		position: relative;
		touch-action: none;
	}

	.board.dragging-active .card {
		cursor: grabbing;
	}

	.card.is-src {
		opacity: 0.35;
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
