use tauri::{Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

// GTK requires a registered download handler to explicitly choose a destination.
// Keep downloads on the client; never accept a server-supplied absolute path.
pub fn download(webview: tauri::Webview, event: tauri::webview::DownloadEvent<'_>) -> bool {
    if let tauri::webview::DownloadEvent::Requested { destination, .. } = event {
        let Some(name) = destination.file_name().map(|name| name.to_owned()) else {
            return false;
        };
        let Ok(directory) = webview.app_handle().path().download_dir() else {
            return false;
        };
        if std::fs::create_dir_all(&directory).is_err() {
            return false;
        }
        let mut target = directory.join(&name);
        // Preserve the engine's suggested name and do not overwrite an existing file.
        if target.exists() {
            let stem = std::path::Path::new(&name)
                .file_stem()
                .unwrap_or(&name)
                .to_string_lossy();
            let extension = std::path::Path::new(&name)
                .extension()
                .map(|value| format!(".{}", value.to_string_lossy()))
                .unwrap_or_default();
            let mut found = false;
            for suffix in 1..=10000 {
                target = directory.join(format!("{stem} ({suffix}){extension}"));
                if !target.exists() {
                    found = true;
                    break;
                }
            }
            if !found {
                return false;
            }
        }
        *destination = target;
    }
    true
}

// Remote content can open the connection UI, but cannot select or reveal local files.
pub fn navigation(app: &tauri::AppHandle, source: &str, url: &tauri::Url) -> bool {
    if url.scheme() != "takeboard-desktop" {
        return true;
    }
    if url.host_str() == Some("connections") {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let _ = crate::connections::open(app).await;
        });
        return false;
    }
    if source != "main" {
        return false;
    }
    let Some(window) = app.get_webview_window("main") else {
        return false;
    };
    if !is_local_workspace(app, &window) {
        return false;
    }
    match url.host_str() {
        Some("choose-folder") => {
            let request = url
                .query_pairs()
                .find(|(key, _)| key == "request")
                .map(|(_, value)| value.into_owned())
                .unwrap_or_default();
            if request.len() > 64 {
                return false;
            }
            let callback_app = app.clone();
            app.dialog().file().set_title("选择此电脑上的项目位置").pick_folder(move |file| {
                if !is_local_workspace(&callback_app, &window) { return; }
                let path = file.and_then(|file| file.into_path().ok()).map(|path| path.to_string_lossy().to_string());
                let payload = serde_json::json!({"request": request, "path": path});
                let _ = window.eval(&format!("window.dispatchEvent(new CustomEvent('takeboard:folder-picked',{{detail:{payload}}}));"));
            });
        }
        Some("reveal-folder") => {
            let path = url
                .query_pairs()
                .find(|(key, _)| key == "path")
                .map(|(_, value)| value.into_owned())
                .unwrap_or_default();
            let path = std::path::PathBuf::from(path);
            if !path.is_absolute() || !path.is_dir() {
                return false;
            }
            #[cfg(target_os = "macos")]
            {
                let _ = std::process::Command::new("open").arg(&path).spawn();
            }
            #[cfg(target_os = "windows")]
            {
                let _ = std::process::Command::new("explorer.exe")
                    .arg(&path)
                    .spawn();
            }
            #[cfg(all(unix, not(target_os = "macos")))]
            {
                let _ = std::process::Command::new("xdg-open").arg(&path).spawn();
            }
        }
        _ => {}
    }
    false
}

fn is_local_workspace(app: &tauri::AppHandle, window: &WebviewWindow) -> bool {
    let Ok(current) = window.url() else {
        return false;
    };
    let startup = app.state::<crate::DesktopStartup>();
    let Ok(status) = startup.0.lock() else {
        return false;
    };
    let crate::StartupEvent::Ready { url } = &*status else {
        return false;
    };
    let Ok(expected) = tauri::Url::parse(url) else {
        return false;
    };
    current.origin() == expected.origin()
}
