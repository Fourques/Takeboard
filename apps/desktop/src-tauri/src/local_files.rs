use tauri::{Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

pub const ACTION_CAPABILITY: &str = "window.__takeboardNativeActions = 2;";

pub fn appearance_script(theme: Option<&str>) -> String {
    match theme.filter(|value| matches!(*value, "noir" | "light" | "chroma")) {
        Some(theme) => format!("(() => {{ window.__takeboardTheme = '{theme}'; const apply = () => {{ if (document.documentElement) document.documentElement.dataset.theme = '{theme}'; try {{ localStorage.setItem('takeboard.desktop.theme', '{theme}'); }} catch {{}} }}; apply(); document.addEventListener('DOMContentLoaded', apply, {{ once: true }}); }})()"),
        None => String::new(),
    }
}

fn action_name(url: &tauri::Url) -> Option<&str> {
    if url.scheme() == "takeboard-desktop" {
        return url.host_str();
    }
    if url.scheme() == "https"
        && url.host_str() == Some("takeboard-desktop.invalid")
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
    {
        return Some(url.path().trim_start_matches('/'));
    }
    None
}

fn acknowledge(app: &tauri::AppHandle, source: &str, action_id: &str, error: Option<String>) {
    if let Some(window) = app.get_webview_window(source) {
        let payload = serde_json::json!({"actionId": action_id, "error": error});
        let _ = window.eval(&format!("window.dispatchEvent(new CustomEvent('takeboard:desktop-action',{{detail:{payload}}}));"));
    }
}

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
    let Some(action) = action_name(url) else {
        return true;
    };
    let action_id = url
        .query_pairs()
        .find(|(key, _)| key == "actionId")
        .map(|(_, value)| value.into_owned())
        .unwrap_or_default();
    if action_id.len() > 64 {
        return false;
    }
    if action == "updates" || action == "connections" {
        let theme = url
            .query_pairs()
            .find(|(key, _)| key == "theme")
            .map(|(_, value)| value.into_owned())
            .filter(|value| matches!(value.as_str(), "noir" | "light" | "chroma"));
        let app = app.clone();
        let source = source.to_owned();
        let updates = action == "updates";
        tauri::async_runtime::spawn(async move {
            let result = if updates {
                crate::updates::open_with_theme(app.clone(), theme.as_deref()).await
            } else {
                crate::connections::open_with_theme(app.clone(), theme.as_deref()).await
            };
            acknowledge(
                &app,
                &source,
                &action_id,
                result.err().map(|error| error.to_string()),
            );
        });
        return false;
    }
    if source != "main" {
        acknowledge(
            app,
            source,
            &action_id,
            Some("远程项目的目录位于服务器，不能在当前电脑的文件管理器中打开。".into()),
        );
        return false;
    }
    let Some(window) = app.get_webview_window("main") else {
        return false;
    };
    if !is_local_workspace(app, &window) {
        acknowledge(
            app,
            source,
            &action_id,
            Some("只能从此电脑的项目页面访问本地文件夹。".into()),
        );
        return false;
    }
    match action {
        "choose-folder" => {
            let request = url
                .query_pairs()
                .find(|(key, _)| key == "request")
                .map(|(_, value)| value.into_owned())
                .unwrap_or_default();
            if request.len() > 64 {
                acknowledge(app, source, &action_id, Some("文件夹选择请求无效。".into()));
                return false;
            }
            let callback_app = app.clone();
            app.dialog().file().set_title("选择此电脑上的项目位置").pick_folder(move |file| {
                if !is_local_workspace(&callback_app, &window) { return; }
                let path = file.and_then(|file| file.into_path().ok()).map(|path| path.to_string_lossy().to_string());
                let payload = serde_json::json!({"request": request, "path": path});
                let _ = window.eval(&format!("window.dispatchEvent(new CustomEvent('takeboard:folder-picked',{{detail:{payload}}}));"));
            });
            acknowledge(app, source, &action_id, None);
        }
        "reveal-folder" => {
            let path = url
                .query_pairs()
                .find(|(key, _)| key == "path")
                .map(|(_, value)| value.into_owned())
                .unwrap_or_default();
            let path = std::path::PathBuf::from(path);
            if !path.is_absolute() || !path.is_dir() {
                acknowledge(
                    app,
                    source,
                    &action_id,
                    Some("文件夹不存在或当前不可访问，请检查磁盘连接与项目位置。".into()),
                );
                return false;
            }
            #[cfg(target_os = "macos")]
            let mut command = std::process::Command::new("open");
            #[cfg(target_os = "windows")]
            let mut command = std::process::Command::new("explorer.exe");
            #[cfg(all(unix, not(target_os = "macos")))]
            let mut command = std::process::Command::new("xdg-open");
            let result = command.arg(&path).spawn();
            acknowledge(
                app,
                source,
                &action_id,
                result
                    .err()
                    .map(|error| format!("无法打开文件管理器：{error}")),
            );
        }
        _ => acknowledge(
            app,
            source,
            &action_id,
            Some("当前安装包不支持此操作，请检查更新。".into()),
        ),
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_appearance_accepts_only_known_palettes() {
        for theme in ["noir", "light", "chroma"] {
            let script = appearance_script(Some(theme));
            assert!(script.contains("window.__takeboardTheme"));
            assert!(script.contains(theme));
        }
        assert!(appearance_script(None).is_empty());
        assert!(appearance_script(Some("'; alert(1); //")).is_empty());
    }
    #[test]
    fn native_action_origin_is_exact_and_legacy_links_still_work() {
        for (url, expected) in [
            (
                "https://takeboard-desktop.invalid/connections?actionId=abc",
                Some("connections"),
            ),
            (
                "takeboard-desktop://reveal-folder?path=/tmp",
                Some("reveal-folder"),
            ),
            (
                "https://takeboard-desktop.invalid.attacker.test/connections",
                None,
            ),
            ("https://takeboard-desktop.invalid:8443/connections", None),
            ("https://user@takeboard-desktop.invalid/connections", None),
            ("http://takeboard-desktop.invalid/connections", None),
        ] {
            let url = tauri::Url::parse(url).unwrap();
            assert_eq!(action_name(&url), expected);
        }
    }
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
