<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import { invoke } from '@tauri-apps/api/core';
	import { settings, EDITOR_WIDTH_VALUES, type EditorWidth, type SidebarPosition } from '../stores/settings.svelte.js';

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

	const sidebarPositionOptions: { value: SidebarPosition; label: string }[] = [
		{ value: 'left', label: 'Left' },
		{ value: 'right', label: 'Right' },
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
		// Focus trap
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
	<div class="modal-backdrop" transition:fade={{ duration: 150 }} onclick={handleBackdropClick} role="presentation">
		<div
			class="modal-content"
			bind:this={modalContent}
			transition:scale={{ duration: 200, start: 0.95 }}
			onclick={(e) => e.stopPropagation()}
			role="dialog"
			aria-modal="true"
			tabindex="-1"
			onkeydown={handleKeydown}>
			<div class="modal-header">
				<h3>Settings</h3>
				<button class="close-btn" onclick={onclose} aria-label="Close">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<line x1="18" y1="6" x2="6" y2="18"></line>
						<line x1="6" y1="6" x2="18" y2="18"></line>
					</svg>
				</button>
			</div>
			<div class="modal-body">
				<div class="setting-group">
					<div class="setting-label">Editor Width</div>
					<p class="setting-description">Set the maximum width of the text editor content area.</p>
					<div class="segmented-control">
						{#each editorWidthOptions as option}
							<button
								class="segment {settings.editorWidth === option.value ? 'active' : ''}"
								onclick={() => settings.setEditorWidth(option.value)}
								title={option.description}>
								{option.label}
							</button>
						{/each}
					</div>
				</div>

				<div class="setting-group">
					<div class="setting-label">Sidebar Position</div>
					<p class="setting-description">Choose which side of the window to display the sidebar.</p>
					<div class="segmented-control">
						{#each sidebarPositionOptions as option}
							<button
								class="segment {settings.sidebarPosition === option.value ? 'active' : ''}"
								onclick={() => settings.setSidebarPosition(option.value)}>
								{option.label}
							</button>
						{/each}
					</div>
				</div>

				<div class="setting-group">
					<div class="setting-label">Terminal Command</div>
					<p class="setting-description">Install the <code>marko</code> command to open files from the terminal.</p>
					<div class="cli-install-row">
						<button
							class="install-btn {cliInstallStatus}"
							onclick={installCli}
							disabled={cliInstallStatus === 'installing' || cliInstallStatus === 'success'}>
							{#if cliInstallStatus === 'idle'}
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									<polyline points="4 17 10 11 4 5"></polyline>
									<line x1="12" y1="19" x2="20" y2="19"></line>
								</svg>
								Install Command
							{:else if cliInstallStatus === 'installing'}
								<svg class="spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
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
							<span class="cli-hint">Run <code>marko &lt;file&gt;</code> in your terminal</span>
						{/if}
					</div>
					{#if cliInstallStatus === 'error' && cliErrorMessage}
						<p class="error-message">{cliErrorMessage}</p>
					{/if}
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	.modal-backdrop {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.4);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 30000;
	}

	.modal-content {
		background: var(--color-canvas-default);
		border: 1px solid var(--color-border-default);
		border-radius: 8px;
		width: 420px;
		max-width: 90vw;
		max-height: 80vh;
		box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3);
		overflow: hidden;
		font-family: var(--win-font);
		display: flex;
		flex-direction: column;
	}

	.modal-header {
		padding: 16px 20px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		border-bottom: 1px solid var(--color-border-default);
	}

	.modal-header h3 {
		margin: 0;
		font-size: 15px;
		font-weight: 600;
		color: var(--color-fg-default);
	}

	.close-btn {
		background: transparent;
		border: none;
		padding: 4px;
		cursor: pointer;
		color: var(--color-fg-muted);
		border-radius: 4px;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.1s;
	}

	.close-btn:hover {
		background: var(--color-canvas-subtle);
		color: var(--color-fg-default);
	}

	.modal-body {
		padding: 20px;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 24px;
	}

	.setting-group {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.setting-label {
		font-size: 13px;
		font-weight: 600;
		color: var(--color-fg-default);
	}

	.setting-description {
		font-size: 12px;
		color: var(--color-fg-muted);
		margin: 0;
		line-height: 1.4;
	}

	.setting-description code {
		background: var(--color-canvas-subtle);
		padding: 1px 4px;
		border-radius: 3px;
		font-family: 'SF Mono', Monaco, Consolas, monospace;
		font-size: 11px;
	}

	.segmented-control {
		display: flex;
		border: 1px solid var(--color-border-default);
		border-radius: 6px;
		overflow: hidden;
		background: var(--color-canvas-subtle);
	}

	.segment {
		flex: 1;
		padding: 8px 12px;
		border: none;
		background: transparent;
		color: var(--color-fg-muted);
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s;
		font-family: inherit;
		border-right: 1px solid var(--color-border-default);
	}

	.segment:last-child {
		border-right: none;
	}

	.segment:hover:not(.active) {
		background: var(--color-neutral-muted);
		color: var(--color-fg-default);
	}

	.segment.active {
		background: var(--color-canvas-default);
		color: var(--color-accent-fg);
		font-weight: 600;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
	}

	.cli-install-row {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.install-btn {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 8px 16px;
		border-radius: 6px;
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s;
		font-family: inherit;
		border: 1px solid var(--color-border-default);
		background: var(--color-canvas-subtle);
		color: var(--color-fg-default);
	}

	.install-btn:hover:not(:disabled) {
		background: var(--color-neutral-muted);
	}

	.install-btn:disabled {
		cursor: default;
		opacity: 0.7;
	}

	.install-btn.success {
		background: #d4edda;
		border-color: #28a745;
		color: #155724;
	}

	.install-btn.error {
		border-color: #dc3545;
	}

	.cli-hint {
		font-size: 12px;
		color: var(--color-fg-muted);
	}

	.cli-hint code {
		background: var(--color-canvas-subtle);
		padding: 1px 4px;
		border-radius: 3px;
		font-family: 'SF Mono', Monaco, Consolas, monospace;
		font-size: 11px;
	}

	.error-message {
		font-size: 12px;
		color: #dc3545;
		margin: 4px 0 0 0;
	}

	.spinner {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		from { transform: rotate(0deg); }
		to { transform: rotate(360deg); }
	}
</style>
