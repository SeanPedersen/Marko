/** Prepare the current Markdown document for the system print dialog. */
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { parseFrontmatter } from './frontmatter.js';

export function printMarkdown(content: string, filePath: string): void {
	const previous = document.getElementById('marko-print-document');
	previous?.remove();

	const article = document.createElement('article');
	article.id = 'marko-print-document';
	article.innerHTML = DOMPurify.sanitize(marked.parse(parseFrontmatter(content).body, { async: false }));

	const directory = filePath.slice(0, Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')) + 1);
	for (const image of article.querySelectorAll('img')) {
		const src = image.getAttribute('src');
		if (!src || /^(?:https?:|data:|asset:)/i.test(src)) continue;
		const path = /^(?:\/|[a-z]:[/\\])/i.test(src) ? src : directory + src;
		const parts: string[] = [];
		let decodedPath = path;
		try { decodedPath = decodeURIComponent(path); } catch { /* Keep literal percent signs in file names. */ }
		for (const part of decodedPath.split(/[/\\]/)) {
			if (part === '..') parts.pop();
			else if (part !== '.') parts.push(part);
		}
		image.src = convertFileSrc(parts.join('/'));
	}

	document.body.append(article);
	const images = [...article.querySelectorAll('img')];
	const imageLoadTimeoutMs = 3000;
	const imagesReady = Promise.all(images.map((image) => image.decode().catch(() => {})));
	const timeout = new Promise<void>((resolve) => setTimeout(resolve, imageLoadTimeoutMs));
	Promise.race([imagesReady, timeout])
		.then(() => invoke('print_document'))
		.catch((error) => console.error('Unable to open print dialog:', error));
}
