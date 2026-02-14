// Wiki-link autocomplete extension for CodeMirror

import { autocompletion } from '@codemirror/autocomplete';
import type { CompletionContext, CompletionResult, Completion } from '@codemirror/autocomplete';
import { Facet, Compartment } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { FileIndex } from '$lib/utils/wikiLinks';
import { fuzzyMatch } from '$lib/utils/wikiLinks';

// Facet to provide the file index to the completion source
export const fileIndexFacet = Facet.define<FileIndex, FileIndex>({
  combine: (values) => values[0] || { entries: [], byBasename: new Map(), byFilename: new Map() }
});

// Compartment for dynamically reconfiguring the file index
export const fileIndexCompartment = new Compartment();

/**
 * Completion source for wiki-links.
 * Triggers when user types [[ and provides file suggestions.
 */
function wikiLinkCompletionSource(context: CompletionContext): CompletionResult | null {
  // Get text before cursor on the current line
  const line = context.state.doc.lineAt(context.pos);
  const textBefore = line.text.slice(0, context.pos - line.from);

  // Find the start of a wiki-link: [[
  // Match pattern: [[query where query doesn't contain ]] or |
  const match = textBefore.match(/\[\[([^\]|]*)$/);
  if (!match) {
    return null;
  }

  const query = match[1];
  const startPos = context.pos - query.length;

  // Get the file index from the facet
  const fileIndex = context.state.facet(fileIndexFacet);
  if (!fileIndex || fileIndex.entries.length === 0) {
    return null;
  }

  // Get matching entries
  const matches = fuzzyMatch(query, fileIndex.entries);

  // Limit to top 20 results
  const limitedMatches = matches.slice(0, 20);

  const options: Completion[] = limitedMatches.map((entry, index) => ({
    label: entry.basename,
    detail: entry.relativePath !== entry.filename ? entry.relativePath : undefined,
    type: 'file',
    boost: 100 - index, // Preserve fuzzy match order
    apply: (view: EditorView, completion: Completion, from: number, to: number) => {
      // Insert the basename and close with ]]
      const insertText = entry.basename + ']]';
      view.dispatch({
        changes: { from, to, insert: insertText },
        selection: { anchor: from + insertText.length },
      });
    },
  }));

  if (options.length === 0) {
    return null;
  }

  return {
    from: startPos,
    options,
    validFor: /^[^\]|]*$/,
  };
}

/**
 * Create the wiki-link autocomplete extension.
 */
export function wikiLinkCompletion() {
  return autocompletion({
    override: [wikiLinkCompletionSource],
    activateOnTyping: true,
    icons: true,
  });
}

/**
 * Update the file index in an existing editor view.
 */
export function updateFileIndex(view: EditorView, index: FileIndex) {
  view.dispatch({
    effects: fileIndexCompartment.reconfigure(fileIndexFacet.of(index))
  });
}
