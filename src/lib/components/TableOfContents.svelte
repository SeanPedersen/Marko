<script lang="ts">
	import { parseHeadings, type Heading } from '../utils/parseHeadings.js';

	let {
		rawContent = '',
		visible = true,
		onscrollto,
		sidebarPosition = 'left',
		editorWidth = '720px',
	} = $props<{
		rawContent: string;
		visible?: boolean;
		onscrollto?: (event: CustomEvent<{ lineNumber: number }>) => void;
		sidebarPosition?: 'left' | 'right';
		editorWidth?: string;
	}>();

	let headings = $derived(parseHeadings(rawContent));
	let hasHeadings = $derived(headings.length > 0);

	const MIN_INDENT_LEVEL = $derived(
		headings.length > 0 ? Math.min(...headings.map((h) => h.level)) : 1
	);

	// Collapsed state: keyed by heading index, stores whether children are collapsed
	let collapsed = $state<Record<number, boolean>>({});

	// Determine which headings have children (subheadings directly beneath them)
	function hasChildren(index: number): boolean {
		if (index >= headings.length - 1) return false;
		return headings[index + 1].level > headings[index].level;
	}

	// Determine if a heading is hidden because a parent is collapsed
	function isHidden(index: number): boolean {
		const level = headings[index].level;
		// Walk backwards to find the nearest parent (lower level)
		for (let i = index - 1; i >= 0; i--) {
			if (headings[i].level >= level) continue; // sibling or deeper, skip
			// Found nearest parent
			if (collapsed[i]) return true;
			return isHidden(i);
		}
		return false;
	}

	function toggleCollapse(index: number) {
		collapsed[index] = !collapsed[index];
	}

	function scrollToHeading(heading: Heading) {
		if (onscrollto) {
			onscrollto(new CustomEvent('scrollto', {
				detail: { lineNumber: heading.lineNumber }
			}));
		}
	}


</script>

{#if hasHeadings && visible}
	<nav class="toc-sidebar {sidebarPosition === 'right' ? 'position-right' : ''}" style="--editor-max-width: {editorWidth};" aria-label="Table of contents">
		<ul class="toc-list">
			{#each headings as heading, i}
				{#if !isHidden(i)}
					<li
						class="toc-item"
						style="padding-left: {(heading.level - MIN_INDENT_LEVEL) * 12 + 8}px"
					>
						{#each Array(heading.level - MIN_INDENT_LEVEL) as _, depth}
							<span class="toc-guide" style="left: {depth * 12 + 12}px"></span>
						{/each}
						{#if hasChildren(i)}
							<button
								class="toc-toggle"
								class:collapsed={collapsed[i]}
								onclick={() => toggleCollapse(i)}
								aria-label={collapsed[i] ? 'Expand' : 'Collapse'}
							>
								<svg width="10" height="10" viewBox="0 0 10 10">
									<path d={collapsed[i] ? 'M3 1 L7 5 L3 9' : 'M1 3 L5 7 L9 3'} fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
								</svg>
							</button>
						{/if}
						<button
							class="toc-link"
							class:has-toggle={hasChildren(i)}
							onclick={() => scrollToHeading(heading)}
							title={heading.text}
						>
							{heading.text}
						</button>
					</li>
				{/if}
			{/each}
		</ul>
	</nav>
{/if}

<style>
	.toc-sidebar {
		position: fixed;
		top: 69px;
		bottom: 0;
		width: 260px;
		right: calc(50% + var(--editor-max-width, 720px) / 2 + 16px);
		overflow-y: auto;
		overflow-x: hidden;
		z-index: 50;
		font-family: var(--win-font);
		padding-top: 8px;
		animation: fadeIn 0.15s ease-out;
	}

	.toc-sidebar.position-right {
		right: auto;
		left: calc(50% + var(--editor-max-width, 720px) / 2 + 16px);
		animation: fadeIn 0.15s ease-out;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	.toc-list {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.toc-item {
		position: relative;
		display: flex;
		align-items: center;
	}

	.toc-guide {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 1px;
		background: var(--color-border-default);
		opacity: 0.5;
		pointer-events: none;
	}

	.toc-toggle {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		margin-left: -2px;
		border: none;
		background: none;
		color: var(--color-fg-muted);
		cursor: pointer;
		padding: 0;
		border-radius: 2px;
		opacity: 0.6;
		transition: opacity 0.1s;
	}

	.toc-toggle:hover {
		opacity: 1;
	}

	.toc-link {
		display: block;
		flex: 1;
		min-width: 0;
		padding: 5px 12px 5px 4px;
		border: none;
		background: none;
		color: var(--color-fg-muted);
		font-size: 12.5px;
		line-height: 1.4;
		text-align: left;
		cursor: pointer;
		white-space: normal;
		word-break: break-word;
		transition: color 0.1s;
	}

	.toc-link:not(.has-toggle) {
		padding-left: 18px;
	}

	.toc-link:hover {
		color: var(--color-fg-default);
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
