export type EditorWidth = 'compact' | 'default' | 'wide' | 'full';
export type SidebarPosition = 'left' | 'right';

export const EDITOR_WIDTH_VALUES: Record<EditorWidth, string> = {
	compact: '600px',
	default: '720px',
	wide: '900px',
	full: '100%',
};

const SIDEBAR_WIDTH_MIN = 160;
const SIDEBAR_WIDTH_MAX = 480;
const SIDEBAR_WIDTH_DEFAULT = 220;

const VALID_POSITIONS: SidebarPosition[] = ['left', 'right'];

function loadPosition(key: string, fallbackKey?: string): SidebarPosition {
	const saved = localStorage.getItem(key);
	if (saved !== null && VALID_POSITIONS.includes(saved as SidebarPosition)) return saved as SidebarPosition;
	if (fallbackKey) {
		const fallback = localStorage.getItem(fallbackKey);
		if (fallback !== null && VALID_POSITIONS.includes(fallback as SidebarPosition)) return fallback as SidebarPosition;
	}
	return 'left';
}

export class SettingsStore {
	showTabs = $state(true);
	autoSave = $state(true);
	editorWidth = $state<EditorWidth>('default');
	explorerPosition = $state<SidebarPosition>('left');
	tocPosition = $state<SidebarPosition>('right');
	folderExplorerWidth = $state(SIDEBAR_WIDTH_DEFAULT);

	constructor() {
		if (typeof localStorage !== 'undefined') {
			const savedShowTabs = localStorage.getItem('editor.showTabs');
			const savedAutoSave = localStorage.getItem('editor.autoSave');
			const savedEditorWidth = localStorage.getItem('editor.editorWidth');
			const savedExplorerWidth = localStorage.getItem('editor.folderExplorerWidth');

			if (savedShowTabs !== null) this.showTabs = savedShowTabs === 'true';
			if (savedAutoSave !== null) this.autoSave = savedAutoSave === 'true';
			if (savedEditorWidth !== null && ['compact', 'default', 'wide', 'full'].includes(savedEditorWidth)) {
				this.editorWidth = savedEditorWidth as EditorWidth;
			}
			// Fall back to legacy 'editor.sidebarPosition' if the new keys haven't been saved yet
			this.explorerPosition = loadPosition('editor.explorerPosition', 'editor.sidebarPosition');
			this.tocPosition = loadPosition('editor.tocPosition');
			if (savedExplorerWidth !== null) {
				const parsed = parseInt(savedExplorerWidth, 10);
				if (!isNaN(parsed)) {
					this.folderExplorerWidth = Math.max(SIDEBAR_WIDTH_MIN, Math.min(SIDEBAR_WIDTH_MAX, parsed));
				}
			}

			$effect.root(() => {
				$effect(() => {
					localStorage.setItem('editor.showTabs', String(this.showTabs));
					localStorage.setItem('editor.autoSave', String(this.autoSave));
					localStorage.setItem('editor.editorWidth', this.editorWidth);
					localStorage.setItem('editor.explorerPosition', this.explorerPosition);
					localStorage.setItem('editor.tocPosition', this.tocPosition);
					localStorage.setItem('editor.folderExplorerWidth', String(this.folderExplorerWidth));
				});
			});
		}
	}

	toggleTabs() {
		this.showTabs = !this.showTabs;
	}

	toggleAutoSave() {
		this.autoSave = !this.autoSave;
	}

	setEditorWidth(width: EditorWidth) {
		this.editorWidth = width;
	}

	setExplorerPosition(position: SidebarPosition) {
		this.explorerPosition = position;
	}

	setTocPosition(position: SidebarPosition) {
		this.tocPosition = position;
	}
}

export const settings = new SettingsStore();
