export interface FrontmatterField {
	key: string;
	value: string;
	rawLine: string;
}

export interface ParsedDocument {
	fields: FrontmatterField[];
	rawBlock: string;
	body: string;
}

const FRONTMATTER_REGEX = /^---[ \t]*\r?\n([\s\S]*?\n)---[ \t]*(?:\r?\n|$)/;

function stripQuotes(val: string): string {
	if (
		(val.startsWith("'") && val.endsWith("'")) ||
		(val.startsWith('"') && val.endsWith('"'))
	) {
		return val.slice(1, -1);
	}
	return val;
}

export function parseFrontmatter(markdown: string): ParsedDocument {
	const match = markdown.match(FRONTMATTER_REGEX);
	if (!match) return { fields: [], rawBlock: '', body: markdown };

	const rawBlock = match[0];
	const yamlBlock = match[1];
	const body = markdown.slice(rawBlock.length);

	const fields: FrontmatterField[] = [];
	for (const line of yamlBlock.split('\n')) {
		const trimmed = line.trimEnd();
		if (!trimmed) continue;

		const colonIdx = trimmed.indexOf(':');
		if (colonIdx === -1) continue;

		const key = trimmed.slice(0, colonIdx).trim();
		const rawVal = trimmed.slice(colonIdx + 1).trim();

		if (key) fields.push({ key, value: stripQuotes(rawVal), rawLine: trimmed });
	}

	return { fields, rawBlock, body };
}

export function rebuildFrontmatter(fields: FrontmatterField[]): string {
	if (fields.length === 0) return '';

	const lines = fields.map((f) => f.rawLine);
	return `---\n${lines.join('\n')}\n---\n`;
}

export function updateFieldValue(field: FrontmatterField, newValue: string): FrontmatterField {
	// Detect quote style from the original raw line
	const colonIdx = field.rawLine.indexOf(':');
	const originalRawVal = field.rawLine.slice(colonIdx + 1).trim();

	let quotedValue: string;
	if (originalRawVal.startsWith("'") && originalRawVal.endsWith("'")) {
		quotedValue = `'${newValue}'`;
	} else if (originalRawVal.startsWith('"') && originalRawVal.endsWith('"')) {
		quotedValue = `"${newValue}"`;
	} else {
		quotedValue = newValue;
	}

	return {
		key: field.key,
		value: newValue,
		rawLine: `${field.key}: ${quotedValue}`,
	};
}

export function createField(key: string, value: string): FrontmatterField {
	return { key, value, rawLine: `${key}: ${value}` };
}
