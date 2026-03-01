<script lang="ts">
	import { fade, scale } from 'svelte/transition';

	let {
		show,
		title,
		message,
		kind = 'info',
		showSave = false,
		okOnly = false,
		confirmLabel,
		onconfirm,
		onsave,
		oncancel,
	} = $props<{
		show: boolean;
		title: string;
		message: string;
		kind?: 'info' | 'warning' | 'error';
		showSave?: boolean;
		okOnly?: boolean;
		confirmLabel?: string;
		onconfirm: () => void;
		onsave?: () => void;
		oncancel: () => void;
	}>();

	let modalContent = $state<HTMLDivElement>();
	let previousActiveElement: HTMLElement | null = null;

	$effect(() => {
		if (show) {
			previousActiveElement = document.activeElement as HTMLElement;
			setTimeout(() => {
				const focusable = modalContent?.querySelector('button.primary') as HTMLElement;
				if (focusable) {
					focusable.focus();
				} else {
					modalContent?.focus();
				}
			}, 50);
		} else if (previousActiveElement) {
			previousActiveElement.focus();
		}
	});

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			oncancel();
		}
		if (e.key === 'Enter') {
			e.preventDefault();
			if (showSave && onsave) {
				onsave();
			} else {
				onconfirm();
			}
		}
		if (e.key.toLowerCase() === 'y' && !e.ctrlKey && !e.altKey && !e.metaKey) {
			e.preventDefault();
			onconfirm();
		}
		if (e.key.toLowerCase() === 'n' && !e.ctrlKey && !e.altKey && !e.metaKey) {
			e.preventDefault();
			oncancel();
		}
		if (e.ctrlKey && e.key === 's' && showSave && onsave) {
			e.preventDefault();
			onsave();
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
		oncancel();
	}
</script>

{#if show}
	<div class="fixed inset-0 bg-black/40 flex items-center justify-center z-[30000]" transition:fade={{ duration: 150 }} onclick={handleBackdropClick} role="presentation">
		<div
			class="bg-(--color-canvas-default) border border-(--color-border-default) rounded-[6px] w-[400px] max-w-[90vw] shadow-[0_20px_50px_rgba(0,0,0,0.3)] overflow-hidden [font-family:var(--font-win)]"
			bind:this={modalContent}
			transition:scale={{ duration: 200, start: 0.95 }}
			onclick={(e) => e.stopPropagation()}
			role="dialog"
			aria-modal="true"
			tabindex="-1"
			onkeydown={handleKeydown}>
			<div class="px-6 pt-5 pb-3">
				<h3 class="m-0 text-[16px] font-semibold text-(--color-fg-default)">{title}</h3>
			</div>
			<div class="px-6 pb-6">
				<p class="m-0 text-[14px] leading-[1.5] text-(--color-fg-muted)">{message}</p>
			</div>
			<div class="px-6 py-4 bg-(--color-canvas-subtle) flex items-center justify-end gap-2 border-t border-(--color-border-muted)">
				{#if okOnly}
					<button class="primary px-4 py-1.5 rounded-[6px] text-[14px] font-medium cursor-pointer transition-all duration-100 border border-transparent bg-[#0078d4] text-white hover:brightness-110 [font-family:inherit]" onclick={onconfirm}>OK</button>
				{:else}
					<button class="px-4 py-1.5 rounded-[6px] text-[14px] font-medium cursor-pointer transition-all duration-100 border bg-transparent text-(--color-fg-default) border-(--color-border-default) hover:bg-(--color-neutral-muted) [font-family:inherit]" onclick={oncancel}>Cancel</button>
					<div class="flex-1"></div>
					<button
						class="px-4 py-1.5 rounded-[6px] text-[14px] font-medium cursor-pointer transition-all duration-100 border border-transparent [font-family:inherit] {kind === 'warning' ? 'primary bg-[#d73a49] text-white hover:brightness-110' : 'bg-transparent text-(--color-fg-default) border-(--color-border-default) hover:bg-(--color-neutral-muted)'}"
						onclick={onconfirm}
					>
						{confirmLabel ?? (kind === 'warning' ? "Don't Save" : 'Confirm')}
					</button>
					{#if showSave}
						<button class="primary px-4 py-1.5 rounded-[6px] text-[14px] font-medium cursor-pointer transition-all duration-100 border border-transparent bg-[#0078d4] text-white hover:brightness-110 [font-family:inherit]" onclick={onsave}>Save</button>
					{/if}
				{/if}
			</div>
		</div>
	</div>
{/if}
