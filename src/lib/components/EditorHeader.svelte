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
        oncommitandpush,
        isKanban = false,
        isHtml = false,
        rawMode = false,
        ontogglerawmode,
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
        oncommitandpush?: (message: string) => Promise<void>;
        isKanban?: boolean;
        isHtml?: boolean;
        rawMode?: boolean;
        ontogglerawmode?: () => void;
    }>();

    let commitInputVisible = $state(false);
    let commitMessage = $state("");
    let commitInputEl = $state<HTMLInputElement | null>(null);
    let commitAndPush = $state(false);
    let isPushing = $state(false);

    function gitBadge(status: string): { letter: string; color: string } {
        switch (status) {
            case "modified":
            case "staged_modified":
                return { letter: "M", color: "#d29922" };
            case "staged":
                return { letter: "A", color: "#3fb950" };
            case "untracked":
                return { letter: "U", color: "#3fb950" };
            case "deleted":
                return { letter: "D", color: "#f85149" };
            case "conflicted":
                return { letter: "C", color: "#f85149" };
            case "renamed":
                return { letter: "R", color: "#3fb950" };
            default:
                return { letter: "?", color: "inherit" };
        }
    }

    function handleCommitClick() {
        commitAndPush = false;
        commitInputVisible = true;
        commitMessage = "";
        requestAnimationFrame(() => commitInputEl?.focus());
    }

    function handleCommitAndPushClick() {
        commitAndPush = true;
        commitInputVisible = true;
        commitMessage = "";
        requestAnimationFrame(() => commitInputEl?.focus());
    }

    async function submitCommit() {
        const msg = commitMessage.trim();
        if (!msg) return;
        commitInputVisible = false;
        commitMessage = "";
        if (commitAndPush && oncommitandpush) {
            isPushing = true;
            try {
                await oncommitandpush(msg);
            } finally {
                isPushing = false;
            }
        } else {
            oncommit?.(msg);
        }
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

    let displayPath = $derived.by(
        (): { root: string; dir: string; filename: string } | null => {
            if (!filePath) return null;

            const parts = filePath.split(/[/\\]/);
            const filename = parts[parts.length - 1];

            if (folderPath && filePath.startsWith(folderPath)) {
                const folderParts = folderPath.split(/[/\\]/);
                const root = folderParts[folderParts.length - 1] || "";
                const relativePath = filePath
                    .slice(folderPath.length)
                    .replace(/^[/\\]/, "");
                const relParts = relativePath.split(/[/\\]/);
                if (relParts.length > 1) {
                    const dirParts = relParts.slice(0, -1);
                    const collapsedDir = dirParts
                        .map((part: string, index: number) => {
                            return index === dirParts.length - 1
                                ? part
                                : part.charAt(0);
                        })
                        .join("/");
                    return { root, dir: collapsedDir, filename };
                }
                return { root, dir: "", filename };
            }

            if (parts.length > 1) {
                const dirParts = parts.slice(0, -1);
                const collapsedDir = dirParts
                    .map((part: string, index: number) => {
                        return index === dirParts.length - 1
                            ? part
                            : part.charAt(0);
                    })
                    .join("/");
                return { root: "", dir: collapsedDir, filename };
            }

            return { root: "", dir: "", filename };
        },
    );
</script>

<div class="bg-(--color-canvas-default) border-b border-(--color-border-default) shrink-0 px-8">
    <div class="flex items-center gap-3 py-[2px] min-h-[28px] mx-auto" style="max-width: var(--editor-max-width, 720px); --editor-max-width: {editorWidth};">
        {#if showTocButton}
            <button
                class="btn-icon {tocVisible ? 'bg-(--color-canvas-subtle) text-(--color-accent-fg)' : ''}"
                onclick={ontoggleToc}
                title="Toggle Table of Contents"
            >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
                    <path d="M2 3h12M2 7h8M2 11h10" />
                </svg>
            </button>
        {/if}
        <div class="flex gap-0.5">
            <button
                class="btn-icon {!canGoBack ? 'opacity-35 cursor-default' : ''}"
                onclick={ongoback}
                disabled={!canGoBack}
                title="Go back"
            >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M10 12L6 8L10 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
            </button>
            <button
                class="btn-icon {!canGoForward ? 'opacity-35 cursor-default' : ''}"
                onclick={ongoforward}
                disabled={!canGoForward}
                title="Go forward"
            >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M6 4L10 8L6 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
            </button>
        </div>

        {#if onopenFileLocation}
            <button class="btn-icon" onclick={onopenFileLocation} title="Open file location">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                    ><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path
                    ><polyline points="15 13 18 13 18 10"></polyline
                    ><line x1="14" y1="14" x2="18" y2="10"></line></svg>
            </button>
        {/if}

        {#if displayPath}
            <div class="flex items-center gap-0 [font-family:'Monaco','Menlo','Ubuntu_Mono','SF_Mono','JetBrains_Mono','Fira_Code',monospace] text-[12px] text-(--color-fg-muted) overflow-hidden text-ellipsis whitespace-nowrap flex-1 min-w-0 leading-[1.2] tracking-[0.025em]">
                {#if displayPath.root}<span class="text-(--color-accent-fg) font-semibold opacity-90">{displayPath.root}</span><span class="text-(--color-fg-muted) opacity-80 font-normal px-[3px]">/</span>{/if}{#if displayPath.dir}<span class="text-(--color-fg-muted) opacity-80">{displayPath.dir}</span><span class="text-(--color-fg-muted) opacity-80 font-normal px-[3px]">/</span>{/if}<span class="text-(--color-fg-default) font-semibold opacity-95">{displayPath.filename}</span>{#if gitStatus}{@const badge = gitBadge(gitStatus)}<span class="text-[10px] font-bold [font-family:'SF_Mono','Monaco','Menlo',monospace] ml-1.5 shrink-0" style="color: {badge.color};" title="Git: {gitStatus}">{badge.letter}</span>{/if}
            </div>
        {/if}

        {#if (isKanban || isHtml) && ontogglerawmode}
            {@const renderedLabel = isHtml ? 'Preview' : 'Board'}
            {@const rawTitle = isHtml ? 'Edit raw HTML' : 'Edit raw markdown'}
            {@const renderedTitle = isHtml ? 'Show rendered preview' : 'Show board view'}
            <button
                class="text-[11px] px-2 py-[2px] border rounded-[4px] bg-(--color-canvas-subtle) text-(--color-fg-muted) cursor-pointer shrink-0 transition-[background,color,border-color] duration-100 leading-5 hover:bg-(--color-accent-fg) hover:text-white hover:border-(--color-accent-fg) {rawMode ? 'bg-(--color-accent-fg) text-white border-(--color-accent-fg)' : 'border-(--color-border-default)'}"
                onclick={ontogglerawmode}
                title={rawMode ? renderedTitle : rawTitle}
            >
                {rawMode ? renderedLabel : 'Raw'}
            </button>
        {/if}

        {#if gitStatus && oncommit}
            {#if isPushing}
                <div class="flex items-center justify-center w-[26px] h-[26px] shrink-0 text-[#3fb950]" title="Pushing…">
                    <svg class="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                        <circle cx="12" cy="12" r="10" stroke-opacity="0.25" />
                        <path d="M12 2a10 10 0 0 1 10 10" />
                    </svg>
                </div>
            {:else if commitInputVisible}
                <div class="flex items-center gap-1 shrink-0 max-w-[220px]">
                    <input
                        bind:this={commitInputEl}
                        bind:value={commitMessage}
                        onkeydown={handleCommitKeydown}
                        class="w-[160px] border border-(--color-border-default) bg-(--color-canvas-subtle) text-(--color-fg-default) text-[11px] [font-family:inherit] py-[3px] px-2 rounded-[4px] outline-none focus:border-(--color-accent-fg) placeholder:text-(--color-fg-muted) placeholder:opacity-60"
                        type="text"
                        placeholder="Commit message..."
                        spellcheck="false"
                    />
                    <button
                        class="btn-icon text-[#3fb950] disabled:opacity-30 disabled:cursor-default"
                        onclick={submitCommit}
                        title="Commit"
                        disabled={!commitMessage.trim()}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                        </svg>
                    </button>
                </div>
            {:else}
                {#if onrevert && gitStatus !== "untracked"}
                    <button
                        class="btn-icon hover:text-[#f85149]"
                        onclick={onrevert}
                        title="Revert changes"
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6.69 3L3 13" />
                        </svg>
                    </button>
                {/if}
                <button
                    class="btn-icon text-[#3fb950] hover:text-[#2ea043]"
                    onclick={handleCommitClick}
                    title="Commit this file"
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                    </svg>
                </button>
                {#if oncommitandpush}
                    <button
                        class="btn-icon text-[#3fb950] hover:text-[#2ea043]"
                        onclick={handleCommitAndPushClick}
                        title="Commit and push this file"
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="12" y1="19" x2="12" y2="5" />
                            <polyline points="5 12 12 5 19 12" />
                        </svg>
                    </button>
                {/if}
            {/if}
        {/if}
    </div>
</div>
