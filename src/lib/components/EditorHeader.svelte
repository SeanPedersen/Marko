<script lang="ts">
    let {
        filePath = "",
        folderPath = "",
        canGoBack = false,
        canGoForward = false,
        ongoback,
        ongoforward,
        editorWidth = "720px",
        tocVisible = false,
        ontoggleToc,
        showTocButton = false,
        onopenFileLocation,
    } = $props<{
        filePath?: string;
        folderPath?: string;
        canGoBack?: boolean;
        canGoForward?: boolean;
        ongoback?: () => void;
        ongoforward?: () => void;
        editorWidth?: string;
        tocVisible?: boolean;
        ontoggleToc?: () => void;
        showTocButton?: boolean;
        onopenFileLocation?: () => void;
    }>();

    // Extract display path: show relative path from folder, or just filename
    let displayPath = $derived.by(
        (): { root: string; dir: string; filename: string } | null => {
            if (!filePath) return null;

            // Get filename
            const parts = filePath.split(/[/\\]/);
            const filename = parts[parts.length - 1];

            // If we have a folder and file is inside it, show folder name + relative path
            if (folderPath && filePath.startsWith(folderPath)) {
                const folderParts = folderPath.split(/[/\\]/);
                const root = folderParts[folderParts.length - 1] || "";
                const relativePath = filePath
                    .slice(folderPath.length)
                    .replace(/^[/\\]/, "");
                // Split into directory path and filename
                const relParts = relativePath.split(/[/\\]/);
                if (relParts.length > 1) {
                    const dir = relParts.slice(0, -1).join(" / ");
                    return { root, dir, filename };
                }
                return { root, dir: "", filename };
            }

            // Otherwise show full absolute path minus filename
            if (parts.length > 1) {
                const dir = parts.slice(0, -1).join(" / ");
                return { root: "", dir, filename };
            }

            return { root: "", dir: "", filename };
        },
    );
</script>

<div class="editor-header">
    <div class="header-content" style="--editor-max-width: {editorWidth};">
        {#if showTocButton}
            <button
                class="toc-button {tocVisible ? 'active' : ''}"
                onclick={ontoggleToc}
                title="Toggle Table of Contents"
            >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
                    <path d="M2 3h12M2 7h8M2 11h10"/>
                </svg>
            </button>
        {/if}
        <div class="nav-buttons">
            <button
                class="nav-button"
                class:disabled={!canGoBack}
                onclick={ongoback}
                disabled={!canGoBack}
                title="Go back"
            >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path
                        d="M10 12L6 8L10 4"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    />
                </svg>
            </button>
            <button
                class="nav-button"
                class:disabled={!canGoForward}
                onclick={ongoforward}
                disabled={!canGoForward}
                title="Go forward"
            >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path
                        d="M6 4L10 8L6 12"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    />
                </svg>
            </button>
        </div>

        {#if onopenFileLocation}
            <button
                class="open-location-button"
                onclick={onopenFileLocation}
                title="Open file location"
            >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                    ><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path><polyline points="15 13 18 13 18 10"></polyline><line
                            x1="14"
                            y1="14"
                            x2="18"
                            y2="10"></line
                        ></svg>
            </button>
        {/if}

        {#if displayPath}
            <div class="file-path">
                {#if displayPath.root}
                    <span class="path-root">{displayPath.root}</span>
                    <span class="path-separator"> / </span>
                {/if}
                {#if displayPath.dir}
                    <span class="path-dir">{displayPath.dir}</span>
                    <span class="path-separator"> / </span>
                {/if}
                <span class="path-filename">{displayPath.filename}</span>
            </div>
        {/if}
    </div>
</div>

<style>
    .editor-header {
        background: var(--color-canvas-default);
        border-bottom: 1px solid var(--color-border-default);
        flex-shrink: 0;
        padding: 0 2rem;
    }

    .header-content {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 2px 0;
        min-height: 28px;
        max-width: var(--editor-max-width, 720px);
        margin: 0 auto;
    }

    .nav-buttons {
        display: flex;
        gap: 2px;
    }

    .toc-button {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 26px;
        height: 26px;
        border: none;
        background: transparent;
        border-radius: 4px;
        color: var(--color-fg-muted);
        cursor: pointer;
        transition:
            background-color 0.1s,
            color 0.1s;
    }

    .toc-button:hover {
        background: var(--color-neutral-muted);
        color: var(--color-fg-default);
    }

    .toc-button.active {
        background: var(--color-canvas-subtle);
        color: var(--color-accent-fg);
    }

    .nav-button {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 26px;
        height: 26px;
        border: none;
        background: transparent;
        border-radius: 4px;
        color: var(--color-fg-muted);
        cursor: pointer;
        transition:
            background-color 0.1s,
            color 0.1s;
    }

    .nav-button:hover:not(:disabled) {
        background: var(--color-neutral-muted);
        color: var(--color-fg-default);
    }

    .nav-button:active:not(:disabled) {
        background: var(--color-border-default);
    }

    .nav-button.disabled,
    .nav-button:disabled {
        opacity: 0.35;
        cursor: default;
    }

    .file-path {
        display: flex;
        align-items: center;
        gap: 2px;
        font-family: "Monaco", "Menlo", "Ubuntu Mono", "SF Mono", "JetBrains Mono", "Fira Code", monospace;
        font-size: 12px;
        color: var(--color-fg-muted);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
        min-width: 0;
        line-height: 1.2;
        letter-spacing: 0.025em;
    }

    .path-root {
        color: var(--color-accent-fg);
        font-weight: 600;
        opacity: 0.9;
    }

    .path-dir {
        color: var(--color-fg-muted);
        opacity: 0.8;
    }

    .path-separator {
        color: var(--color-border-default);
        opacity: 0.6;
        margin: 0 1px;
        font-weight: 400;
    }

    .path-filename {
        color: var(--color-fg-default);
        font-weight: 600;
        opacity: 0.95;
    }

    .open-location-button {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 26px;
        height: 26px;
        border: none;
        background: transparent;
        border-radius: 4px;
        color: var(--color-fg-muted);
        cursor: pointer;
        transition: background-color 0.1s, color 0.1s;
    }

    .open-location-button:hover {
        background: var(--color-neutral-muted);
        color: var(--color-fg-default);
    }
</style>
