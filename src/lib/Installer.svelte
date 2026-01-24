<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';
	import { getCurrentWindow } from '@tauri-apps/api/window';
	import iconUrl from '../assets/icon.png';

	let installing = $state(false);
	let error = $state('');

	let allUsers = $state(false);
	let registerMd = $state(true);
	let desktopShortcut = $state(true);
	let startMenu = $state(true);
	let launchAfter = $state(true);

	const appWindow = getCurrentWindow();

	async function handleInstall() {
		installing = true;
		error = '';
		try {
			await invoke('install_app', {
				allUsers,
				registerMd,
				desktopShortcut,
				startMenu,
				launchAfter,
			});
			// App will restart automatically via Rust logic
		} catch (e: any) {
			error = e.toString();
			installing = false;
			if (error.includes('Access is denied') && allUsers) {
				error = "Access denied. Please run as Administrator for 'All Users' installation.";
			}
		}
	}

	async function closeApp() {
		await appWindow.close();
	}
</script>

<div class="installer-container" data-tauri-drag-region>
	<div class="window-controls">
		<button class="control-btn close-btn" onclick={closeApp} aria-label="Close">
			<svg width="12" height="12" viewBox="0 0 12 12"><path fill="currentColor" d="M11 1.7L10.3 1 6 5.3 1.7 1 1 1.7 5.3 6 1 10.3 1.7 11 6 6.7 10.3 11 11 10.3 6.7 6z" /></svg>
		</button>
	</div>

	<div class="content">
		<div class="header">
			<img src={iconUrl} alt="App Icon" class="app-icon" />
			<h1>Markdown Viewer</h1>
			<p class="subtitle">A simple markdown viewer</p>
		</div>

		{#if !installing}
			<div class="setup-box">
				<div class="scope-toggle">
					<button class:active={!allUsers} onclick={() => (allUsers = false)}>Just Me</button>
					<button class:active={allUsers} onclick={() => (allUsers = true)}>All Users</button>
				</div>

				<div class="options-container">
					<div class="options">
						<label class="checkbox-container">
							<input type="checkbox" bind:checked={registerMd} />
							<span class="checkmark"></span>
							Register as default for .md files
						</label>
						<label class="checkbox-container">
							<input type="checkbox" bind:checked={desktopShortcut} />
							<span class="checkmark"></span>
							Create desktop shortcut
						</label>
						<label class="checkbox-container">
							<input type="checkbox" bind:checked={startMenu} />
							<span class="checkmark"></span>
							Add to Start Menu
						</label>
						<label class="checkbox-container">
							<input type="checkbox" bind:checked={launchAfter} />
							<span class="checkmark"></span>
							Launch after installation
						</label>
					</div>
				</div>

				<div class="error-container">
					{#if error}
						<div class="error-msg">{error}</div>
					{/if}
				</div>

				<div class="actions">
					<button class="install-btn" onclick={handleInstall}>
						Install {allUsers ? 'for All Users' : 'Now'}
					</button>
				</div>

				<div class="notice-container">
					{#if allUsers}
						<p class="admin-notice">Requires Administrator privileges</p>
					{/if}
				</div>
			</div>
		{:else}
			<div class="installing-state">
				<div class="spinner"></div>
				<p>Installing Markdown Viewer...</p>
			</div>
		{/if}
	</div>
</div>

<style>
	.installer-container {
		height: 100vh;
		width: 100%;
		display: flex;
		flex-direction: column;
		color: var(--color-fg-default);
		font-family: var(--win-font);
		box-sizing: border-box;
		overflow: hidden;
	}

	.window-controls {
		display: flex;
		justify-content: flex-end;
		padding: 4px;
		position: absolute;
		top: 0;
		right: 0;
		z-index: 10;
	}

	.control-btn {
		width: 46px;
		height: 32px;
		display: flex;
		justify-content: center;
		align-items: center;
		background: transparent;
		border: none;
		color: var(--color-fg-default);
		cursor: pointer;
		transition: all 0.1s;
	}

	.close-btn:hover {
		background: #e81123 !important;
		color: white;
	}

	.content {
		flex: 1;
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: center;
		padding: 40px;
	}

	.header {
		text-align: center;
		margin-bottom: 30px;
	}

	.app-icon {
		width: 70px;
		height: 70px;
		margin-bottom: 12px;
		filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.1));
	}

	h1 {
		margin: 0;
		font-size: 22px;
		font-weight: 600;
		letter-spacing: -0.02em;
	}

	.subtitle {
		margin: 4px 0 0;
		opacity: 0.6;
		font-size: 13px;
	}

	.setup-box {
		width: 100%;
		max-width: 300px;
		animation: slideUp 0.4s cubic-bezier(0.1, 0.9, 0.2, 1);
	}

	.scope-toggle {
		display: flex;
		background: var(--color-canvas-subtle);
		border: 1px solid var(--color-border-default);
		padding: 3px;
		border-radius: 20px;
		margin: 0 0 24px 0;
		height: 38px;
		box-sizing: border-box;
	}

	.scope-toggle button {
		flex: 1;
		border: none;
		background: transparent;
		color: var(--color-fg-muted);
		padding: 6px 12px;
		border-radius: 17px;
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
	}

	.scope-toggle button.active {
		background: var(--color-canvas-default);
		color: var(--color-fg-default);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
	}

	.options-container {
		height: 140px; /* Fixed height to prevent layout shift */
		margin-bottom: 10px;
	}

	.options {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.checkbox-container {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 14px;
		cursor: pointer;
		user-select: none;
		opacity: 0.8;
		transition: opacity 0.2s;
	}

	.checkbox-container:hover {
		opacity: 1;
	}

	.checkbox-container input {
		display: none;
	}

	.checkmark {
		width: 18px;
		height: 18px;
		border: 2px solid var(--color-border-default);
		border-radius: 4px;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.2s;
	}

	.checkbox-container input:checked + .checkmark {
		background: var(--color-accent-fg);
		border-color: var(--color-accent-fg);
	}

	.checkbox-container input:checked + .checkmark::after {
		content: '';
		width: 4px;
		height: 8px;
		border: solid white;
		border-width: 0 2px 2px 0;
		transform: rotate(45deg);
		margin-bottom: 2px;
	}

	.error-container {
		height: 44px; /* Fixed space for potential error message */
		display: flex;
		align-items: center;
		justify-content: center;
		margin: 0 0 10px 0;
	}

	.error-msg {
		color: #f85149;
		font-size: 12px;
		text-align: center;
		padding: 8px;
		background: rgba(248, 81, 73, 0.1);
		border-radius: 8px;
		line-height: 1.4;
		width: 100%;
	}

	.actions {
		display: flex;
		justify-content: center;
	}

	.install-btn {
		background: var(--color-accent-fg);
		color: white;
		border: none;
		padding: 10px 40px;
		border-radius: 20px;
		font-weight: 600;
		font-size: 14px;
		cursor: pointer;
		transition:
			transform 0.2s,
			background 0.2s;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
		width: 100%;
	}

	.install-btn:hover {
		background: var(--color-accent-emphasis);
		transform: translateY(-1px);
	}

	.notice-container {
		height: 24px; /* Fixed height for admin notice */
		margin: 12px 0 0 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.admin-notice {
		font-size: 11px;
		opacity: 0.5;
		text-align: center;
		margin: 0;
	}

	.installing-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 20px;
	}

	.spinner {
		width: 40px;
		height: 40px;
		border: 3px solid var(--color-border-muted);
		border-top-color: var(--color-accent-fg);
		border-radius: 50%;
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@keyframes slideUp {
		from {
			opacity: 0;
			transform: translateY(10px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
