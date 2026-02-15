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
        gitStatus,
        oncommit,
        onrevert,
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
        gitStatus?: string | null;
        oncommit?: (message: string) => void;
        onrevert?: () => void;
    }>();

    let commitInputVisible = $state(false);
    let commitMessage = $state("");
    let commitInputEl = $state<HTMLInputElement | null>(null);

    function gitBadge(status: string): { letter: string; cssClass: string } {
        switch (status) {
            case "modified":
            case "staged_modified":
                return { letter: "M", cssClass: "git-modified" };
            case "staged":
                return { letter: "A", cssClass: "git-staged" };
            case "untracked":
                return { letter: "U", cssClass: "git-untracked" };
            case "deleted":
                return { letter: "D", cssClass: "git-deleted" };
            case "conflicted":
                return { letter: "C", cssClass: "git-conflicted" };
            case "renamed":
                return { letter: "R", cssClass: "git-staged" };
            default:
                return { letter: "?", cssClass: "" };
        }
    }

    function handleCommitClick() {
        commitInputVisible = true;
        commitMessage = "";
        requestAnimationFrame(() => commitInputEl?.focus());
    }

    function submitCommit() {
        const msg = commitMessage.trim();
        if (!msg || !oncommit) return;
        oncommit(msg);
        commitInputVisible = false;
        commitMessage = "";
    }

    function handleCommitKeydown(e: KeyboardEvent) {
        if (e.key === "Enter") {
            e.preventDefault();
            submitCommit();
        } else if (e.key === "Escape") {
            commitInputVisible = false;
            commitMessage = "";
        }
    }

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
                    // Collapse directory names to first character, but keep full filename
                    const dirParts = relParts.slice(0, -1);
                    const collapsedDir = dirParts
                        .map((part: string, index: number) => {
                            // Keep the last directory in the relative path full
                            return index === dirParts.length - 1
                                ? part
                                : part.charAt(0);
                        })
                        .join(" / ");
                    return { root, dir: collapsedDir, filename };
                }
                return { root, dir: "", filename };
            }

            // Otherwise show full absolute path minus filename
            if (parts.length > 1) {
                const dirParts = parts.slice(0, -1);
                // Collapse all directory names to first character
                const collapsedDir = dirParts
                    .map((part: string, index: number) => {
                        // Keep the last directory in the absolute path full
                        return index === dirParts.length - 1
                            ? part
                            : part.charAt(0);
                    })
                    .join(" / ");
                return { root: "", dir: collapsedDir, filename };
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
                <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                >
                    <path d="M2 3h12M2 7h8M2 11h10" />
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
                <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    ><path
                        d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
                    ></path><polyline points="15 13 18 13 18 10"
                    ></polyline><line x1="14" y1="14" x2="18" y2="10"
                    ></line></svg
                >
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
                {#if gitStatus}
                    {@const badge = gitBadge(gitStatus)}
                    <span
                        class="git-status-badge {badge.cssClass}"
                        title="Git: {gitStatus}">{badge.letter}</span
                    >
                {/if}
            </div>
        {/if}

        {#if gitStatus && oncommit}
            {#if commitInputVisible}
                <div class="commit-input-wrapper">
                    <input
                        bind:this={commitInputEl}
                        bind:value={commitMessage}
                        onkeydown={handleCommitKeydown}
                        class="commit-input"
                        type="text"
                        placeholder="Commit message..."
                        spellcheck="false"
                    />
                    <button
                        class="commit-submit"
                        onclick={submitCommit}
                        title="Commit"
                        disabled={!commitMessage.trim()}
                    >
                        <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2.5"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        >
                            <polyline points="20 6 9 17 4 12" />
                        </svg>
                    </button>
                </div>
            {:else}
                {#if onrevert && gitStatus !== "untracked"}
                    <button
                        class="revert-button"
                        onclick={onrevert}
                        title="Revert changes"
                    >
                        <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        >
                            <path d="M3 7v6h6" /><path
                                d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6.69 3L3 13"
                            />
                        </svg>
                    </button>
                {/if}
                <button
                    class="commit-button"
                    onclick={handleCommitClick}
                    title="Commit this file"
                >
                    <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    >
                        <polyline points="20 6 9 17 4 12" />
                    </svg>
                </button>
            {/if}
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
        font-family:
            "Monaco", "Menlo", "Ubuntu Mono", "SF Mono", "JetBrains Mono",
            "Fira Code", monospace;
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

    .git-status-badge {
        font-size: 10px;
        font-weight: 700;
        font-family: "SF Mono", "Monaco", "Menlo", monospace;
        margin-left: 6px;
        flex-shrink: 0;
    }

    .git-status-badge.git-modified {
        color: #d29922;
    }
    .git-status-badge.git-staged {
        color: #3fb950;
    }
    .git-status-badge.git-untracked {
        color: #3fb950;
    }
    .git-status-badge.git-deleted {
        color: #f85149;
    }
    .git-status-badge.git-conflicted {
        color: #f85149;
    }

    .commit-button {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 26px;
        height: 26px;
        border: none;
        background: transparent;
        border-radius: 4px;
        color: #3fb950;
        cursor: pointer;
        flex-shrink: 0;
        transition:
            background-color 0.1s,
            color 0.1s;
    }

    .commit-button:hover {
        background: var(--color-neutral-muted);
        color: #2ea043;
    }

    .commit-input-wrapper {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-shrink: 0;
        max-width: 220px;
    }

    .commit-input {
        width: 160px;
        border: 1px solid var(--color-border-default);
        background: var(--color-canvas-subtle);
        color: var(--color-fg-default);
        font-size: 11px;
        font-family: inherit;
        padding: 3px 8px;
        border-radius: 4px;
        outline: none;
    }

    .commit-input:focus {
        border-color: var(--color-accent-fg);
    }

    .commit-input::placeholder {
        color: var(--color-fg-muted);
        opacity: 0.6;
    }

    .commit-submit {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 26px;
        height: 26px;
        border: none;
        background: transparent;
        border-radius: 4px;
        color: #3fb950;
        cursor: pointer;
        flex-shrink: 0;
        transition:
            background-color 0.1s,
            opacity 0.1s;
    }

    .commit-submit:hover:not(:disabled) {
        background: var(--color-neutral-muted);
    }

    .commit-submit:disabled {
        opacity: 0.3;
        cursor: default;
    }

    .revert-button {
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
        flex-shrink: 0;
        transition:
            background-color 0.1s,
            color 0.1s;
    }

    .revert-button:hover {
        background: var(--color-neutral-muted);
        color: #f85149;
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
        transition:
            background-color 0.1s,
            color 0.1s;
    }

    .open-location-button:hover {
        background: var(--color-neutral-muted);
        color: var(--color-fg-default);
    }
</style>
