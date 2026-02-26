import type { KanbanCard, KanbanColumn } from './kanban.js';

const MARKO_PLUGIN_KEY = 'marko-kanban-plugin';

/**
 * Rewrites `kanban-plugin: board` → `marko-kanban-plugin: board` in the YAML frontmatter block.
 * No-op if already upgraded.
 */
export function upgradeToMarko(frontmatter: string): string {
	return frontmatter.replace(/\bkanban-plugin\b(?=\s*:\s*board)/, MARKO_PLUGIN_KEY);
}

function serializeCard(card: KanbanCard): string {
	const line = `- [${card.checked ? 'x' : ' '}] ${card.text}`;
	if (!card.body) return line;
	return `${line}\n---\n${card.body}`;
}

/**
 * Marko-extended serializer — emits card bodies, uses two blank lines between columns
 * so `## ` headings inside bodies are unambiguous.
 */
export function serializeMarkoKanban(columns: KanbanColumn[], frontmatter: string): string {
	const parts: string[] = [frontmatter];

	for (const col of columns) {
		const cardLines = col.cards.map(serializeCard);
		parts.push(`## ${col.name}\n${cardLines.join('\n')}`);
	}

	const collapseStates = columns.map((c) => c.collapsed);
	const settingsJson = JSON.stringify({
		[MARKO_PLUGIN_KEY]: 'board',
		'list-collapse': collapseStates,
	});
	const settingsBlock = `\n%% kanban:settings\n${settingsJson}\n%%`;

	// Three newlines = two blank lines between columns; keeps `## ` in bodies unambiguous
	return parts.join('\n\n\n') + settingsBlock + '\n';
}
