/**
 * Keeps a click from coming back as a selection when the pointer never dragged.
 *
 * CodeMirror anchors a pointer selection at the document position under the
 * pointer at mousedown, then re-resolves the live screen coordinates to a
 * document position again on every mousemove that follows. Momentum scrolling
 * keeps moving the document after the button is already down, so a pointer that
 * only twitches can resolve to a position far from that anchor and the click
 * arrives as a range spanning everything in between.
 *
 * Only plain single clicks are collapsed. Shift-, alt- and modifier-clicks and
 * double/triple clicks all select without pointer movement by design.
 */

import { EditorView } from '@codemirror/view';
import { EditorSelection, type Extension } from '@codemirror/state';

// Slack for the hand tremor that rides along with a click, far below the
// distance any deliberate drag covers.
const DRAG_SLACK_PX = 4;

function isPlainClick(event: MouseEvent): boolean {
	return (
		event.button === 0 &&
		event.detail === 1 &&
		!event.shiftKey &&
		!event.altKey &&
		!event.metaKey &&
		!event.ctrlKey
	);
}

export function clickPlacesCursor(): Extension {
	let origin: { x: number; y: number } | null = null;
	let originSelection: EditorSelection | null = null;
	let dragged = false;

	return EditorView.domEventHandlers({
		mousedown(event, view) {
			origin = isPlainClick(event) ? { x: event.clientX, y: event.clientY } : null;
			originSelection = view.state.selection;
			dragged = false;
			return false;
		},

		mousemove(event) {
			if (!origin || dragged) return false;
			dragged =
				Math.abs(event.clientX - origin.x) > DRAG_SLACK_PX ||
				Math.abs(event.clientY - origin.y) > DRAG_SLACK_PX;
			return false;
		},

		mouseup(_event, view) {
			const stationary = origin !== null && !dragged;
			const before = originSelection;
			origin = null;
			originSelection = null;
			if (!stationary) return false;

			// An unchanged selection means the click has not been applied yet
			// (mousedown landed inside it, so CodeMirror is still deciding between
			// a drag and a click) and there is nothing of ours to correct.
			const { main } = view.state.selection;
			if (main.empty || (before && view.state.selection.eq(before))) return false;

			view.dispatch({ selection: EditorSelection.cursor(main.head), userEvent: 'select.pointer' });
			return false;
		},
	});
}
