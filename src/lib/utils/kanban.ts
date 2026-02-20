import { parseFrontmatter } from './frontmatter.js';

export interface KanbanCard {
	id: string;
	text: string;
	checked: boolean;
}

export interface KanbanColumn {
	name: string;
	cards: KanbanCard[];
	collapsed: boolean;
}

const SETTINGS_BLOCK_REGEX = /\n?%%\s*kanban:settings\s*\n```json\s*\n([\s\S]*?)\n```\s*\n%%/;

export function parseKanban(content: string): { columns: KanbanColumn[]; frontmatter: string } {
	const { rawBlock, body } = parseFrontmatter(content);
	const frontmatter = rawBlock;

	// Strip out the settings block to get pure body
	const settingsMatch = body.match(SETTINGS_BLOCK_REGEX);
	let collapseStates: boolean[] = [];

	if (settingsMatch) {
		try {
			const settings = JSON.parse(settingsMatch[1]);
			collapseStates = settings['list-collapse'] ?? [];
		} catch {
			// ignore malformed settings
		}
	}

	const bodyWithoutSettings = body.replace(SETTINGS_BLOCK_REGEX, '').trimEnd();

	// Split into sections by ## headings
	const sections = bodyWithoutSettings.split(/\n(?=## )/);
	const columns: KanbanColumn[] = [];

	for (const section of sections) {
		const lines = section.split('\n');
		const headerLine = lines.find((l) => l.startsWith('## '));
		if (!headerLine) continue;

		const name = headerLine.slice(3).trim();
		const cards: KanbanCard[] = [];

		for (const line of lines) {
			const unchecked = line.match(/^- \[ \] (.+)/);
			const checked = line.match(/^- \[x\] (.+)/i);
			if (unchecked) {
				cards.push({ id: crypto.randomUUID(), text: unchecked[1].trim(), checked: false });
			} else if (checked) {
				cards.push({ id: crypto.randomUUID(), text: checked[1].trim(), checked: true });
			}
		}

		const idx = columns.length;
		columns.push({ name, cards, collapsed: collapseStates[idx] ?? false });
	}

	return { columns, frontmatter };
}

export function serializeKanban(columns: KanbanColumn[], frontmatter: string): string {
	const parts: string[] = [frontmatter];

	for (const col of columns) {
		const cardLines = col.cards.map((c) => `- [${c.checked ? 'x' : ' '}] ${c.text}`);
		parts.push(`## ${col.name}\n${cardLines.join('\n')}`);
	}

	const collapseStates = columns.map((c) => c.collapsed);
	const settingsJson = JSON.stringify({ 'kanban-plugin': 'board', 'list-collapse': collapseStates });
	const settingsBlock = `\n%% kanban:settings\n\`\`\`json\n${settingsJson}\n\`\`\`\n%%`;

	return parts.join('\n\n') + settingsBlock + '\n';
}
