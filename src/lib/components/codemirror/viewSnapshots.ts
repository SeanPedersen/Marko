/**
 * Caret and scroll position of every document the editor has hosted, keyed by
 * document id.
 *
 * The store lives here rather than inside CodeMirrorEditor because the editor
 * component is torn down whenever a tab needs a different view — a kanban
 * board, a mermaid diagram, an HTML preview. A per-instance map would take
 * every tab's remembered position down with it, so returning to a markdown tab
 * would land at the top of the document.
 */

export interface ViewSnapshot {
	anchor: number;
	head: number;
	scrollTop: number;
}

// Bounded so a long session cannot grow the store without limit. Insertion
// order is write order, so the front of the map is the least recently used.
const MAX_SNAPSHOTS = 100;

const snapshots = new Map<string, ViewSnapshot>();

// Key for an editor that has no document identity of its own, so its snapshot
// cannot collide with another anonymous editor's.
let anonymousCount = 0;
export function nextAnonymousDocId(): string {
	return `anonymous:${++anonymousCount}`;
}

export function readSnapshot(id: string): ViewSnapshot | undefined {
	return snapshots.get(id);
}

export function writeSnapshot(id: string, snapshot: ViewSnapshot) {
	snapshots.delete(id);
	snapshots.set(id, snapshot);

	while (snapshots.size > MAX_SNAPSHOTS) {
		const oldest = snapshots.keys().next().value;
		if (oldest === undefined) return;
		snapshots.delete(oldest);
	}
}
