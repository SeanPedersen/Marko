<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import { invoke } from '@tauri-apps/api/core';
	import {
		settings,
		EDITOR_WIDTH_VALUES,
		EDITOR_FONT_VALUES,
		EDITOR_FONT_SIZE_MIN,
		EDITOR_FONT_SIZE_MAX,
		type EditorWidth,
		type EditorFont,
		type SidebarPosition,
	} from '../stores/settings.svelte.js';

	let {
		show,
		onclose,
	} = $props<{
		show: boolean;
		onclose: () => void;
	}>();

	let modalContent = $state<HTMLDivElement>();
	let previousActiveElement: HTMLElement | null = null;
	let cliInstallStatus = $state<'idle' | 'installing' | 'success' | 'error'>('idle');
	let cliErrorMessage = $state('');

	const editorWidthOptions: { value: EditorWidth; label: string; description: string }[] = [
		{ value: 'compact', label: 'Compact', description: '600px' },
		{ value: 'default', label: 'Default', description: '720px' },
		{ value: 'wide', label: 'Wide', description: '900px' },
		{ value: 'full', label: 'Full', description: '100%' },
	];

	const positionOptions: { value: SidebarPosition; label: string }[] = [
		{ value: 'left', label: 'Left' },
		{ value: 'right', label: 'Right' },
	];

	const editorFontOptions: { value: EditorFont; label: string }[] = [
		{ value: 'system', label: 'System' },
		{ value: 'sans', label: 'Sans' },
		{ value: 'serif', label: 'Serif' },
		{ value: 'mono', label: 'Mono' },
	];

	$effect(() => {
		if (show) {
			previousActiveElement = document.activeElement as HTMLElement;
			setTimeout(() => {
				modalContent?.focus();
			}, 50);
		} else if (previousActiveElement) {
			previousActiveElement.focus();
		}
	});

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			onclose();
		}
		if (e.key === 'Tab') {
			const focusableElements = modalContent?.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') || [];
			if (focusableElements.length === 0) return;
			const first = focusableElements[0] as HTMLElement;
			const last = focusableElements[focusableElements.length - 1] as HTMLElement;

			if (e.shiftKey) {
				if (document.activeElement === first) {
					e.preventDefault();
					last.focus();
				}
			} else {
				if (document.activeElement === last) {
					e.preventDefault();
					first.focus();
				}
			}
		}
	}

	function handleBackdropClick() {
		onclose();
	}

	async function installCli() {
		cliInstallStatus = 'installing';
		cliErrorMessage = '';
		try {
			await invoke('install_cli');
			cliInstallStatus = 'success';
		} catch (e) {
			cliInstallStatus = 'error';
			cliErrorMessage = String(e);
		}
	}
</script>

