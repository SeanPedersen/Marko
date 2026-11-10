/**
 * Math support for the HTML pipeline (print). Equations are swapped for
 * placeholders before `marked` runs, so LaTeX characters such as `_`, `\\` or
 * `*` are not interpreted as Markdown, and rendered with KaTeX afterwards.
 */
import katex from 'katex';

const CODE_SEGMENT_REGEX = /(^|\n)(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n\2[^\n]*(?=\n|$)|$)|`[^`\n]*`/g;
const BLOCK_MATH_REGEX = /\$\$([\s\S]+?)\$\$/g;
const INLINE_MATH_REGEX = /\$(?!\$)([^\s$][^$\n]*?)(?<!\s)\$/g;
const PLACEHOLDER_PREFIX = 'MARKOMATHPLACEHOLDER';
const PLACEHOLDER_SUFFIX = 'END';
const PLACEHOLDER_REGEX = new RegExp(`${PLACEHOLDER_PREFIX}(\\d+)${PLACEHOLDER_SUFFIX}`, 'g');

export interface ProtectedMath {
	markdown: string;
	equations: { latex: string; displayMode: boolean }[];
}

/** Replace every equation outside code with a placeholder token. */
export function extractMath(markdown: string): ProtectedMath {
	const equations: ProtectedMath['equations'] = [];
	const placeholderFor = (latex: string, displayMode: boolean) => {
		equations.push({ latex: latex.trim(), displayMode });
		return `${PLACEHOLDER_PREFIX}${equations.length - 1}${PLACEHOLDER_SUFFIX}`;
	};
	const replaceMath = (text: string) =>
		text
			.replace(BLOCK_MATH_REGEX, (_, latex) => `\n\n${placeholderFor(latex, true)}\n\n`)
			.replace(INLINE_MATH_REGEX, (_, latex) => placeholderFor(latex, false));

	let result = '';
	let cursor = 0;
	for (const code of markdown.matchAll(CODE_SEGMENT_REGEX)) {
		result += replaceMath(markdown.slice(cursor, code.index)) + code[0];
		cursor = code.index + code[0].length;
	}
	return { markdown: result + replaceMath(markdown.slice(cursor)), equations };
}

/** Put KaTeX output back in place of the placeholders of sanitized HTML. */
export function restoreMath(html: string, equations: ProtectedMath['equations']): string {
	const render = (index: number) => {
		const { latex, displayMode } = equations[index];
		return katex.renderToString(latex, { throwOnError: false, displayMode, strict: false });
	};
	return html
		.replace(new RegExp(`<p>\\s*(${PLACEHOLDER_PREFIX}\\d+${PLACEHOLDER_SUFFIX})\\s*</p>`, 'g'), '$1')
		.replace(PLACEHOLDER_REGEX, (_, index) => render(Number(index)));
}
