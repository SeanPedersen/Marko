<script lang="ts">
	import CodeMirrorEditor from './CodeMirrorEditor.svelte';

	let {
		value = '',
		rawMode = false,
		readonly = false,
		theme = 'system',
		onchange,
		editorWidth = '720px',
		filePath = '',
	} = $props<{
		value?: string;
		rawMode?: boolean;
		readonly?: boolean;
		theme?: 'system' | 'dark' | 'light';
		onchange?: (value: string) => void;
		editorWidth?: string;
		filePath?: string;
	}>();
</script>

{#if rawMode}
	<CodeMirrorEditor
		{value}
		{theme}
		{readonly}
		fileType="text"
		{onchange}
		{editorWidth}
		{filePath}
	/>
{:else}
	<iframe
		title="HTML preview"
		class="flex-1 min-h-0 w-full bg-white border-0"
		sandbox=""
		srcdoc={value}
	></iframe>
{/if}
