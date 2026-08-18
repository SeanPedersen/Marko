export type EditorWidth = 'compact' | 'default' | 'wide' | 'full';
export type SidebarPosition = 'left' | 'right';
export type EditorFont = 'system' | 'sans' | 'serif' | 'mono';

export const EDITOR_WIDTH_VALUES: Record<EditorWidth, string> = {
	compact: '600px',
	default: '720px',
	wide: '900px',
	full: '100%',
};

export const EDITOR_FONT_VALUES: Record<EditorFont, string> = {
	system: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
	sans: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
	serif: 'Georgia, Cambria, "Times New Roman", Times, serif',
	mono: '"SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Consolas, "Courier New", monospace',
};

export const EDITOR_FONT_SIZE_MIN = 13;
export const EDITOR_FONT_SIZE_MAX = 22;
const EDITOR_FONT_SIZE_DEFAULT = 16;

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
	editorFont = $state<EditorFont>('system');
	editorFontSize = $state(EDITOR_FONT_SIZE_DEFAULT);

	constructor() {
		if (typeof localStorage !== 'undefined') {
			const savedShowTabs = localStorage.getItem('editor.showTabs');
			const savedAutoSave = localStorage.getItem('editor.autoSave');
			const savedEditorWidth = localStorage.getItem('editor.editorWidth');
			const savedExplorerWidth = localStorage.getItem('editor.folderExplorerWidth');
			const savedEditorFont = localStorage.getItem('editor.editorFont');
			const savedEditorFontSize = localStorage.getItem('editor.editorFontSize');

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
			if (savedEditorFont !== null && savedEditorFont in EDITOR_FONT_VALUES) {
				this.editorFont = savedEditorFont as EditorFont;
			}
			if (savedEditorFontSize !== null) {
				const parsed = parseInt(savedEditorFontSize, 10);
				if (!isNaN(parsed)) {
					this.editorFontSize = Math.max(EDITOR_FONT_SIZE_MIN, Math.min(EDITOR_FONT_SIZE_MAX, parsed));
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
					localStorage.setItem('editor.editorFont', this.editorFont);
					localStorage.setItem('editor.editorFontSize', String(this.editorFontSize));
					document.documentElement.style.setProperty('--editor-font-family', EDITOR_FONT_VALUES[this.editorFont]);
					document.documentElement.style.setProperty('--editor-font-size', `${this.editorFontSize}px`);
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

	setEditorFont(font: EditorFont) {
		this.editorFont = font;
	}

	setEditorFontSize(size: number) {
		this.editorFontSize = Math.max(EDITOR_FONT_SIZE_MIN, Math.min(EDITOR_FONT_SIZE_MAX, size));
	}
}

export const settings = new SettingsStore();
