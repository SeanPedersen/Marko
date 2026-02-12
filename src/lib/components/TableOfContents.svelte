<script lang="ts">
	import { parseHeadings, type Heading } from '../utils/parseHeadings.js';

	let {
		rawContent = '',
		visible = true,
		onscrollto,
	} = $props<{
		rawContent: string;
		visible?: boolean;
		onscrollto?: (event: CustomEvent<{ lineNumber: number }>) => void;
	}>();

	let activeHeadingIndex = $state(-1);

	let headings = $derived(parseHeadings(rawContent));
	let hasHeadings = $derived(headings.length > 0);

	const MIN_INDENT_LEVEL = $derived(
		headings.length > 0 ? Math.min(...headings.map((h) => h.level)) : 1
	);

	function scrollToHeading(heading: Heading, index: number) {
		activeHeadingIndex = index;

		// Dispatch event with line number for CodeMirror to handle scrolling
		if (onscrollto) {
			onscrollto(new CustomEvent('scrollto', {
				detail: { lineNumber: heading.lineNumber }
			}));
		}
	}

	// Update active heading based on scroll position
	// Since CodeMirror handles scrolling, we track based on user clicks
	// A more sophisticated approach would involve the editor reporting visible headings
</script>

{#if hasHeadings && visible}
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

<style>
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
		padding-top: 8px;
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
