export interface Heading {
	level: number;
	text: string;
	id: string;
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

	for (const line of markdown.split('\n')) {
		const match = line.trim().match(HEADING_REGEX);
		if (!match) continue;

		const level = match[1].length;
		const text = match[2].trim();
		let id = slugify(text);

		// Deduplicate slugs
		const count = slugCounts.get(id) ?? 0;
		slugCounts.set(id, count + 1);
		if (count > 0) id = `${id}-${count}`;

		headings.push({ level, text, id });
	}

	return headings;
}
