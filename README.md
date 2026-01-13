# Markdown Viewer

A simple standalone markdown viewer-only app for Windows 11.

Built with [Tauri](https://tauri.app/) — [Rust](https://www.rust-lang.org) + [SvelteKit](https://kit.svelte.dev/) + [TypeScript](https://www.typescriptlang.org/).

Using GitHub flavored markdown style by [sindresorhus](https://github.com/sindresorhus/generate-github-markdown-css) and rendered with [comrak](https://github.com/kivikakk/comrak).

> [!NOTE]
> ## Changes in v2.0
> - Fixed relative image embeds
> - Added YouTube embed support
> - Added shortcut to edit in Notepad
> - Added recent files on startup
> - Added 'watch' mode to watch the markdown file for changes and update the markdown file in real-time




## Usage

- Download the latest installer from the [releases page](https://github.com/alecames/MarkdownViewer/releases/latest)
- Right click on a markdown file and select "Open with" and select the downloaded or installed executable
- [Optional] Set the executable as the default program to open `.md` files

Alternatively, you can install from source:

- Clone the repository
- Run `npm install` to install dependencies
- Run `npm run tauri build` to build the installer
- Repeat the steps above to set the executable as the default program to open `.md` files

## Screenshots

![alt text](pics/image.png)
![alt text](pics/image2.png)
![alt text](pics/image3.png)
![alt text](pics/image4.png)

## Todo

- [X] Fix relative image embeds
- [X] Add shortcut to edit in default text editor
- [X] Tweak Windows installer to prevent desktop shortcut by default
- [ ] Add option to toggle markdown rendering
- [ ] Add syntax highlighting for code blocks
- [ ] Add file association option for `.md` files in the Windows installer
- [ ] Add tabs