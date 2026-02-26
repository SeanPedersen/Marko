import { parseFrontmatter } from './frontmatter.js';

export interface KanbanCard {
	id: string;
	text: string;
	body: string;
	checked: boolean;
}

export interface KanbanColumn {
	name: string;
	cards: KanbanCard[];
	collapsed: boolean;
}

export type KanbanFormat = 'obsidian' | 'marko';

export function createCard(text: string, checked = false): KanbanCard {
	return { id: crypto.randomUUID(), text, body: '', checked };
}

const SETTINGS_BLOCK_REGEX = /\n?%%\s*kanban:settings\s*\n([\s\S]*?)\n%%/;

type ParseState = 'BEFORE_COLUMN' | 'IN_COLUMN' | 'IN_BODY';

interface MutableCard {
	id: string;
	text: string;
	checked: boolean;
	bodyLines: string[];
}

export function detectKanbanFormat(content: string): KanbanFormat {
	const { fields } = parseFrontmatter(content);
	if (fields.some((f) => f.key === 'marko-kanban-plugin' && f.value === 'board')) return 'marko';
	return 'obsidian';
}

export function parseKanban(content: string): { columns: KanbanColumn[]; frontmatter: string } {
	const { rawBlock, body } = parseFrontmatter(content);
	const frontmatter = rawBlock;

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
	const lines = bodyWithoutSettings.split('\n');

	const columns: KanbanColumn[] = [];
	let currentColumn: { name: string; cards: KanbanCard[] } | null = null;
	let currentCard: MutableCard | null = null;
	let state: ParseState = 'BEFORE_COLUMN';
	let blankBuffer = 0;

	function finalizeCard() {
		if (!currentCard || !currentColumn) return;
		currentColumn.cards.push({
			id: currentCard.id,
			text: currentCard.text,
			checked: currentCard.checked,
			body: currentCard.bodyLines.join('\n').trimEnd(),
		});
		currentCard = null;
	}

	function finalizeColumn() {
		if (!currentColumn) return;
		const idx = columns.length;
		columns.push({
			name: currentColumn.name,
			cards: currentColumn.cards,
			collapsed: collapseStates[idx] ?? false,
		});
		currentColumn = null;
	}

	for (const line of lines) {
		if (line.trim() === '') {
			blankBuffer++;
			continue;
		}

		const colHeader = line.match(/^## (.+)/);
		const unchecked = line.match(/^- \[ \] (.+)/);
		const checked = line.match(/^- \[x\] (.+)/i);
		const isSeparator = line === '---';

		// ## is a column header when NOT in body, or in body preceded by 2+ blank lines
		const isColHeader = colHeader && (state !== 'IN_BODY' || blankBuffer >= 2);

		if (isColHeader) {
			finalizeCard();
			finalizeColumn();
			currentColumn = { name: colHeader[1].trim(), cards: [] };
			state = 'IN_COLUMN';
			blankBuffer = 0;
			continue;
		}

		// Flush buffered blank lines into body before adding content
		if (state === 'IN_BODY') {
			for (let b = 0; b < blankBuffer; b++) currentCard!.bodyLines.push('');
		}
		blankBuffer = 0;

		if (state === 'BEFORE_COLUMN') continue;

		if (unchecked || checked) {
			finalizeCard();
			currentCard = {
				id: crypto.randomUUID(),
				text: (unchecked ?? checked)![1].trim(),
				checked: !!checked,
				bodyLines: [],
			};
			state = 'IN_COLUMN';
			continue;
		}

		if (state === 'IN_COLUMN' && currentCard && isSeparator) {
			state = 'IN_BODY';
			continue;
		}

		if (state === 'IN_BODY') {
			currentCard!.bodyLines.push(line);
		}
	}

	finalizeCard();
	finalizeColumn();

	return { columns, frontmatter };
}

/** Obsidian-compatible serializer — no bodies, single blank line between columns. */
export function serializeKanban(columns: KanbanColumn[], frontmatter: string): string {
	const parts: string[] = [frontmatter];

	for (const col of columns) {
		const cardLines = col.cards.map((c) => `- [${c.checked ? 'x' : ' '}] ${c.text}`);
		parts.push(`## ${col.name}\n${cardLines.join('\n')}`);
	}

	const collapseStates = columns.map((c) => c.collapsed);
	const settingsJson = JSON.stringify({ 'kanban-plugin': 'board', 'list-collapse': collapseStates });
	const settingsBlock = `\n%% kanban:settings\n${settingsJson}\n%%`;

	return parts.join('\n\n') + settingsBlock + '\n';
}
