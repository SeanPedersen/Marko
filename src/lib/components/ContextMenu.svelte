<script lang="ts">
	let { show, x, y, currentFile, oncopy, onselectAll, onopenFileLocation, onopenInEditor, oncloseFile, onhide } = $props<{
		show: boolean;
		x: number;
		y: number;
		currentFile: string;
		oncopy: () => void;
		onselectAll: () => void;
		onopenFileLocation: () => void;
		onopenInEditor: () => void;
		oncloseFile: () => void;
		onhide: () => void;
	}>();
	let menuEl = $state<HTMLDivElement>();

	$effect(() => {
		if (show && menuEl) {
			setTimeout(() => {
				menuEl?.focus();
			}, 10);
		}
	});
</script>

{#if show}
	<div
		class="fixed bg-(--color-canvas-default) border border-(--color-border-default) rounded-[8px] p-1 min-w-[180px] z-[20000] shadow-[0_8px_32px_rgba(0,0,0,0.5)] [font-family:var(--font-win)] animate-menu-fade outline-none"
		bind:this={menuEl}
		style="left: {x}px; top: {y}px;"
		onclick={(e) => e.stopPropagation()}
		role="menu"
		tabindex="-1"
		onkeydown={(e) => e.key === 'Escape' && onhide()}>
		<button class="w-full text-left bg-transparent border-none text-(--color-fg-default) px-3 py-1.5 text-[13px] rounded cursor-default flex justify-between items-center hover:bg-(--color-neutral-muted) disabled:opacity-30" onclick={oncopy}>Copy</button>
		<button class="w-full text-left bg-transparent border-none text-(--color-fg-default) px-3 py-1.5 text-[13px] rounded cursor-default flex justify-between items-center hover:bg-(--color-neutral-muted) disabled:opacity-30" onclick={onselectAll}>Select All</button>
		<div class="h-px bg-(--color-border-muted) my-1"></div>
		<button class="w-full text-left bg-transparent border-none text-(--color-fg-default) px-3 py-1.5 text-[13px] rounded cursor-default flex justify-between items-center hover:bg-(--color-neutral-muted) disabled:opacity-30" onclick={onopenFileLocation} disabled={!currentFile}>Open file location</button>
		<button class="w-full text-left bg-transparent border-none text-(--color-fg-default) px-3 py-1.5 text-[13px] rounded cursor-default flex justify-between items-center hover:bg-(--color-neutral-muted) disabled:opacity-30" onclick={onopenInEditor} disabled={!currentFile}>Open in Notepad</button>
		<div class="h-px bg-(--color-border-muted) my-1"></div>
		<button class="w-full text-left bg-transparent border-none text-(--color-fg-default) px-3 py-1.5 text-[13px] rounded cursor-default flex justify-between items-center hover:bg-(--color-neutral-muted) disabled:opacity-30" onclick={oncloseFile} disabled={!currentFile}>Close</button>
	</div>
{/if}