{#if show}
	<div class="fixed inset-0 bg-black/40 flex items-center justify-center z-[30000]" transition:fade={{ duration: 150 }} onclick={handleBackdropClick} role="presentation">
		<div
			class="bg-(--color-canvas-default) border border-(--color-border-default) rounded-[8px] w-[420px] max-w-[90vw] max-h-[80vh] shadow-[0_20px_50px_rgba(0,0,0,0.3)] overflow-hidden [font-family:var(--font-win)] flex flex-col"
			bind:this={modalContent}
			transition:scale={{ duration: 200, start: 0.95 }}
			onclick={(e) => e.stopPropagation()}
			role="dialog"
			aria-modal="true"
			tabindex="-1"
			onkeydown={handleKeydown}>
			<div class="px-5 py-4 flex items-center justify-between border-b border-(--color-border-default)">
				<h3 class="m-0 text-[15px] font-semibold text-(--color-fg-default)">Settings</h3>
				<button
					class="bg-transparent border-none p-1 cursor-pointer text-(--color-fg-muted) rounded-[4px] flex items-center justify-center transition-all duration-100 hover:bg-(--color-canvas-subtle) hover:text-(--color-fg-default)"
					onclick={onclose}
					aria-label="Close">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<line x1="18" y1="6" x2="6" y2="18"></line>
						<line x1="6" y1="6" x2="18" y2="18"></line>
					</svg>
				</button>
			</div>
			<div class="p-5 overflow-y-auto flex flex-col gap-6">
				<div class="flex flex-col gap-2">
					<div class="text-[13px] font-semibold text-(--color-fg-default)">Editor Width</div>
					<p class="text-[12px] text-(--color-fg-muted) m-0 leading-[1.4]">Set the maximum width of the text editor content area.</p>
					<div class="flex border border-(--color-border-default) rounded-[6px] overflow-hidden bg-(--color-canvas-subtle)">
						{#each editorWidthOptions as option}
							<button
								class="flex-1 py-2 px-3 border-none text-[13px] cursor-pointer transition-all duration-150 [font-family:inherit] border-r border-r-(--color-border-default) last:border-r-0 hover:[&:not(.active)]:bg-(--color-neutral-muted) hover:[&:not(.active)]:text-(--color-fg-default)"
								class:active={settings.editorWidth === option.value}
								class:bg-(--color-canvas-default)={settings.editorWidth === option.value}
								class:bg-transparent={settings.editorWidth !== option.value}
								class:text-(--color-accent-fg)={settings.editorWidth === option.value}
								class:text-(--color-fg-muted)={settings.editorWidth !== option.value}
								class:font-semibold={settings.editorWidth === option.value}
								class:font-medium={settings.editorWidth !== option.value}
								class:shadow-[0_1px_3px_rgba(0,0,0,0.1)]={settings.editorWidth === option.value}
								onclick={() => settings.setEditorWidth(option.value)}
								title={option.description}>
								{option.label}
							</button>
						{/each}
					</div>
				</div>

				<div class="flex flex-col gap-2">
					<div class="text-[13px] font-semibold text-(--color-fg-default)">Editor Font</div>
					<p class="text-[12px] text-(--color-fg-muted) m-0 leading-[1.4]">Choose the font used for writing and reading your notes.</p>
					<div class="flex border border-(--color-border-default) rounded-[6px] overflow-hidden bg-(--color-canvas-subtle)">
						{#each editorFontOptions as option}
							<button
								class="flex-1 py-2 px-3 border-none text-[13px] cursor-pointer transition-all duration-150 border-r border-r-(--color-border-default) last:border-r-0 hover:[&:not(.active)]:bg-(--color-neutral-muted) hover:[&:not(.active)]:text-(--color-fg-default)"
								style="font-family: {EDITOR_FONT_VALUES[option.value]}"
								class:active={settings.editorFont === option.value}
								class:bg-(--color-canvas-default)={settings.editorFont === option.value}
								class:bg-transparent={settings.editorFont !== option.value}
								class:text-(--color-accent-fg)={settings.editorFont === option.value}
								class:text-(--color-fg-muted)={settings.editorFont !== option.value}
								class:font-semibold={settings.editorFont === option.value}
								class:font-medium={settings.editorFont !== option.value}
								class:shadow-[0_1px_3px_rgba(0,0,0,0.1)]={settings.editorFont === option.value}
								onclick={() => settings.setEditorFont(option.value)}
								title={option.label}>
								{option.label}
							</button>
						{/each}
					</div>
				</div>

				<div class="flex flex-col gap-2">
					<div class="flex items-center justify-between">
						<div class="text-[13px] font-semibold text-(--color-fg-default)">Editor Font Size</div>
						<span class="text-[12px] text-(--color-fg-muted) tabular-nums">{settings.editorFontSize}px</span>
					</div>
					<input
						type="range"
						min={EDITOR_FONT_SIZE_MIN}
						max={EDITOR_FONT_SIZE_MAX}
						step="1"
						value={settings.editorFontSize}
						oninput={(e) => settings.setEditorFontSize(Number(e.currentTarget.value))}
						class="w-full accent-(--color-accent-fg) cursor-pointer" />
				</div>

				<div class="flex flex-col gap-2">
					<div class="text-[13px] font-semibold text-(--color-fg-default)">File Explorer Position</div>
					<p class="text-[12px] text-(--color-fg-muted) m-0 leading-[1.4]">Choose which side of the window to display the file explorer.</p>
					<div class="flex border border-(--color-border-default) rounded-[6px] overflow-hidden bg-(--color-canvas-subtle)">
						{#each positionOptions as option}
							<button
								class="flex-1 py-2 px-3 border-none text-[13px] cursor-pointer transition-all duration-150 [font-family:inherit] border-r border-r-(--color-border-default) last:border-r-0 hover:[&:not(.active)]:bg-(--color-neutral-muted) hover:[&:not(.active)]:text-(--color-fg-default)"
								class:active={settings.explorerPosition === option.value}
								class:bg-(--color-canvas-default)={settings.explorerPosition === option.value}
								class:bg-transparent={settings.explorerPosition !== option.value}
								class:text-(--color-accent-fg)={settings.explorerPosition === option.value}
								class:text-(--color-fg-muted)={settings.explorerPosition !== option.value}
								class:font-semibold={settings.explorerPosition === option.value}
								class:font-medium={settings.explorerPosition !== option.value}
								class:shadow-[0_1px_3px_rgba(0,0,0,0.1)]={settings.explorerPosition === option.value}
								onclick={() => settings.setExplorerPosition(option.value)}>
								{option.label}
							</button>
						{/each}
					</div>
				</div>

				<div class="flex flex-col gap-2">
					<div class="text-[13px] font-semibold text-(--color-fg-default)">Table of Contents Position</div>
					<p class="text-[12px] text-(--color-fg-muted) m-0 leading-[1.4]">Choose which side of the window to display the table of contents.</p>
					<div class="flex border border-(--color-border-default) rounded-[6px] overflow-hidden bg-(--color-canvas-subtle)">
						{#each positionOptions as option}
							<button
								class="flex-1 py-2 px-3 border-none text-[13px] cursor-pointer transition-all duration-150 [font-family:inherit] border-r border-r-(--color-border-default) last:border-r-0 hover:[&:not(.active)]:bg-(--color-neutral-muted) hover:[&:not(.active)]:text-(--color-fg-default)"
								class:active={settings.tocPosition === option.value}
								class:bg-(--color-canvas-default)={settings.tocPosition === option.value}
								class:bg-transparent={settings.tocPosition !== option.value}
								class:text-(--color-accent-fg)={settings.tocPosition === option.value}
								class:text-(--color-fg-muted)={settings.tocPosition !== option.value}
								class:font-semibold={settings.tocPosition === option.value}
								class:font-medium={settings.tocPosition !== option.value}
								class:shadow-[0_1px_3px_rgba(0,0,0,0.1)]={settings.tocPosition === option.value}
								onclick={() => settings.setTocPosition(option.value)}>
								{option.label}
							</button>
						{/each}
					</div>
				</div>

				<div class="flex flex-col gap-2">
					<div class="text-[13px] font-semibold text-(--color-fg-default)">Terminal Command</div>
					<p class="text-[12px] text-(--color-fg-muted) m-0 leading-[1.4]">Install the <code class="bg-(--color-canvas-subtle) px-1 py-px rounded-[3px] [font-family:'SF_Mono',Monaco,Consolas,monospace] text-[11px]">marko</code> command to open files from the terminal.</p>
					<div class="flex items-center gap-3">
						<button
							class="inline-flex items-center gap-2 px-4 py-2 rounded-[6px] text-[13px] font-medium cursor-pointer transition-all duration-150 [font-family:inherit] border border-(--color-border-default) bg-(--color-canvas-subtle) text-(--color-fg-default) hover:enabled:bg-(--color-neutral-muted) disabled:cursor-default disabled:opacity-70 {cliInstallStatus === 'success' ? 'bg-[#d4edda] border-[#28a745] text-[#155724]' : ''} {cliInstallStatus === 'error' ? 'border-[#dc3545]' : ''}"
							onclick={installCli}
							disabled={cliInstallStatus === 'installing' || cliInstallStatus === 'success'}>
							{#if cliInstallStatus === 'idle'}
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									<polyline points="4 17 10 11 4 5"></polyline>
									<line x1="12" y1="19" x2="20" y2="19"></line>
								</svg>
								Install Command
							{:else if cliInstallStatus === 'installing'}
								<svg class="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="32"></circle>
								</svg>
								Installing...
							{:else if cliInstallStatus === 'success'}
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									<polyline points="20 6 9 17 4 12"></polyline>
								</svg>
								Installed
							{:else}
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									<circle cx="12" cy="12" r="10"></circle>
									<line x1="12" y1="8" x2="12" y2="12"></line>
									<line x1="12" y1="16" x2="12.01" y2="16"></line>
								</svg>
								Retry
							{/if}
						</button>
						{#if cliInstallStatus === 'success'}
							<span class="text-[12px] text-(--color-fg-muted)">Run <code class="bg-(--color-canvas-subtle) px-1 py-px rounded-[3px] [font-family:'SF_Mono',Monaco,Consolas,monospace] text-[11px]">marko &lt;file&gt;</code> in your terminal</span>
						{/if}
					</div>
					{#if cliInstallStatus === 'error' && cliErrorMessage}
						<p class="text-[12px] text-[#dc3545] mt-1 mb-0">{cliErrorMessage}</p>
					{/if}
				</div>
			</div>
		</div>
	</div>
{/if}
