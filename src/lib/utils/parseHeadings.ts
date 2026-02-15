export interface Heading {
	level: number;
	text: string;
	id: string;
	lineNumber: number;
}

const HEADING_REGEX = /^(#{1,6})\s+(.+)$/;

function slugify(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^\w\s-]/g, '')
		.replace(/\s+/g, '-')
		.replace(/-+/g, '-')
		.trim();
}

export function parseHeadings(markdown: string): Heading[] {
	if (!markdown) return [];

	const headings: Heading[] = [];
	const slugCounts = new Map<string, number>();
	const lines = markdown.split('\n');

	let fenceChar = '';
	let fenceLen = 0;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const fenceMatch = line.trim().match(/^(`{3,}|~{3,})/);

		if (fenceMatch) {
			const char = fenceMatch[1][0];
			const len = fenceMatch[1].length;

			if (!fenceLen) {
				// Opening fence
				fenceChar = char;
				fenceLen = len;
			} else if (char === fenceChar && len >= fenceLen) {
				// Closing fence (same char, equal or greater length)
				fenceChar = '';
				fenceLen = 0;
			}
			continue;
		}
		if (fenceLen) continue;

		const match = line.trim().match(HEADING_REGEX);
		if (!match) continue;

		const level = match[1].length;
		const text = match[2].trim();
		let id = slugify(text);

		// Deduplicate slugs
		const count = slugCounts.get(id) ?? 0;
		slugCounts.set(id, count + 1);
		if (count > 0) id = `${id}-${count}`;

		// Line numbers are 1-indexed for CodeMirror
		headings.push({ level, text, id, lineNumber: i + 1 });
	}

	return headings;
}
