use tauri::{Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

pub const ACTION_CAPABILITY: &str =
    "window.__takeboardNativeActions = 2; window.__takeboardReportSave = true; window.__takeboardRemoteProjects = true;";

fn validate_report(text: &str) -> Result<String, String> {
    if text.len() > 128 * 1024 {
        return Err("报告过大，请复制错误摘要。".into());
    }
    let report: serde_json::Value =
        serde_json::from_str(text).map_err(|_| "诊断报告格式无效。".to_string())?;
    if report.get("format").and_then(|v| v.as_str()) != Some("takeboard.client-crash-report")
        || report.get("reportVersion").and_then(|v| v.as_u64()) != Some(1)
        || !report.get("error").is_some_and(|v| v.is_object())
    {
        return Err("诊断报告格式无效。".into());
    }
    serde_json::to_string_pretty(&report).map_err(|error| error.to_string())
}

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
    if action == "remote-project" {
        let Some(window) = app.get_webview_window(source) else {
            return false;
        };
        if source != "main" || !is_local_workspace(app, &window) {
            acknowledge(
                app,
                source,
                &action_id,
                Some("请在此电脑的设置中管理远程项目连接。".into()),
            );
            return false;
        }
        let operation = url
            .query_pairs()
            .find(|(key, _)| key == "operation")
            .map(|(_, value)| value.into_owned())
            .unwrap_or_default();
        let input = url
            .query_pairs()
            .find(|(key, _)| key == "input")
            .map(|(_, value)| value.into_owned())
            .unwrap_or_else(|| "{}".into());
        if input.len() > 4096 {
            acknowledge(app, source, &action_id, Some("连接信息过长".into()));
            return false;
        }
        let input = match serde_json::from_str(&input) {
            Ok(input) => input,
            Err(_) => {
                acknowledge(app, source, &action_id, Some("连接信息格式无效".into()));
                return false;
            }
        };
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let result =
                crate::connections::settings_action(app.clone(), window.clone(), &operation, input)
                    .await;
            // Do not deliver device addresses to a page that navigated away while awaiting an operation.
            if !is_local_workspace(&app, &window) {
                return;
            }
            let payload = match result {
                Ok(data) => serde_json::json!({"actionId":action_id,"data":data}),
                Err(error) => serde_json::json!({"actionId":action_id,"error":error}),
            };
            let _ = window.eval(&format!("window.dispatchEvent(new CustomEvent('takeboard:desktop-action',{{detail:{payload}}}));"));
        });
        return false;
    }
    if action == "save-report" {
        // Content may come from a remote project, but the destination is chosen
        // only by the user in a native dialog. Never accept a path from the page.
        let text = url
            .query_pairs()
            .find(|(key, _)| key == "report")
            .map(|(_, value)| value.into_owned())
            .unwrap_or_default();
        let report = match validate_report(&text) {
            Ok(report) => report,
            Err(error) => {
                acknowledge(app, source, &action_id, Some(error));
                return false;
            }
        };
        let callback_app = app.clone();
        let source = source.to_owned();
        app.dialog()
            .file()
            .set_title("保存 TakeBoard 异常报告")
            .add_filter("JSON", &["json"])
            .set_file_name("takeboard-crash-report.json")
            .save_file(move |file| {
                let error = match file.and_then(|file| file.into_path().ok()) {
                    Some(path) => std::fs::write(path, &report)
                        .err()
                        .map(|error| format!("报告保存失败：{error}。请复制报告文本。")),
                    None => Some("已取消保存，仍可复制报告文本。".into()),
                };
                acknowledge(&callback_app, &source, &action_id, error);
            });
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
    fn report_save_accepts_only_bounded_diagnostic_json() {
        assert!(validate_report(r#"{"format":"takeboard.client-crash-report","reportVersion":1,"error":{"message":"test"}}"#).is_ok());
        assert!(validate_report("not json").is_err());
        assert!(validate_report(r#"{"path":"/tmp/secret"}"#).is_err());
        assert!(validate_report(&"x".repeat(128 * 1024 + 1)).is_err());
    }
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

pub(crate) fn is_local_workspace(app: &tauri::AppHandle, window: &WebviewWindow) -> bool {
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
