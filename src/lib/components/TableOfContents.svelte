<script lang="ts">
	import { parseHeadings, type Heading } from '../utils/parseHeadings.js';

	let {
		rawContent = '',
		visible = true,
		ontoggle,
	} = $props<{
		rawContent: string;
		visible?: boolean;
		ontoggle?: () => void;
	}>();

	let activeHeadingIndex = $state(-1);
	let observer: IntersectionObserver | null = null;
	let headingElements: HTMLElement[] = [];

	let headings = $derived(parseHeadings(rawContent));
	let hasHeadings = $derived(headings.length > 0);

	const MIN_INDENT_LEVEL = $derived(
		headings.length > 0 ? Math.min(...headings.map((h) => h.level)) : 1
	);

	function scrollToHeading(heading: Heading, index: number) {
		const editorContainer = document.querySelector('.milkdown-container');
		if (!editorContainer) return;

		const allHeadings = editorContainer.querySelectorAll('h1, h2, h3, h4, h5, h6');
		const target = findMatchingElement(allHeadings, heading, index);

		if (target) {
			target.scrollIntoView({ behavior: 'smooth', block: 'start' });
			activeHeadingIndex = index;
		}
	}

	function findMatchingElement(
		elements: NodeListOf<Element>,
		heading: Heading,
		tocIndex: number
	): Element | null {
		const tagName = `H${heading.level}`;
		let matchCount = 0;

		// Count how many headings of the same level+text appear before this index
		let targetOccurrence = 0;
		for (let i = 0; i < tocIndex; i++) {
			if (headings[i].level === heading.level && headings[i].text === heading.text) {
				targetOccurrence++;
			}
		}

		for (const el of elements) {
			if (el.tagName !== tagName) continue;
			const text = el.textContent?.trim() ?? '';
			if (text === heading.text) {
				if (matchCount === targetOccurrence) return el;
				matchCount++;
			}
		}

		return null;
	}

	function setupObserver() {
		cleanupObserver();

		const editorContainer = document.querySelector('.milkdown-container');
		if (!editorContainer) return;

		headingElements = Array.from(
			editorContainer.querySelectorAll('h1, h2, h3, h4, h5, h6')
		) as HTMLElement[];

		if (headingElements.length === 0) return;

		observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (!entry.isIntersecting) continue;
					const idx = headingElements.indexOf(entry.target as HTMLElement);
					if (idx !== -1 && idx < headings.length) {
						activeHeadingIndex = idx;
					}
				}
			},
			{
				root: editorContainer,
				rootMargin: '-10% 0px -80% 0px',
				threshold: 0,
			}
		);

		for (const el of headingElements) {
			observer.observe(el);
		}
	}

	function cleanupObserver() {
		if (observer) {
			observer.disconnect();
			observer = null;
		}
		headingElements = [];
	}

	$effect(() => {
		// Re-setup observer when headings change
		const _ = headings;
		// Small delay to let Milkdown render
		const timer = setTimeout(setupObserver, 300);
		return () => {
			clearTimeout(timer);
			cleanupObserver();
		};
	});
</script>

{#if hasHeadings}
	<button
		class="toc-toggle"
		class:collapsed={!visible}
		onclick={ontoggle}
		title={visible ? 'Hide Table of Contents' : 'Show Table of Contents'}
		aria-label="Toggle table of contents"
	>
		<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
			<path d="M2 3h12M2 7h8M2 11h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
		</svg>
	</button>

	{#if visible}
		<nav class="toc-sidebar" aria-label="Table of contents">
			<div class="toc-header">Contents</div>
			<ul class="toc-list">
				{#each headings as heading, i}
					<li
						class="toc-item"
						class:active={i === activeHeadingIndex}
						style="padding-left: {(heading.level - MIN_INDENT_LEVEL) * 12 + 8}px"
					>
						<button
							class="toc-link"
							onclick={() => scrollToHeading(heading, i)}
							title={heading.text}
						>
							{heading.text}
						</button>
					</li>
				{/each}
			</ul>
		</nav>
	{/if}
{/if}

<style>
	.toc-toggle {
		position: fixed;
		top: 44px;
		left: 8px;
		z-index: 100;
		width: 28px;
		height: 28px;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--color-border-default);
		border-radius: 6px;
		background: var(--color-canvas-default);
		color: var(--color-fg-muted);
		cursor: pointer;
		opacity: 0.7;
		transition: opacity 0.15s, background 0.15s;
	}

	.toc-toggle:hover {
		opacity: 1;
		background: var(--color-canvas-subtle);
	}

	.toc-toggle.collapsed {
		opacity: 0.5;
	}

	.toc-sidebar {
		position: fixed;
		top: 36px;
		left: 0;
		bottom: 0;
		width: 220px;
		background: var(--color-canvas-default);
		border-right: 1px solid var(--color-border-default);
		overflow-y: auto;
		overflow-x: hidden;
		z-index: 50;
		font-family: var(--win-font);
		padding-top: 40px;
		animation: slideIn 0.15s ease-out;
	}

	@keyframes slideIn {
		from {
			transform: translateX(-100%);
			opacity: 0;
		}
		to {
			transform: translateX(0);
			opacity: 1;
		}
	}

	.toc-header {
		padding: 4px 12px 8px;
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		color: var(--color-fg-muted);
	}

	.toc-list {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.toc-item {
		position: relative;
	}

	.toc-item.active {
		background: var(--color-neutral-muted);
	}

	.toc-item.active::before {
		content: '';
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		width: 2px;
		background: var(--color-accent-fg);
	}

	.toc-link {
		display: block;
		width: 100%;
		padding: 4px 8px;
		border: none;
		background: none;
		color: var(--color-fg-muted);
		font-size: 12.5px;
		line-height: 1.4;
		text-align: left;
		cursor: pointer;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		transition: color 0.1s;
	}

	.toc-link:hover {
		color: var(--color-fg-default);
	}

	.toc-item.active .toc-link {
		color: var(--color-accent-fg);
		font-weight: 500;
	}

	/* Scrollbar styling */
	.toc-sidebar::-webkit-scrollbar {
		width: 4px;
	}

	.toc-sidebar::-webkit-scrollbar-track {
		background: transparent;
	}

	.toc-sidebar::-webkit-scrollbar-thumb {
		background: var(--color-neutral-muted);
		border-radius: 2px;
	}
</style>
