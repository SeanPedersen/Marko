export interface Tab {
	id: string;
	path: string;
	title: string;
	content: string;
	rawContent: string;
	originalContent: string;
	scrollTop: number;
	isDirty: boolean;
	isEditing: boolean;
	isRenaming: boolean;
	history: string[];
	historyIndex: number;
	scrollPercentage: number;
	anchorLine: number;
	editorViewState?: unknown;
	isSplit?: boolean;
	isDeleted?: boolean;
}

const HOME_TAB_ID = 'home-tab';

const HOME_TAB: Tab = {
	id: HOME_TAB_ID,
	path: 'HOME',
	title: 'Home',
	content: '',
	rawContent: '',
	originalContent: '',
	scrollTop: 0,
	isDirty: false,
	isEditing: false,
	isRenaming: false,
	history: [],
	historyIndex: -1,
	scrollPercentage: 0,
	anchorLine: 0,
	editorViewState: null,
	isSplit: false,
};

class TabManager {
	tabs = $state<Tab[]>([{ ...HOME_TAB }]);
	activeTabId = $state<string | null>(HOME_TAB_ID);

	get activeTab() {
		return this.tabs.find((t) => t.id === this.activeTabId);
	}

	addTab(path: string, content: string = '') {
		const id = crypto.randomUUID();
		const filename = path.split('\\').pop()?.split('/').pop() || 'Untitled';

		this.tabs.push({
			id,
			path,
			title: filename,
			content,
			rawContent: content,
			originalContent: content,
			scrollTop: 0,
			isDirty: false,
			isEditing: true,
			isRenaming: false,
			history: [path], // Store paths, not content
			historyIndex: 0,
			scrollPercentage: 0,
			anchorLine: 0,
			editorViewState: null,
			isSplit: false,
		});

		this.activeTabId = id;
	}

	addNewTab() {
		const id = crypto.randomUUID();
		const content = '';
		const title = this.nextUntitledName();

		this.tabs.push({
			id,
			path: '',
			title,
			content,
			rawContent: content,
			originalContent: content,
			scrollTop: 0,
			isDirty: false,
			isEditing: true,
			isRenaming: false,
			history: [], // Empty path means no history yet
			historyIndex: -1,
			scrollPercentage: 0,
			anchorLine: 0,
			editorViewState: null,
			isSplit: false,
		});

		this.activeTabId = id;
	}

	private nextUntitledName(): string {
		const existing = new Set(
			this.tabs
				.filter((t) => t.title === 'Untitled' || /^Untitled \d+$/.test(t.title))
				.map((t) => t.title)
		);

		if (!existing.has('Untitled')) return 'Untitled';

		for (let i = 1; ; i++) {
			const candidate = `Untitled ${i}`;
			if (!existing.has(candidate)) return candidate;
		}
	}

	navigateHome() {
		this.activeTabId = HOME_TAB_ID;
	}

	closeTab(id: string) {
		const index = this.tabs.findIndex((t) => t.id === id);
		if (index === -1) return;

		const tab = this.tabs[index];
		if (tab.path === 'HOME') return; // HOME tab cannot be closed

		if (this.activeTabId === id) {
			const fallback = this.tabs[index + 1] || this.tabs[index - 1];
			this.activeTabId = fallback ? fallback.id : null;
		}

		if (tab.path) {
			this.recentlyClosed.push(tab.path);
		}
		this.tabs.splice(index, 1);
	}

	closeAll() {
		const homeTab = this.tabs.find(t => t.path === 'HOME') ?? { ...HOME_TAB };
		const closedPaths = this.tabs.filter(t => t.path && t.path !== 'HOME').map(t => t.path);
		this.recentlyClosed.push(...closedPaths);
		this.tabs = [homeTab];
		this.activeTabId = homeTab.id;
	}

	setActive(id: string) {
		this.activeTabId = id;
	}

	updateTabContent(id: string, content: string) {
		const tab = this.tabs.find((t) => t.id === id);
		if (tab) {
			tab.content = content;
		}
	}

	updateTabRawContent(id: string, raw: string) {
		const tab = this.tabs.find((t) => t.id === id);
		if (tab) {
			tab.rawContent = raw;
			tab.isDirty = tab.rawContent !== tab.originalContent;
		}
	}

	setTabRawContent(id: string, raw: string) {
		const tab = this.tabs.find((t) => t.id === id);
		if (tab) {
			tab.rawContent = raw;
			tab.originalContent = raw;
			tab.isDirty = false;
		}
	}

	updateTabScroll(id: string, scrollTop: number) {
		const tab = this.tabs.find((t) => t.id === id);
		if (tab) {
			tab.scrollTop = scrollTop;
		}
	}

	updateTabScrollPercentage(id: string, percentage: number) {
		const tab = this.tabs.find((t) => t.id === id);
		if (tab) {
			tab.scrollPercentage = percentage;
		}
	}

	updateTabAnchorLine(id: string, line: number) {
		const tab = this.tabs.find((t) => t.id === id);
		if (tab) {
			tab.anchorLine = line;
		}
	}

	updateTabEditorState(id: string, state: unknown) {
		const tab = this.tabs.find((t) => t.id === id);
		if (tab) {
			tab.editorViewState = state;
		}
	}

	toggleSplit(id: string) {
		const tab = this.tabs.find((t) => t.id === id);
		if (tab) {
			tab.isSplit = !tab.isSplit;
		}
	}

