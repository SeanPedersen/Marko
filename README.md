
# Marko

A simple, lightweight WYSIWYG Markdown editor for Windows, macOS, and Linux.

## Features

- Tabbed interface
- WYSIWYG Markdown inline editor (CodeMirror)
- Auto-reload
- Free and open-source
- Lightweight native UI
- No telemetry or bloat

## Changelog

See [CHANGELOG.md](CHANGELOG.md)

#### Windows Installer
Automatically configures `.md` file association 

#### Other Platforms & Windows Portable
Right click on a markdown file and select "Open with" and select the downloaded or installed executable

## Installation from source

- Clone the repository
- Run `npm install` to install dependencies
- Run `npm run tauri build` to build the installer
- Repeat the steps above to set the executable as the default program to open `.md` files

## Based on

[MarkPad](https://github.com/alecdotdev/Markpad) by Alec Ames
