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

	let collapsed = $state<Record<number, boolean>>({});

	function hasChildren(index: number): boolean {
		if (index >= headings.length - 1) return false;
		return headings[index + 1].level > headings[index].level;
	}

	function isHidden(index: number): boolean {
		const level = headings[index].level;
		for (let i = index - 1; i >= 0; i--) {
			if (headings[i].level >= level) continue;
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
	<nav
		class="toc-nav fixed top-[69px] bottom-0 w-[260px] overflow-y-auto overflow-x-hidden z-50 [font-family:var(--font-win)] pt-2 animate-fade-in {sidebarPosition === 'right' ? 'right-auto' : ''}"
		style="--editor-max-width: {editorWidth}; {sidebarPosition === 'right' ? `left: calc(50% + var(--editor-max-width, 720px) / 2 + 16px)` : `right: calc(50% + var(--editor-max-width, 720px) / 2 + 16px)`};"
		aria-label="Table of contents">
		<ul class="list-none m-0 p-0">
			{#each headings as heading, i}
				{#if !isHidden(i)}
					<li
						class="relative flex items-center"
						style="padding-left: {(heading.level - MIN_INDENT_LEVEL) * 12 + 8}px"
					>
						{#each Array(heading.level - MIN_INDENT_LEVEL) as _, depth}
							<span class="absolute top-0 bottom-0 w-px bg-(--color-border-default) opacity-50 pointer-events-none" style="left: {depth * 12 + 12}px"></span>
						{/each}
						{#if hasChildren(i)}
							<button
								class="shrink-0 flex items-center justify-center w-4 h-4 -ml-0.5 border-none bg-none text-(--color-fg-muted) cursor-pointer p-0 rounded-[2px] opacity-60 hover:opacity-100 transition-opacity duration-100"
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
							class="block flex-1 min-w-0 py-[5px] pr-3 border-none bg-none text-(--color-fg-muted) text-[12.5px] leading-[1.4] text-left cursor-pointer whitespace-normal break-words transition-[color] duration-100 hover:text-(--color-fg-default) {hasChildren(i) ? 'pl-1' : 'pl-[18px]'}"
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
	.toc-nav::-webkit-scrollbar {
		width: 4px;
	}

	.toc-nav::-webkit-scrollbar-track {
		background: transparent;
	}

	.toc-nav::-webkit-scrollbar-thumb {
		background: var(--color-neutral-muted);
		border-radius: 2px;
	}
</style>
