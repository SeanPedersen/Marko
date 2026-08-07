# Bugs

## Fixed (pending verification)

**Tabs lose cursor and scroll position when coming from a kanban board tab.**
The caret/scroll snapshots lived in a `Map` inside `CodeMirrorEditor`, and a
kanban (or mermaid / HTML) tab replaces that component entirely — unmounting it
took every tab's remembered position with it. Snapshots now live in
`codemirror/viewSnapshots.ts`, are written on unmount, and are re-applied when
the editor mounts again.

**Cursor jumps up and selects everything back to the last position.**
A drag-selection keeps its anchor as a document position but re-derives its head
from pointer coordinates on every mousemove. Decoration rebuilds were suppressed
during a drag, except when the parse changed — a background incremental parse
finishing or an external write landing mid-drag still rebuilt, moved text under
the pointer, and redirected the head. Suppression now holds through parse
changes too, and the pointer release is deferred past the browser's
pointerup → mouseup → click sequence so CodeMirror's final coordinate lookup
still sees the un-rebuilt layout.

## Open

Scroll position does not survive an app restart. `session-tabs` persists a
`scrollTop` per tab and `restoreTabSession` feeds it back into `tabManager`, but
nothing applies `tab.scrollTop` to the editor — the in-memory snapshot store
dies with the process. (`tab.scrollTop` is otherwise only read for the
`isScrolled` header shadow, which is therefore always false.)
