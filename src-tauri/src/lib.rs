use comrak::{markdown_to_html, ComrakExtensionOptions, ComrakOptions};
use git2::{Repository, StatusOptions};
use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use regex::{Captures, Regex};
use serde::Serialize;
use std::borrow::Cow;
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use tauri::menu::ContextMenu;
use tauri::{AppHandle, Emitter, Manager, State};

struct WatcherState {
    watcher: Mutex<Option<RecommendedWatcher>>,
}

struct FolderWatcherState {
    watcher: Mutex<Option<RecommendedWatcher>>,
}

mod setup;

#[tauri::command]
async fn show_window(window: tauri::Window) {
    window.show().unwrap();
}

fn process_obsidian_embeds(content: &str) -> Cow<'_, str> {
    let re = Regex::new(r"!\[\[(.*?)\]\]").unwrap();

    re.replace_all(content, |caps: &Captures| {
        let inner = &caps[1];
        let mut parts = inner.split('|');
        let path = parts.next().unwrap_or("");
        let size = parts.next();

        let path_escaped = path.replace(" ", "%20");

        if let Some(size_str) = size {
            if size_str.contains('x') {
                let mut dims = size_str.split('x');
                let width = dims.next().unwrap_or("");
                let height = dims.next().unwrap_or("");
                format!(
                    "<img src=\"{}\" width=\"{}\" height=\"{}\" alt=\"{}\" />",
                    path_escaped, width, height, path
                )
            } else {
                format!(
                    "<img src=\"{}\" width=\"{}\" alt=\"{}\" />",
                    path_escaped, size_str, path
                )
            }
        } else {
            format!("<img src=\"{}\" alt=\"{}\" />", path_escaped, path)
        }
    })
}

#[tauri::command]
fn convert_markdown(content: &str) -> String {
    let processed = process_obsidian_embeds(content);

    let mut options = ComrakOptions {
        extension: ComrakExtensionOptions {
            strikethrough: true,
            table: true,
            autolink: true,
            tasklist: true,
            superscript: false,
            footnotes: true,
            description_lists: true,
            ..ComrakExtensionOptions::default()
        },
        ..ComrakOptions::default()
    };
    options.render.unsafe_ = true;
    options.render.hardbreaks = true;
    options.render.sourcepos = true;

    markdown_to_html(&processed, &options)
}

#[tauri::command]
fn open_markdown(path: String) -> Result<String, String> {
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    Ok(convert_markdown(&content))
}

#[tauri::command]
fn render_markdown(content: String) -> String {
    convert_markdown(&content)
}

