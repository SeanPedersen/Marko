# Markpad

A simple, lightweight markdown viewer and editor for Windows. 

MacOS and Linux support coming soon.

Built with [Tauri](https://tauri.app/) — [Rust](https://www.rust-lang.org) + [SvelteKit](https://kit.svelte.dev/) + [TypeScript](https://www.typescriptlang.org/).

Using GitHub flavored markdown style by [sindresorhus](https://github.com/sindresorhus/generate-github-markdown-css) and rendered with [comrak](https://github.com/kivikakk/comrak).

## Changes

See [CHANGELOG.md](CHANGELOG.md)

## Installation

- Download the latest installer from the [releases page](https://github.com/alecames/Markpad/releases/latest)
- Right click on a markdown file and select "Open with" and select the downloaded or installed executable
- [Optional] Set the executable as the default program to open `.md` files

## Installation from source

- Clone the repository
- Run `npm install` to install dependencies
- Run `npm run tauri build` to build the installer
- Repeat the steps above to set the executable as the default program to open `.md` files

## Screenshots

![alt text](pics/image1.png)
![alt text](pics/image2.png)
![alt text](pics/image3.png)
## Todo

- [X] Fix relative image embeds
- [X] Add shortcut to edit in default text editor
- [X] Tweak Windows installer to prevent desktop shortcut by default
- [X] Add tabs
- [X] Add file association option in the installer
- [X] Add syntax highlighting for code blocks
- [X] Integrate Monaco editor
- [ ] Add option to toggle markdown rendering
