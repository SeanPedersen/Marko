<script lang="ts">
	import { getVersion } from '@tauri-apps/api/app';
	import { onMount } from 'svelte';

	let { recentFiles, recentFolders, onselectFile, onselectFolder, onloadFile, onopenFolder, onremoveRecentFile, onremoveRecentFolder, onnewFile, onnewKanbanFile, onnewMermaidFile } = $props<{
		recentFiles: string[];
		recentFolders: string[];
		onselectFile: () => void;
		onselectFolder: () => void;
		onloadFile: (file: string) => void;
		onopenFolder: (folder: string) => void;
		onremoveRecentFile: (file: string, e: MouseEvent) => void;
		onremoveRecentFolder: (folder: string, e: MouseEvent) => void;
		onnewFile: () => void;
		onnewKanbanFile: () => void;
		onnewMermaidFile: () => void;
	}>();

	let version = $state('');

	onMount(async () => {
		try {
			version = await getVersion();
		} catch (e) {
			console.error('Failed to get version:', e);
		}
	});

	function getFileName(path: string) {
		return path.split(/[/\\]/).pop() || path;
	}

	function getFolderName(path: string) {
		return path.split(/[/\\]/).pop() || path;
	}
</script>

<div class="flex flex-col justify-center mt-8 items-center select-none [font-family:var(--font-win)] h-[90vh] w-full pt-8 px-5 pb-0 box-border text-(--color-fg-default) opacity-80">
	<div class="flex flex-col gap-[10px] mt-5 items-center max-w-[800px]">
		<div class="flex gap-[10px]">
			<button
				class="bg-[#0078d4] text-white border border-black/10 px-5 py-2 rounded-[6px] cursor-pointer font-medium [font-family:var(--font-win)] text-[14px] transition-all duration-200 ease-[cubic-bezier(0.1,0.9,0.2,1)] shadow-[0_2px_4px_rgba(0,0,0,0.05)] inline-flex items-center justify-center gap-2"
				onclick={onselectFile}
			>
				<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" /></svg>
				Open file
			</button>
			<button
				class="bg-[#0078d4] text-white border border-black/10 px-5 py-2 rounded-[6px] cursor-pointer font-medium [font-family:var(--font-win)] text-[14px] transition-all duration-200 ease-[cubic-bezier(0.1,0.9,0.2,1)] shadow-[0_2px_4px_rgba(0,0,0,0.05)] inline-flex items-center justify-center gap-2"
				onclick={onselectFolder}
			>
				<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
				Open folder
			</button>
		</div>
		<div class="flex gap-[10px]">
			<button
				class="bg-(--color-canvas-subtle) text-(--color-fg-default) border border-(--color-border-default) px-5 py-2 rounded-[6px] cursor-pointer font-medium [font-family:var(--font-win)] text-[14px] transition-all duration-200 ease-[cubic-bezier(0.1,0.9,0.2,1)] shadow-[0_2px_4px_rgba(0,0,0,0.05)] inline-flex items-center justify-center gap-2"
				onclick={onnewFile}
			>
				<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
				New file
			</button>
			<button
				class="bg-(--color-canvas-subtle) text-(--color-fg-default) border border-(--color-border-default) px-5 py-2 rounded-[6px] cursor-pointer font-medium [font-family:var(--font-win)] text-[14px] transition-all duration-200 ease-[cubic-bezier(0.1,0.9,0.2,1)] shadow-[0_2px_4px_rgba(0,0,0,0.05)] inline-flex items-center justify-center gap-2"
				onclick={onnewKanbanFile}
			>
				<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<rect x="3" y="3" width="5" height="18" rx="1"></rect>
					<rect x="10" y="3" width="5" height="12" rx="1"></rect>
					<rect x="17" y="3" width="5" height="15" rx="1"></rect>
				</svg>
				New Kanban
			</button>
			<button
				class="bg-(--color-canvas-subtle) text-(--color-fg-default) border border-(--color-border-default) px-5 py-2 rounded-[6px] cursor-pointer font-medium [font-family:var(--font-win)] text-[14px] transition-all duration-200 ease-[cubic-bezier(0.1,0.9,0.2,1)] shadow-[0_2px_4px_rgba(0,0,0,0.05)] inline-flex items-center justify-center gap-2"
				onclick={onnewMermaidFile}
			>
				<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<circle cx="5" cy="12" r="2"></circle>
					<circle cx="19" cy="5" r="2"></circle>
					<circle cx="19" cy="19" r="2"></circle>
					<line x1="7" y1="12" x2="17" y2="6"></line>
					<line x1="7" y1="12" x2="17" y2="18"></line>
				</svg>
				New Diagram
			</button>
		</div>
	</div>

	{#if recentFolders.length > 0}
		<div class="mt-10 w-full max-w-[800px] flex flex-col items-center animate-slide-up overflow-x-hidden box-border">
			<h3 class="text-[14px] font-semibold mb-5 opacity-80 text-center">Recent Folders</h3>
			<div class="grid grid-cols-[repeat(auto-fit,minmax(220px,220px))] justify-center gap-3 w-full box-border">
				{#each recentFolders as folder}
					<div
						class="relative bg-(--color-canvas-subtle) border border-(--color-border-default) rounded-[8px] p-3 px-4 flex items-center gap-3 cursor-pointer transition-all duration-200 ease-[cubic-bezier(0.1,0.9,0.2,1)] text-left text-(--color-fg-default) outline-none w-[220px] box-border hover:bg-(--color-neutral-muted) hover:border-(--color-accent-fg) hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)] group active:scale-[0.98]"
						onclick={() => onopenFolder(folder)}
						role="button"
						tabindex="0"
						onkeydown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								onopenFolder(folder);
							}
						}}>
						<div class="opacity-60 flex items-center justify-center">
							<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
						</div>
						<div class="flex flex-col overflow-hidden">
							<span class="text-[13px] font-medium overflow-hidden text-ellipsis whitespace-nowrap">{getFolderName(folder)}</span>
							<span class="text-[11px] opacity-50 overflow-hidden text-ellipsis whitespace-nowrap mt-0.5 [direction:rtl] text-left" title={folder}>{folder}</span>
						</div>
						<button
							class="absolute top-1 right-1 bg-none border-none p-1 cursor-pointer opacity-0 group-hover:opacity-40 hover:!opacity-100 transition-opacity duration-200 text-inherit rounded-[4px] flex items-center justify-center hover:bg-red-500/10"
							onclick={(e) => onremoveRecentFolder(folder, e as MouseEvent)}
							title="Remove from history">
							<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
						</button>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<div class="w-full max-w-[800px] flex flex-col items-center animate-slide-up overflow-x-hidden box-border" style="margin-top: {recentFolders.length > 0 ? '30px' : '60px'}">
		<h3 class="text-[14px] font-semibold mb-5 opacity-80 text-center">Recent Files</h3>
		{#if recentFiles.length > 0}
			<div class="grid grid-cols-[repeat(auto-fit,minmax(220px,220px))] justify-center gap-3 w-full box-border">
				{#each recentFiles as file}
					<div
						class="relative bg-(--color-canvas-subtle) border border-(--color-border-default) rounded-[8px] p-3 px-4 flex items-center gap-3 cursor-pointer transition-all duration-200 ease-[cubic-bezier(0.1,0.9,0.2,1)] text-left text-(--color-fg-default) outline-none w-[220px] box-border hover:bg-(--color-neutral-muted) hover:border-(--color-accent-fg) hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)] group active:scale-[0.98]"
						onclick={() => onloadFile(file)}
						role="button"
						tabindex="0"
						onkeydown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								onloadFile(file);
							}
						}}>
						<div class="opacity-60 flex items-center justify-center">
							<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" /></svg>
						</div>
						<div class="flex flex-col overflow-hidden">
							<span class="text-[13px] font-medium overflow-hidden text-ellipsis whitespace-nowrap">{getFileName(file)}</span>
							<span class="text-[11px] opacity-50 overflow-hidden text-ellipsis whitespace-nowrap mt-0.5 [direction:rtl] text-left" title={file}>{file}</span>
						</div>
						<button
							class="absolute top-1 right-1 bg-none border-none p-1 cursor-pointer opacity-0 group-hover:opacity-40 hover:!opacity-100 transition-opacity duration-200 text-inherit rounded-[4px] flex items-center justify-center hover:bg-red-500/10"
							onclick={(e) => onremoveRecentFile(file, e as MouseEvent)}
							title="Remove from history">
							<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
						</button>
					</div>
				{/each}
			</div>
		{:else}
			<p class="text-[14px] mb-5 opacity-50 text-center">Your recently opened files will appear here.</p>
		{/if}
	</div>
	<div class="mt-auto pb-5 text-[10px] opacity-25 font-medium pointer-events-none">v{version}</div>
</div>