#[tauri::command]
fn read_file_content(path: String) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_file_content(path: String, content: String) -> Result<(), String> {
    fs::write(path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_file_folder(path: String) -> Result<(), String> {
    opener::reveal(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn rename_file(old_path: String, new_path: String) -> Result<(), String> {
    fs::rename(old_path, new_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn trash_file(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(|e| e.to_string())
}

#[derive(Serialize)]
struct DirEntry {
    name: String,
    path: String,
    is_dir: bool,
    modified_at: u64,
}

#[tauri::command]
fn is_directory(path: String) -> bool {
    // Normalize path - remove trailing /. or /./
    let clean_path = path.trim_end_matches("/.");
    Path::new(clean_path).is_dir()
}

#[tauri::command]
fn read_directory(path: String) -> Result<Vec<DirEntry>, String> {
    let dir_path = Path::new(&path);
    if !dir_path.is_dir() {
        return Err("Path is not a directory".to_string());
    }

    let mut entries: Vec<DirEntry> = fs::read_dir(dir_path)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();

            // Skip hidden files/folders (starting with .)
            if name.starts_with('.') {
                return None;
            }

            let modified_at = entry
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);

            Some(DirEntry {
                name,
                path: path.to_string_lossy().to_string(),
                is_dir: path.is_dir(),
                modified_at,
            })
        })
        .collect();

    // Sort: directories first, then files, both alphabetically
    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(entries)
}

#[tauri::command]
fn watch_file(
    handle: AppHandle,
    state: State<'_, WatcherState>,
    path: String,
) -> Result<(), String> {
    let mut watcher_lock = state.watcher.lock().unwrap();

    *watcher_lock = None;

    let path_to_watch = path.clone();
    let app_handle = handle.clone();

    let mut watcher = RecommendedWatcher::new(
        move |res: Result<notify::Event, notify::Error>| {
            if let Ok(_) = res {
                let _ = app_handle.emit("file-changed", ());
            }
        },
        Config::default(),
    )
    .map_err(|e| e.to_string())?;

    watcher
        .watch(Path::new(&path_to_watch), RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;

    *watcher_lock = Some(watcher);

    Ok(())
}

#[tauri::command]
fn unwatch_file(state: State<'_, WatcherState>) -> Result<(), String> {
    let mut watcher_lock = state.watcher.lock().unwrap();
    *watcher_lock = None;
    Ok(())
}

#[tauri::command]
fn watch_folder(
    handle: AppHandle,
    state: State<'_, FolderWatcherState>,
    path: String,
) -> Result<(), String> {
    let mut watcher_lock = state.watcher.lock().unwrap();
    *watcher_lock = None;

    let app_handle = handle.clone();
    let watcher = RecommendedWatcher::new(
        move |res: Result<notify::Event, notify::Error>| {
            if let Ok(_) = res {
                let _ = app_handle.emit("folder-changed", ());
            }
        },
        Config::default(),
    )
    .map_err(|e| e.to_string())?;

    let mut watcher = watcher;
    watcher
        .watch(Path::new(&path), RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    *watcher_lock = Some(watcher);
    Ok(())
}

#[tauri::command]
fn unwatch_folder(state: State<'_, FolderWatcherState>) -> Result<(), String> {
    let mut watcher_lock = state.watcher.lock().unwrap();
    *watcher_lock = None;
    Ok(())
}

struct AppState {
    startup_file: Mutex<Option<String>>,
}

#[tauri::command]
fn send_markdown_path(state: State<'_, AppState>) -> Vec<String> {
    let mut files: Vec<String> = std::env::args()
        .skip(1)
        .filter(|arg| !arg.starts_with("-"))
        .collect();

    if let Some(startup_path) = state.startup_file.lock().unwrap().as_ref() {
        if !files.contains(startup_path) {
            files.insert(0, startup_path.clone());
        }
    }

    files
}

#[tauri::command]
fn save_theme(app: AppHandle, theme: String) -> Result<(), String> {
    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    let theme_path = config_dir.join("theme.txt");
    fs::write(theme_path, theme).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_app_mode() -> String {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|arg| arg == "--uninstall") {
        return "uninstall".to_string();
    }

    let current_exe = std::env::current_exe().unwrap_or_default();
    let exe_name = current_exe
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase();

    let is_installer_mode =
        args.iter().any(|arg| arg == "--install") || exe_name.contains("installer");

    if setup::is_installed() {
        "app".to_string()
    } else {
        if is_installer_mode {
            "installer".to_string()
        } else {
            "app".to_string()
        }
    }
}

#[tauri::command]
fn is_win11() -> bool {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let hklim = RegKey::predef(HKEY_LOCAL_MACHINE);
        if let Ok(current_version) =
            hklim.open_subkey("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion")
        {
            if let Ok(current_build) = current_version.get_value::<String, _>("CurrentBuild") {
                if let Ok(build_num) = current_build.parse::<u32>() {
                    return build_num >= 22000;
                }
            }
        }
    }
    false
}

#[tauri::command]
fn install_cli(_app: AppHandle) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        let app_path = std::env::current_exe().map_err(|e| e.to_string())?;

        let cli_path = Path::new("/usr/local/bin/marko");

        // Create a shell script wrapper
        let script_content = format!(
            r#"#!/bin/bash
# Marko CLI - opens files with Marko markdown editor
if [ $# -eq 0 ]; then
    open -a "Marko"
else
    for arg in "$@"; do
        # Resolve to absolute path and normalize
        if [[ "$arg" = "." ]]; then
            file="$(pwd)"
        elif [[ "$arg" = /* ]]; then
            file="$arg"
        else
            file="$(cd "$(dirname "$arg")" && pwd)/$(basename "$arg")"
        fi
        # Remove trailing /. if present
        file="${{file%/.}}"
        "{}" "$file" &
    done
fi
"#,
            app_path.display()
        );

        // Try to write directly first, then fall back to using osascript for admin rights
        match fs::write(cli_path, &script_content) {
            Ok(_) => {
                // Make executable
                std::process::Command::new("chmod")
                    .args(["+x", "/usr/local/bin/marko"])
                    .output()
                    .map_err(|e| e.to_string())?;
                Ok("CLI installed successfully".to_string())
            }
            Err(_) => {
                // Need elevated permissions - write to temp file first, then use osascript to copy
                let temp_path = "/tmp/marko_cli_script.sh";
                fs::write(temp_path, &script_content).map_err(|e| e.to_string())?;

                let apple_script = r#"do shell script "cp /tmp/marko_cli_script.sh /usr/local/bin/marko && chmod +x /usr/local/bin/marko && rm /tmp/marko_cli_script.sh" with administrator privileges"#;

                let output = std::process::Command::new("osascript")
                    .args(["-e", apple_script])
                    .output()
                    .map_err(|e| e.to_string())?;

                if output.status.success() {
                    Ok("CLI installed successfully".to_string())
                } else {
                    let _ = fs::remove_file(temp_path);
                    Err(String::from_utf8_lossy(&output.stderr).to_string())
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        let app_path = std::env::current_exe().map_err(|e| e.to_string())?;
        let local_app_data = std::env::var("LOCALAPPDATA").map_err(|e| e.to_string())?;
        let cli_dir = Path::new(&local_app_data).join("Marko").join("bin");

        fs::create_dir_all(&cli_dir).map_err(|e| e.to_string())?;

        let bat_path = cli_dir.join("marko.cmd");
        let script_content = format!(
            r#"@echo off
"{}" %*
"#,
            app_path.display()
        );

        fs::write(&bat_path, script_content).map_err(|e| e.to_string())?;

        // Add to user PATH if not already there
        use winreg::enums::*;
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let env = hkcu
            .open_subkey_with_flags("Environment", KEY_READ | KEY_WRITE)
            .map_err(|e| e.to_string())?;
        let current_path: String = env.get_value("Path").unwrap_or_default();

        let cli_dir_str = cli_dir.to_string_lossy().to_string();
        if !current_path.contains(&cli_dir_str) {
            let new_path = if current_path.is_empty() {
                cli_dir_str
            } else {
                format!("{};{}", current_path, cli_dir_str)
            };
            env.set_value("Path", &new_path)
                .map_err(|e| e.to_string())?;

            // Broadcast environment change
            unsafe {
                use windows_sys::Win32::Foundation::*;
                use windows_sys::Win32::UI::WindowsAndMessaging::*;
                let env_str: Vec<u16> = "Environment\0".encode_utf16().collect();
                SendMessageTimeoutW(
                    HWND_BROADCAST,
                    WM_SETTINGCHANGE,
                    0,
                    env_str.as_ptr() as isize,
                    SMTO_ABORTIFHUNG,
                    5000,
                    std::ptr::null_mut(),
                );
            }
        }

        Ok(format!(
            "CLI installed to {}. Please restart your terminal.",
            bat_path.display()
        ))
    }

    #[cfg(target_os = "linux")]
    {
        let app_path = std::env::current_exe().map_err(|e| e.to_string())?;
        let cli_path = Path::new("/usr/local/bin/marko");

        let script_content = format!(
            r#"#!/bin/bash
# Marko CLI - opens files with Marko markdown editor
if [ $# -eq 0 ]; then
    "{}" &
else
    for arg in "$@"; do
        # Resolve to absolute path and normalize
        if [[ "$arg" = "." ]]; then
            file="$(pwd)"
        elif [[ "$arg" = /* ]]; then
            file="$arg"
        else
            file="$(cd "$(dirname "$arg")" && pwd)/$(basename "$arg")"
        fi
        # Remove trailing /. if present
        file="${{file%/.}}"
        "{}" "$file" &
    done
fi
"#,
            app_path.display(),
            app_path.display()
        );

        // Try direct write first
        match fs::write(cli_path, &script_content) {
            Ok(_) => {
                std::process::Command::new("chmod")
                    .args(["+x", "/usr/local/bin/marko"])
                    .output()
                    .map_err(|e| e.to_string())?;
                Ok("CLI installed successfully".to_string())
            }
            Err(_) => {
                // Use pkexec for elevated permissions - write to temp first
                let temp_path = "/tmp/marko_cli_script.sh";
                fs::write(temp_path, &script_content).map_err(|e| e.to_string())?;

                let output = std::process::Command::new("pkexec")
                    .args(["bash", "-c", "cp /tmp/marko_cli_script.sh /usr/local/bin/marko && chmod +x /usr/local/bin/marko && rm /tmp/marko_cli_script.sh"])
                    .output()
                    .map_err(|e| e.to_string())?;

                if output.status.success() {
                    Ok("CLI installed successfully".to_string())
                } else {
                    let _ = fs::remove_file(temp_path);
                    Err(String::from_utf8_lossy(&output.stderr).to_string())
                }
            }
        }
    }
}

fn git_status_to_string(status: git2::Status) -> Option<&'static str> {
    if status.is_conflicted() {
        Some("conflicted")
    } else if status.contains(git2::Status::INDEX_NEW | git2::Status::WT_MODIFIED) {
        Some("staged_modified")
    } else if status.intersects(
        git2::Status::INDEX_MODIFIED | git2::Status::INDEX_NEW | git2::Status::INDEX_RENAMED,
    ) && !status.intersects(git2::Status::WT_MODIFIED | git2::Status::WT_DELETED) {
        Some("staged")
    } else if status.intersects(git2::Status::WT_MODIFIED | git2::Status::INDEX_MODIFIED) {
        Some("modified")
    } else if status.is_wt_new() {
        Some("untracked")
    } else if status.intersects(git2::Status::WT_DELETED | git2::Status::INDEX_DELETED) {
        Some("deleted")
    } else if status.is_wt_renamed() || status.contains(git2::Status::INDEX_RENAMED) {
        Some("renamed")
    } else {
        None
    }
}

#[tauri::command]
fn get_git_status(path: String) -> Result<HashMap<String, String>, String> {
    let repo = match Repository::discover(&path) {
        Ok(r) => r,
        Err(_) => return Err("not_a_git_repo".to_string()),
    };

    let workdir = repo
        .workdir()
        .ok_or("Bare repository")?
        .to_path_buf();

    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false);

    let statuses = repo.statuses(Some(&mut opts)).map_err(|e| e.to_string())?;

    let mut result = HashMap::new();
    for entry in statuses.iter() {
        if let Some(rel_path) = entry.path() {
            if let Some(status_str) = git_status_to_string(entry.status()) {
                let abs_path = workdir.join(rel_path);
                result.insert(abs_path.to_string_lossy().to_string(), status_str.to_string());
            }
        }
    }

    Ok(result)
}

#[tauri::command]
fn get_file_git_status(path: String) -> Result<Option<String>, String> {
    let file_path = Path::new(&path);
    let repo = match Repository::discover(file_path.parent().unwrap_or(file_path)) {
        Ok(r) => r,
        Err(_) => return Ok(None),
    };

    let workdir = repo.workdir().ok_or("Bare repository")?.to_path_buf();
    let rel_path = file_path
        .strip_prefix(&workdir)
        .map_err(|e| e.to_string())?;

    let status = repo
        .status_file(rel_path)
        .map_err(|e| e.to_string())?;

    Ok(git_status_to_string(status).map(|s| s.to_string()))
}

#[tauri::command]
fn git_commit_file(path: String, message: String) -> Result<(), String> {
    let file_path = Path::new(&path);
    let repo = Repository::discover(file_path.parent().unwrap_or(file_path))
        .map_err(|e| e.to_string())?;

    let workdir = repo.workdir().ok_or("Bare repository")?.to_path_buf();
    let rel_path = file_path
        .strip_prefix(&workdir)
        .map_err(|e| e.to_string())?;

    let mut index = repo.index().map_err(|e| e.to_string())?;
    index
        .add_path(rel_path)
        .map_err(|e| e.to_string())?;
    index.write().map_err(|e| e.to_string())?;

    let tree_oid = index.write_tree().map_err(|e| e.to_string())?;
    let tree = repo.find_tree(tree_oid).map_err(|e| e.to_string())?;

    let sig = repo.signature().map_err(|e| e.to_string())?;

    let parent = repo
        .head()
        .ok()
        .and_then(|h| h.peel_to_commit().ok());

    let parents: Vec<&git2::Commit> = parent.iter().collect();

    repo.commit(Some("HEAD"), &sig, &sig, &message, &tree, &parents)
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn git_revert_file(path: String) -> Result<(), String> {
    let file_path = Path::new(&path);
    let repo = Repository::discover(file_path.parent().unwrap_or(file_path))
        .map_err(|e| e.to_string())?;

    let workdir = repo.workdir().ok_or("Bare repository")?.to_path_buf();
    let rel_path = file_path
        .strip_prefix(&workdir)
        .map_err(|e| e.to_string())?;

    // Check if the file is untracked (new file not yet in HEAD)
    let status = repo.status_file(rel_path).map_err(|e| e.to_string())?;
    if status.is_wt_new() {
        return Err("Cannot revert an untracked file".to_string());
    }

    // Checkout the file from HEAD to discard working tree changes
    repo.checkout_head(Some(
        git2::build::CheckoutBuilder::new()
            .force()
            .path(rel_path),
    ))
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[derive(Serialize)]
struct GitAheadBehind {
    ahead: usize,
    behind: usize,
}

#[tauri::command]
fn get_git_ahead_behind(path: String) -> Result<Option<GitAheadBehind>, String> {
    let repo = match Repository::discover(&path) {
        Ok(r) => r,
        Err(_) => return Ok(None),
    };

    let head = match repo.head() {
        Ok(h) => h,
        Err(_) => return Ok(None),
    };

    let local_oid = match head.target() {
        Some(oid) => oid,
        None => return Ok(None),
    };

    let branch_name = match head.shorthand() {
        Some(name) => name.to_string(),
        None => return Ok(None),
    };

    let upstream_name = format!("refs/remotes/origin/{}", branch_name);
    let upstream_ref = match repo.find_reference(&upstream_name) {
        Ok(r) => r,
        Err(_) => return Ok(Some(GitAheadBehind { ahead: 0, behind: 0 })),
    };

    let upstream_oid = match upstream_ref.target() {
        Some(oid) => oid,
        None => return Ok(None),
    };

    let (ahead, behind) = repo
        .graph_ahead_behind(local_oid, upstream_oid)
        .map_err(|e| e.to_string())?;

    Ok(Some(GitAheadBehind { ahead, behind }))
}

#[tauri::command]
async fn git_sync(path: String) -> Result<String, String> {
    let repo = Repository::discover(&path).map_err(|_| "Not a git repository".to_string())?;
    let workdir = repo
        .workdir()
        .ok_or("Bare repository")?
        .to_path_buf();

    let pull = std::process::Command::new("git")
        .args(["pull", "--ff-only"])
        .current_dir(&workdir)
        .output()
        .map_err(|e| format!("Failed to run git pull: {}", e))?;

    if !pull.status.success() {
        let stderr = String::from_utf8_lossy(&pull.stderr);
        return Err(format!("git pull failed: {}", stderr));
    }

    let push = std::process::Command::new("git")
        .args(["push"])
        .current_dir(&workdir)
        .output()
        .map_err(|e| format!("Failed to run git push: {}", e))?;

    if !push.status.success() {
        let stderr = String::from_utf8_lossy(&push.stderr);
        return Err(format!("git push failed: {}", stderr));
    }

    Ok("Sync complete".to_string())
}

#[tauri::command]
fn show_context_menu(
    app: AppHandle,
    state: State<'_, ContextMenuState>,
    window: tauri::Window,
    menu_type: String, // 'document', 'tab', 'tab_bar'
    path: Option<String>,
    tab_id: Option<String>,
    has_selection: bool,
) -> Result<(), String> {
    {
        let mut path_lock = state.active_path.lock().unwrap();
        *path_lock = path.clone();
        let mut tab_lock = state.active_tab_id.lock().unwrap();
        *tab_lock = tab_id.clone();
    }

    let menu = tauri::menu::Menu::new(&app).map_err(|e| e.to_string())?;

    match menu_type.as_str() {
        "tab" => {
            let new_tab = tauri::menu::MenuItem::with_id(
                &app,
                "ctx_tab_new",
                "New Tab",
                true,
                Some("Ctrl+T"),
            )
            .map_err(|e| e.to_string())?;
            menu.append(&new_tab).map_err(|e| e.to_string())?;

            let undo = tauri::menu::MenuItem::with_id(
                &app,
                "ctx_tab_undo",
                "Undo Close Tab",
                true,
                Some("Ctrl+Shift+T"),
            )
            .map_err(|e| e.to_string())?;
            menu.append(&undo).map_err(|e| e.to_string())?;

            let rename = tauri::menu::MenuItem::with_id(
                &app,
                "ctx_tab_rename",
                "Rename",
                true,
                None::<&str>,
            )
            .map_err(|e| e.to_string())?;
            menu.append(&rename).map_err(|e| e.to_string())?;

            let sep =
                tauri::menu::PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?;
            menu.append(&sep).map_err(|e| e.to_string())?;

            let close = tauri::menu::MenuItem::with_id(
                &app,
                "ctx_tab_close",
                "Close Tab",
                true,
                Some("Ctrl+W"),
            )
            .map_err(|e| e.to_string())?;
            menu.append(&close).map_err(|e| e.to_string())?;

            let close_others = tauri::menu::MenuItem::with_id(
                &app,
                "ctx_tab_close_others",
                "Close Other Tabs",
                true,
                None::<&str>,
            )
            .map_err(|e| e.to_string())?;
            menu.append(&close_others).map_err(|e| e.to_string())?;

            let close_right = tauri::menu::MenuItem::with_id(
                &app,
                "ctx_tab_close_right",
                "Close Tabs to Right",
                true,
                None::<&str>,
            )
            .map_err(|e| e.to_string())?;
            menu.append(&close_right).map_err(|e| e.to_string())?;
        }
        "tab_bar" => {
            let new_tab = tauri::menu::MenuItem::with_id(
                &app,
                "ctx_tab_new",
                "New Tab",
                true,
                Some("Ctrl+T"),
            )
            .map_err(|e| e.to_string())?;
            menu.append(&new_tab).map_err(|e| e.to_string())?;

            let undo = tauri::menu::MenuItem::with_id(
                &app,
                "ctx_tab_undo",
                "Undo Close Tab",
                true,
                Some("Ctrl+Shift+T"),
            )
            .map_err(|e| e.to_string())?;
            menu.append(&undo).map_err(|e| e.to_string())?;
        }
        "file_tree" => {
            let reveal_label = if cfg!(target_os = "macos") {
                "Reveal in Finder"
            } else {
                "Show in Explorer"
            };
            let reveal = tauri::menu::MenuItem::with_id(
                &app,
                "ctx_file_reveal",
                reveal_label,
                true,
                None::<&str>,
            )
            .map_err(|e| e.to_string())?;
            menu.append(&reveal).map_err(|e| e.to_string())?;

            let sep1 =
                tauri::menu::PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?;
            menu.append(&sep1).map_err(|e| e.to_string())?;

            let copy_name = tauri::menu::MenuItem::with_id(
                &app,
                "ctx_file_copy_name",
                "Copy Name",
                true,
                None::<&str>,
            )
            .map_err(|e| e.to_string())?;
            menu.append(&copy_name).map_err(|e| e.to_string())?;

            let copy_path = tauri::menu::MenuItem::with_id(
                &app,
                "ctx_file_copy_path",
                "Copy Path",
                true,
                None::<&str>,
            )
            .map_err(|e| e.to_string())?;
            menu.append(&copy_path).map_err(|e| e.to_string())?;

            let sep2 =
                tauri::menu::PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?;
            menu.append(&sep2).map_err(|e| e.to_string())?;

            let trash = tauri::menu::MenuItem::with_id(
                &app,
                "ctx_file_trash",
                "Move to Trash",
                true,
                None::<&str>,
            )
            .map_err(|e| e.to_string())?;
            menu.append(&trash).map_err(|e| e.to_string())?;
        }
        _ => {
            // Document / Default
            if has_selection {
                let copy = tauri::menu::PredefinedMenuItem::copy(&app, Some("Copy"))
                    .map_err(|e| e.to_string())?;
                menu.append(&copy).map_err(|e| e.to_string())?;

                let sep_fmt =
                    tauri::menu::PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?;
                menu.append(&sep_fmt).map_err(|e| e.to_string())?;

                let code_block = tauri::menu::MenuItem::with_id(
                    &app,
                    "ctx_doc_code_block",
                    "Add Code Block",
                    true,
                    None::<&str>,
                )
                .map_err(|e| e.to_string())?;
                menu.append(&code_block).map_err(|e| e.to_string())?;

                let quote = tauri::menu::MenuItem::with_id(
                    &app,
                    "ctx_doc_quote",
                    "Add Quote",
                    true,
                    None::<&str>,
                )
                .map_err(|e| e.to_string())?;
                menu.append(&quote).map_err(|e| e.to_string())?;
            }

            let select_all = tauri::menu::PredefinedMenuItem::select_all(&app, Some("Select All"))
                .map_err(|e| e.to_string())?;
            menu.append(&select_all).map_err(|e| e.to_string())?;

            if let Some(_) = path {
                let sep =
                    tauri::menu::PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?;
                menu.append(&sep).map_err(|e| e.to_string())?;

                let open_folder = tauri::menu::MenuItem::with_id(
                    &app,
                    "ctx_open_folder",
                    "Open File Location",
                    true,
                    None::<&str>,
                )
                .map_err(|e| e.to_string())?;
                menu.append(&open_folder).map_err(|e| e.to_string())?;
            }

            #[cfg(debug_assertions)]
            {
                let sep =
                    tauri::menu::PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?;
                menu.append(&sep).map_err(|e| e.to_string())?;

                let inspect = tauri::menu::MenuItem::with_id(
                    &app,
                    "ctx_inspect",
                    "Inspect Element",
                    true,
                    None::<&str>,
                )
                .map_err(|e| e.to_string())?;
                menu.append(&inspect).map_err(|e| e.to_string())?;
            }
        }
    }

    menu.popup(window).map_err(|e| e.to_string())?;
    Ok(())
}

struct ContextMenuState {
    active_path: Mutex<Option<String>>,
    active_tab_id: Mutex<Option<String>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "windows")]
    {
        std::env::set_var(
            "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
            "--enable-features=SmoothScrolling",
        );
    }

    let builder = tauri::Builder::default()
        .manage(AppState {
            startup_file: Mutex::new(None),
        })
        .manage(WatcherState {
            watcher: Mutex::new(None),
        })
        .manage(FolderWatcherState {
            watcher: Mutex::new(None),
        })
        .manage(ContextMenuState {
            active_path: Mutex::new(None),
            active_tab_id: Mutex::new(None),
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let path_str = args
                .iter()
                .skip(1)
                .find(|a| !a.starts_with("-"))
                .map(|a| a.as_str())
                .unwrap_or("");

            if !path_str.is_empty() {
                let path = std::path::Path::new(path_str);
                let resolved_path = if path.is_absolute() {
                    path_str.to_string()
                } else {
                    let cwd_path = std::path::Path::new(&cwd);
                    cwd_path.join(path).display().to_string()
                };

                let _ = app
                    .get_webview_window("main")
                    .expect("no main window")
                    .emit("file-path", resolved_path);
            }
            let _ = app
                .get_webview_window("main")
                .expect("no main window")
                .set_focus();
        }))
        .plugin(tauri_plugin_prevent_default::init())
        .plugin(tauri_plugin_window_state::Builder::default().build());

    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(tauri_plugin_mcp_bridge::init());
    }

    builder.on_menu_event(|app, event| {
            let id = event.id().as_ref();
            let state = app.state::<ContextMenuState>();

            match id {
                "ctx_open_folder" | "ctx_edit" | "ctx_close" => {
                    let path_lock = state.active_path.lock().unwrap();
                    if let Some(path) = path_lock.as_ref() {
                        match id {
                            "ctx_open_folder" => {
                                let _ = open_file_folder(path.clone());
                            }
                            "ctx_edit" => {
                                if let Some(window) = app.get_webview_window("main") {
                                    let _ = window.emit("menu-edit-file", ());
                                }
                            }
                            "ctx_close" => {
                                if let Some(window) = app.get_webview_window("main") {
                                    let _ = window.emit("menu-close-file", ());
                                }
                            }
                            _ => {}
                        }
                    }
                }
                "ctx_tab_rename" => {
                    let tab_lock = state.active_tab_id.lock().unwrap();
                    if let Some(tab_id) = tab_lock.as_ref() {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.emit("menu-tab-rename", tab_id);
                        }
                    }
                }
                "ctx_tab_new" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.emit("menu-tab-new", ());
                    }
                }
                "ctx_tab_undo" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.emit("menu-tab-undo", ());
                    }
                }
                "ctx_tab_close" => {
                    let tab_lock = state.active_tab_id.lock().unwrap();
                    if let Some(tab_id) = tab_lock.as_ref() {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.emit("menu-tab-close", tab_id);
                        }
                    }
                }
                "ctx_tab_close_others" => {
                    let tab_lock = state.active_tab_id.lock().unwrap();
                    if let Some(tab_id) = tab_lock.as_ref() {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.emit("menu-tab-close-others", tab_id);
                        }
                    }
                }
                "ctx_tab_close_right" => {
                    let tab_lock = state.active_tab_id.lock().unwrap();
                    if let Some(tab_id) = tab_lock.as_ref() {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.emit("menu-tab-close-right", tab_id);
                        }
                    }
                }
                "ctx_file_reveal" => {
                    let path_lock = state.active_path.lock().unwrap();
                    if let Some(path) = path_lock.as_ref() {
                        let _ = open_file_folder(path.clone());
                    }
                }
                "ctx_file_copy_name" => {
                    let path_lock = state.active_path.lock().unwrap();
                    if let Some(path) = path_lock.as_ref() {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.emit("menu-file-copy-name", path);
                        }
                    }
                }
                "ctx_file_copy_path" => {
                    let path_lock = state.active_path.lock().unwrap();
                    if let Some(path) = path_lock.as_ref() {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.emit("menu-file-copy-path", path);
                        }
                    }
                }
                "ctx_file_trash" => {
                    let path_lock = state.active_path.lock().unwrap();
                    if let Some(path) = path_lock.as_ref() {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.emit("menu-file-trash", path);
                        }
                    }
                }
                "ctx_doc_code_block" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.emit("menu-doc-code-block", ());
                    }
                }
                "ctx_doc_quote" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.emit("menu-doc-quote", ());
                    }
                }
                "ctx_inspect" => {
                    if let Some(window) = app.get_webview_window("main") {
                        window.open_devtools();
                    }
                }
                _ => {}
            }
        })
        .setup(|app| {
            let args: Vec<String> = std::env::args().collect();

            let current_exe = std::env::current_exe().unwrap_or_default();
            let exe_name = current_exe
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_lowercase();
            let is_installer_mode =
                args.iter().any(|arg| arg == "--install") || exe_name.contains("installer");

            let label = if is_installer_mode {
                "installer"
            } else {
                "main"
            };

            let _window = tauri::WebviewWindowBuilder::new(
                app,
                label,
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("Marko")
            .inner_size(900.0, 650.0)
            .min_inner_size(400.0, 300.0)
            .visible(false)
            .resizable(true)
            .decorations(false)
            .shadow(false)
            .center()
            .visible(false)
            .build()?;

            let config_dir = app.path().app_config_dir()?;
            let theme_path = config_dir.join("theme.txt");
            let theme_pref =
                fs::read_to_string(theme_path).unwrap_or_else(|_| "system".to_string());

            let window = app.get_webview_window(label).unwrap();

            let bg_color = match theme_pref.as_str() {
                "dark" => Some(tauri::window::Color(24, 24, 24, 255)),
                "light" => Some(tauri::window::Color(253, 253, 253, 255)),
                _ => {
                    if let Ok(t) = window.theme() {
                        match t {
                            tauri::Theme::Dark => Some(tauri::window::Color(24, 24, 24, 255)),
                            _ => Some(tauri::window::Color(253, 253, 253, 255)),
                        }
                    } else {
                        Some(tauri::window::Color(253, 253, 253, 255))
                    }
                }
            };

            let _ = window.set_background_color(bg_color);

            let _ = _window.set_shadow(true);

            let window = app.get_webview_window(label).unwrap();

            let file_path = args.iter().skip(1).find(|arg| !arg.starts_with("-"));

            if let Some(path) = file_path {
                let _ = window.emit("file-path", path.as_str());
            }

            // If installer, force size (this will be saved to installer-state, not main-state)
            if is_installer_mode {
                let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
                    width: 450.0,
                    height: 550.0,
                }));
                let _ = window.center();
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_markdown,
            render_markdown,
            send_markdown_path,
            read_file_content,
            save_file_content,
            read_directory,
            is_directory,
            get_app_mode,
            setup::install_app,
            setup::uninstall_app,
            setup::check_install_status,
            is_win11,
            open_file_folder,
            open_file_folder,
            rename_file,
            trash_file,
            watch_file,
            unwatch_file,
            watch_folder,
            unwatch_folder,
            show_context_menu,
            show_window,
            save_theme,
            install_cli,
            get_git_status,
            get_file_git_status,
            git_commit_file,
            git_sync,
            get_git_ahead_behind,
            git_revert_file
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, _event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                log::info!("[macOS file open] Received Opened event with {} URLs", urls.len());
                if let Some(url) = urls.first() {
                    log::info!("[macOS file open] URL: {}", url);

                    // Try to convert URL to file path
                    let path_str = if let Ok(path_buf) = url.to_file_path() {
                        path_buf.to_string_lossy().to_string()
                    } else {
                        // Fallback: manually decode URL path for URLs with special characters
                        log::info!("[macOS file open] Standard conversion failed, trying manual decode");
                        let url_str = url.as_str();
                        if url_str.starts_with("file://") {
                            // Remove file:// prefix and decode percent-encoding
                            let path_part = &url_str[7..]; // Skip "file://"
                            match urlencoding::decode(path_part) {
                                Ok(decoded) => {
                                    log::info!("[macOS file open] Manually decoded path: {}", decoded);
                                    decoded.to_string()
                                }
                                Err(e) => {
                                    log::error!("[macOS file open] Failed to decode URL path: {}", e);
                                    return;
                                }
                            }
                        } else {
                            log::error!("[macOS file open] URL doesn't start with file://: {}", url_str);
                            return;
                        }
                    };

                    log::info!("[macOS file open] Resolved path: {}", path_str);

                    let state = _app_handle.state::<AppState>();
                    *state.startup_file.lock().unwrap() = Some(path_str.clone());

                    if let Some(window) = _app_handle.get_webview_window("main") {
                        let _ = window.emit("file-path", path_str);
                        let _ = window.set_focus();
                    } else {
                        log::info!("[macOS file open] Window not ready, path stored in startup_file for later retrieval");
                    }
                }
            }
        });
}
