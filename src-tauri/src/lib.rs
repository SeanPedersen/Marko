use comrak::{markdown_to_html, ComrakExtensionOptions, ComrakOptions};
use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

mod setup;

struct WatcherState {
    watcher: Mutex<Option<RecommendedWatcher>>,
}

#[tauri::command]
fn open_markdown(path: String) -> Result<String, String> {
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;

    let options = ComrakOptions {
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

    let html_output = markdown_to_html(&content, &options);

    Ok(html_output)
}

#[tauri::command]
fn open_in_notepad(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        Command::new("notepad.exe")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn open_file_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        Command::new("explorer")
            .arg("/select,")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn watch_file(handle: AppHandle, state: State<'_, WatcherState>, path: String) -> Result<(), String> {
    let mut watcher_lock = state.watcher.lock().unwrap();

    // Stop existing watcher if any
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
fn send_markdown_path() -> Vec<String> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() > 1 {
        args[1..].to_vec()
    } else {
        Vec::new()
    }
}

#[tauri::command]
fn get_app_mode() -> String {
    // In debug mode (tauri dev), always run in "app" mode to bypass installer
    if cfg!(debug_assertions) {
        return "app".to_string();
    }

    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|arg| arg == "--uninstall") {
        return "uninstall".to_string();
    }
    
    if setup::is_installed() {
        "app".to_string()
    } else {
        // If we are not installed, but we are opening a file, just run in "app" mode (portable)
        if args.len() > 1 && !args[1].starts_with('-') {
            "app".to_string()
        } else {
            "installer".to_string()
        }
    }
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

    tauri::Builder::default()
        .manage(WatcherState {
            watcher: Mutex::new(None),
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            println!("Single Instance Args: {:?}", args);
            // In some environments, the first arg might be the executable, in others it might be stripped?
            // Let's look for the first arg that doesn't start with "-" and likely isn't the executable (if full path)
            // But safely, for now, let's just log and try to be smarter.
            
            let mut file_path = "";
            if args.len() > 1 {
                 file_path = args[1].as_str();
            } else if args.len() == 1 {
                 // If only 1 arg, check if it looks like a file and not the exe?
                 // Usually args[0] is exe.
            }
            
            // Allow for robust finding of the file argument
            let path = args.iter().skip(1).find(|a| !a.starts_with("-")).map(|a| a.as_str()).unwrap_or("");
            
            let _ = app.get_webview_window("main").expect("no main window").emit("file-path", path);
            let _ = app.get_webview_window("main").expect("no main window").set_focus();
        }))
        .plugin(tauri_plugin_prevent_default::init())
        .setup(|app| {
            let args: Vec<String> = std::env::args().collect();
            println!("Setup Args: {:?}", args);
            let window = app.get_webview_window("main").unwrap();

            if let Some(path) = args.get(1) {
                let _ = window.emit("file-path", path.as_str());
            }

            // Resize if installer
            let args: Vec<String> = std::env::args().collect();
            let is_uninstall = args.iter().any(|arg| arg == "--uninstall");
            if !setup::is_installed() || is_uninstall {
                // If it's not opening a file, resize to a nice installer size
                if args.len() <= 1 || args[1].starts_with('-') {
                   let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize { width: 450.0, height: 550.0 }));
                   let _ = window.center();
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_markdown,
            send_markdown_path,
            open_in_notepad,
            watch_file,
            unwatch_file,
            get_app_mode,
            setup::install_app,
            setup::uninstall_app,
            setup::check_install_status,
            open_file_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
