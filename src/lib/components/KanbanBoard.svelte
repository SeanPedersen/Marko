<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import { parseKanban, serializeKanban, detectKanbanFormat, createCard, type KanbanCard, type KanbanColumn, type KanbanFormat } from '$lib/utils/kanban.js';
	import { serializeMarkoKanban, upgradeToMarko } from '$lib/utils/markoKanban.js';
	import { debounce } from '$lib/utils/debounce.js';
	import type { FileIndex } from '$lib/utils/wikiLinks';
	import CodeMirrorEditor from './CodeMirrorEditor.svelte';
	import CardDetailPane from './CardDetailPane.svelte';
	import Modal from './Modal.svelte';
	import { parseInline, Marked, type Token } from 'marked';
	import DOMPurify from 'dompurify';
	import { EditorView, keymap, drawSelection } from '@codemirror/view';
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
		zoomLevel = 100,
	}: {
		content: string;
		onchange: (s: string) => void;
		readonly?: boolean;
		theme?: 'system' | 'dark' | 'light';
		rawMode?: boolean;
		fileIndex?: FileIndex;
		zoomLevel?: number;
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

	// True once a pointer gesture became an actual drag (movement past the
	// threshold). Suppresses the edit trigger on the click that follows a drag.
	let didDrag = false;

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
	let backdropEl: HTMLDivElement | undefined = $state();
	let sharedView: EditorView | null = null;
	let editorPos = $state({
		left: 0, top: 0, width: 280, height: 36, zoom: 1,
		clip: { top: 0, right: 0, bottom: 0, left: 0 },
	});
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

	function handleCardClick(e: MouseEvent, colIdx: number, cardIdx: number) {
		const link = (e.target as HTMLElement).closest<HTMLAnchorElement>('a.wiki-link');
		if (link) {
			e.preventDefault();
			e.stopPropagation();
			const target = link.dataset.target;
			if (!target) return;
			const newTab = e.ctrlKey || e.metaKey || e.button === 1;
			document.dispatchEvent(new CustomEvent('marko:wiki-link', { detail: { target, newTab } }));
			return;
		}
		if (didDrag) return;
		startEditCard(colIdx, cardIdx, e.clientX, e.clientY);
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

	// The card editor popup and its backdrop must render outside the
	// zoomed content wrapper (MarkdownViewer's `zoom: {zoomLevel/100}`
	// container). WebKitGTK (Linux) re-applies an ancestor's CSS `zoom` to
	// the left/top/transform of `position: fixed` descendants, even though
	// getBoundingClientRect() already returns true, post-zoom viewport
	// pixels — so a fixed popup positioned from that rect and left inside
	// the zoomed subtree ends up double-scaled away from the card. Portaling
	// to <body> removes the zoomed ancestor from the chain entirely.
	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return { destroy() { node.remove(); } };
	}

	// Cumulative `zoom` of an element's ancestors (e.g. MarkdownViewer's
	// content-zoom wrapper), so the portaled popup can re-apply it and match
	// the card's rendered font/padding size once it's outside that ancestor.
	function getAncestorZoom(el: HTMLElement): number {
		let zoom = 1;
		for (let node = el.parentElement; node; node = node.parentElement) {
			const z = parseFloat(getComputedStyle(node).zoom);
			if (!Number.isNaN(z)) zoom *= z;
		}
		return zoom;
	}

	// The popup and its full-viewport backdrop (needed to catch outside
	// clicks that commit the edit) both sit above the board in paint order,
	// so a wheel event over either one never reaches the column/board
	// scroll containers underneath. Forward it manually to whichever is
	// under the pointer, unless the pointer is over the CodeMirror content
	// itself and its own internal scroller can still consume the scroll.
	function forwardWheelToBoard(e: WheelEvent) {
		const scroller = (e.target as HTMLElement)?.closest?.<HTMLElement>('.cm-scroller');
		if (scroller) {
			const atTop = scroller.scrollTop <= 0;
			const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
			if ((e.deltaY < 0 && !atTop) || (e.deltaY > 0 && !atBottom)) return;
		}

		const prevPopupPointerEvents = sharedEditorEl.style.pointerEvents;
		const prevBackdropPointerEvents = backdropEl?.style.pointerEvents;
		sharedEditorEl.style.pointerEvents = 'none';
		if (backdropEl) backdropEl.style.pointerEvents = 'none';
		const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
		sharedEditorEl.style.pointerEvents = prevPopupPointerEvents;
		if (backdropEl) backdropEl.style.pointerEvents = prevBackdropPointerEvents ?? '';

		const vScroll = el?.closest<HTMLElement>('.overflow-y-auto');
		const hScroll = el?.closest<HTMLElement>('.overflow-x-auto');
		if (!vScroll && !hScroll) return;

		e.preventDefault();
		if (vScroll) vScroll.scrollTop += e.deltaY;
		if (hScroll) hScroll.scrollLeft += e.deltaX;
	}

	// Scrolling a column moves the (invisible) card being edited, but the
	// popup is `position: fixed` at a snapshot of its old screen position —
	// re-sync on every scroll anywhere (wheel, scrollbar drag, keyboard) so
	// it stays glued to the card instead of appearing stuck in place.
	function handleAnyScroll() {
		if (!editorVisible || !editingCard) return;
		const cardEl = findCardEl(editingCard.colIdx, editingCard.cardIdx);
		if (cardEl) syncEditorPosition(cardEl);
	}

	onMount(() => {
		initSharedEditor();
		document.addEventListener('scroll', handleAnyScroll, true);
	});

	onDestroy(() => {
		document.removeEventListener('scroll', handleAnyScroll, true);
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
				drawSelection(),
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

	// getBoundingClientRect() already returns true viewport pixels (it
	// accounts for the MarkdownViewer zoom wrapper's `zoom` CSS), but the
	// popup is portaled to <body> (see `portal` above) and so no longer
	// inherits that zoom — without it, its font/padding would render at
	// 1x while the card's render at the zoomed size. Reapplying the same
	// `zoom` directly on the popup fixes the font, but then also rescales
	// the popup's own left/top/width/height by that factor (verified: a
	// self-zoomed fixed element's transform and box are multiplied by its
	// zoom too), so those are pre-divided here to cancel it back out. Left
	// unrounded: rounding before the zoom re-multiplies it introduces up to
	// half a zoomed pixel of drift from the card's true edge — invisible
	// most of the time, but noticeable once focus draws the eye to the
	// border/caret.
	function syncEditorPosition(cardEl: HTMLElement) {
		const rect = cardEl.getBoundingClientRect();
		const zoom = getAncestorZoom(cardEl);
		editorPos = {
			left: rect.left / zoom,
			top: rect.top / zoom,
			width: rect.width / zoom,
			height: rect.height / zoom,
			zoom,
			clip: computeEditorClip(cardEl, rect, zoom),
		};
	}

	// The popup is portaled to <body> (see `portal` above), so it no longer
	// gets clipped by the column's `overflow-y-auto` (or the board's
	// `overflow-x-auto`) the way the real card would when scrolled out of
	// view — it would otherwise render on top of the column header/board
	// edge instead of disappearing behind it. `clip-path: inset()` restores
	// that by cutting the popup to the intersection of those containers'
	// (unmoving) viewport bounds, same as the browser would for the card.
	function computeEditorClip(cardEl: HTMLElement, rect: DOMRect, zoom: number) {
		const column = cardEl.closest<HTMLElement>('.overflow-y-auto');
		const board = cardEl.closest<HTMLElement>('.overflow-x-auto');
		const bounds = [column, board].filter((el) => el !== null).map((el) => el.getBoundingClientRect());
		if (bounds.length === 0) return { top: 0, right: 0, bottom: 0, left: 0 };

		const visTop = Math.max(...bounds.map((b) => b.top));
		const visBottom = Math.min(...bounds.map((b) => b.bottom));
		const visLeft = Math.max(...bounds.map((b) => b.left));
		const visRight = Math.min(...bounds.map((b) => b.right));

		return {
			top: Math.max(0, visTop - rect.top) / zoom,
			right: Math.max(0, rect.right - visRight) / zoom,
			bottom: Math.max(0, rect.bottom - visBottom) / zoom,
			left: Math.max(0, visLeft - rect.left) / zoom,
		};
	}

	function findCardEl(colIdx: number, cardIdx: number): HTMLElement | null {
		return document.querySelector<HTMLElement>(
			`[data-col-idx="${colIdx}"][data-card-idx="${cardIdx}"]`
		);
	}

	// Re-measure the card whenever the content zoom changes while the popup
	// is open, otherwise a stale editorPos (captured at the old zoom) drifts
	// off the card as soon as the user zooms in/out mid-edit.
	$effect(() => {
		void zoomLevel;
		if (!editorVisible || !editingCard) return;
		const cardEl = findCardEl(editingCard.colIdx, editingCard.cardIdx);
		if (cardEl) syncEditorPosition(cardEl);
	});

	async function startEditCard(colIdx: number, cardIdx: number, clickX?: number, clickY?: number) {
		if (readonly) return;
		editingCard = { colIdx, cardIdx };
		const text = columns[colIdx].cards[cardIdx].text;
		editingText = text;

		await tick();

		const cardEl = findCardEl(colIdx, cardIdx);
		if (!cardEl || !sharedView) return;

		syncEditorPosition(cardEl);

		sharedView.dispatch({
			changes: { from: 0, to: sharedView.state.doc.length, insert: text },
		});
		editorVisible = true;

		// Wait for the popup to become visible and lay out before measuring or
		// focusing. CodeMirror's focus() is a no-op while the element is hidden.
		await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

		// Place the caret where the click landed. Compute the position BEFORE
		// focus so the cursor never flashes at position 0.
		let caret = text.length;
		if (clickX !== undefined && clickY !== undefined) {
			let pos = sharedView.posAtCoords({ x: clickX, y: clickY });
			if (pos === null) {
				await new Promise((r) => requestAnimationFrame(r));
				pos = sharedView.posAtCoords({ x: clickX, y: clickY });
			}
			if (pos !== null) caret = Math.min(pos, text.length);
		}
		sharedView.dispatch({
			selection: { anchor: caret, head: caret },
			scrollIntoView: true,
		});
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

		didDrag = false;
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
				didDrag = true;
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

		const colEl = el.closest<HTMLElement>('[data-col-idx]:not([data-card-idx])');
		if (!colEl) { dropTarget = null; return; }

		const colIdx = parseInt(colEl.dataset.colIdx!);
		const cardEls = colEl.querySelectorAll<HTMLElement>('[data-card-idx]');

		let insertIdx = cardEls.length;
		for (let i = 0; i < cardEls.length; i++) {
			const rect = cardEls[i].getBoundingClientRect();
			if (e.clientY < rect.top + rect.height / 2) {
				insertIdx = i;
				break;
			}
		}
		dropTarget = { colIdx, insertIdx };
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
<div bind:this={sharedEditorEl} use:portal
	class="shared-editor {editorVisible ? 'block' : 'hidden'} fixed left-0 top-0 z-[1000] bg-(--color-canvas-default) border border-(--color-border-default) rounded-[6px] px-[10px] py-2 shadow-[0_4px_16px_rgba(0,0,0,0.18)] box-border select-text will-change-transform"
	style:transform="translate({editorPos.left}px, {editorPos.top}px)"
	style:width="{editorPos.width}px"
	style:height="{editorPos.height}px"
	style:zoom={editorPos.zoom}
	style:clip-path="inset({editorPos.clip.top}px {editorPos.clip.right}px {editorPos.clip.bottom}px {editorPos.clip.left}px)"
	onwheel={forwardWheelToBoard}
></div>

<!-- Backdrop: commits on outside click -->
{#if editorVisible}
	<div
		bind:this={backdropEl}
		use:portal
		class="fixed inset-0 z-[999]"
		role="presentation"
		onwheel={forwardWheelToBoard}
		onpointerdown={(e) => {
			// Check if the click is on a kanban card underneath the backdrop
			const elements = document.elementsFromPoint(e.clientX, e.clientY);
			for (const el of elements) {
				const card = (el as HTMLElement).closest?.<HTMLElement>('.kanban-card');
				if (card) {
					const colIdx = parseInt(card.dataset.colIdx ?? '');
					const cardIdx = parseInt(card.dataset.cardIdx ?? '');
					if (!isNaN(colIdx) && !isNaN(cardIdx)) {
						commitEditCard();
						startEditCard(colIdx, cardIdx, e.clientX, e.clientY);
						return;
					}
				}
			}
			commitEditCard();
		}}
	></div>
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
											onclick={(e) => handleCardClick(e, colIdx, cardIdx)}
											onauxclick={handleCardAuxClick}
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
		height: 100%;
		outline: none;
	}

	.shared-editor :global(.cm-scroller) {
		padding: 0;
		max-height: 180px;
		overflow-y: auto;
		scrollbar-gutter: stable;
	}

	.shared-editor :global(.cm-content) {
		font-size: 13px;
		font-weight: 450;
		font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
		letter-spacing: -0.01em;
		line-height: 1.45;
		padding: 0;
	}

	.shared-editor :global(.cm-line) {
		padding: 0;
	}

	.shared-editor :global(.cm-cursor) {
		margin-left: 0;
		border-left-width: 2px;
	}
</style>