	reorderTabs(fromIndex: number, toIndex: number) {
		if (fromIndex === toIndex) return;
		if (fromIndex === 0 || toIndex === 0) return; // HOME tab stays at index 0
		const [moved] = this.tabs.splice(fromIndex, 1);
		this.tabs.splice(toIndex, 0, moved);
	}

	cycleTab(direction: 'next' | 'prev') {
		if (this.tabs.length < 2) return;
		const currentIndex = this.tabs.findIndex(t => t.id === this.activeTabId);
		if (currentIndex === -1) return;

		let nextIndex: number;
		if (direction === 'next') {
			nextIndex = (currentIndex + 1) % this.tabs.length;
		} else {
			nextIndex = (currentIndex - 1 + this.tabs.length) % this.tabs.length;
		}
		this.activeTabId = this.tabs[nextIndex].id;
	}

	updateTabPath(id: string, path: string) {
		const tab = this.tabs.find((t) => t.id === id);
		if (tab) {
			tab.path = path;
			tab.title = path.split(/[/\\]/).pop() || 'Untitled';
			tab.isDirty = false;
			// If we update path (e.g. save untitled), update or initialize history
			if (tab.history.length > 0 && tab.historyIndex >= 0) {
				tab.history[tab.historyIndex] = path;
			} else {
				tab.history = [path];
				tab.historyIndex = 0;
			}
		}
	}

	renameTab(id: string, newPath: string) {
		const tab = this.tabs.find((t) => t.id === id);
		if (tab) {
			tab.path = newPath;
			tab.title = newPath.split(/[/\\]/).pop() || 'Untitled';
			if (tab.history.length > 0) {
				tab.history[tab.historyIndex] = newPath;
			}
		}
	}

	// Navigation History
	navigate(id: string, path: string) {
		const tab = this.tabs.find(t => t.id === id);
		if (tab) {
			// If we are "navigating" to the same path, do nothing (or reload?)
			if (tab.path === path) return;

			// Truncate forward history
			tab.history = tab.history.slice(0, tab.historyIndex + 1);
			tab.history.push(path);
			tab.historyIndex++;

			tab.path = path;
			tab.title = path.split(/[/\\]/).pop() || 'Untitled';
			tab.isDirty = false;
			tab.scrollTop = 0;
		}
	}

	canGoBack(id: string): boolean {
		const tab = this.tabs.find(t => t.id === id);
		return tab ? tab.historyIndex > 0 : false;
	}

	canGoForward(id: string): boolean {
		const tab = this.tabs.find(t => t.id === id);
		return tab ? tab.historyIndex < tab.history.length - 1 : false;
	}

	goBack(id: string): string | null {
		const tab = this.tabs.find(t => t.id === id);
		if (tab && tab.historyIndex > 0) {
			tab.historyIndex--;
			const path = tab.history[tab.historyIndex];
			tab.path = path;
			tab.title = path.split(/[/\\]/).pop() || 'Untitled';
			tab.isDirty = false; // Assuming navigating away discards unsaved changes or we handle it? 
			// Ideally we should warn before navigation if dirty, but simple history for now.
			return path;
		}
		return null;
	}

	goForward(id: string): string | null {
		const tab = this.tabs.find(t => t.id === id);
		if (tab && tab.historyIndex < tab.history.length - 1) {
			tab.historyIndex++;
			const path = tab.history[tab.historyIndex];
			tab.path = path;
			tab.title = path.split(/[/\\]/).pop() || 'Untitled';
			tab.isDirty = false;
			return path;
		}
		return null;
	}

	// Rename methods
	startRenaming(id: string) {
		const tab = this.tabs.find((t) => t.id === id);
		if (tab && tab.path !== 'HOME') {
			tab.isRenaming = true;
		}
	}

	cancelRenaming(id: string) {
		const tab = this.tabs.find((t) => t.id === id);
		if (tab) {
			tab.isRenaming = false;
		}
	}

	commitRenameTitle(id: string, newTitle: string) {
		const tab = this.tabs.find((t) => t.id === id);
		if (tab) {
			tab.isRenaming = false;
			if (newTitle.trim()) {
				tab.title = newTitle.trim();
			}
		}
	}

	// Close other tabs (keep only the specified tab + HOME)
	closeOthers(id: string) {
		const tabToKeep = this.tabs.find((t) => t.id === id);
		if (!tabToKeep) return;

		const homeTab = this.tabs.find(t => t.path === 'HOME') ?? { ...HOME_TAB };
		const closedPaths = this.tabs
			.filter((t) => t.id !== id && t.path && t.path !== 'HOME')
			.map((t) => t.path);
		this.recentlyClosed.push(...closedPaths);

		this.tabs = tabToKeep.path === 'HOME' ? [homeTab] : [homeTab, tabToKeep];
		this.activeTabId = id;
	}

	// Close tabs to the right of the specified tab
	closeToRight(id: string) {
		const index = this.tabs.findIndex((t) => t.id === id);
		if (index === -1) return;

		const closedPaths = this.tabs
			.slice(index + 1)
			.filter((t) => t.path && t.path !== 'HOME')
			.map((t) => t.path);
		this.recentlyClosed.push(...closedPaths);

		this.tabs = this.tabs.slice(0, index + 1);
		if (!this.tabs.find((t) => t.id === this.activeTabId)) {
			this.activeTabId = id;
		}
	}

	recentlyClosed = $state<string[]>([]);

	popRecentlyClosed() {
		return this.recentlyClosed.pop();
	}
}

export const tabManager = new TabManager();
