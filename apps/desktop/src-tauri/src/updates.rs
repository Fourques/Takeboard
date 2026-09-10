use serde_json::{json, Value};
use tauri::{Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_shell::ShellExt;

#[derive(Default)]
pub struct Updates {
    operation: tauri::async_runtime::Mutex<()>,
    window_operation: tauri::async_runtime::Mutex<()>,
    latest: std::sync::Mutex<Value>,
}

pub async fn open(app: tauri::AppHandle) -> tauri::Result<()> {
    let state = app.state::<Updates>();
    let _guard = state.window_operation.lock().await;
    if let Some(window) = app.get_webview_window("updates") {
        window.show()?;
        window.set_focus()?;
    } else {
        WebviewWindowBuilder::new(&app, "updates", WebviewUrl::App("updates.html".into()))
            .title("TakeBoard · 应用更新")
            .inner_size(620.0, 680.0)
            .min_inner_size(380.0, 420.0)
            // Only the bundled UI stays in this privileged window.
            .on_navigation(|url| {
                url.port().is_none()
                    && ((url.scheme() == "tauri" && url.host_str() == Some("localhost"))
                        || (matches!(url.scheme(), "http" | "https")
                            && url.host_str() == Some("tauri.localhost")))
            })
            .build()?;
    }
    Ok(())
}

async fn run(app: &tauri::AppHandle, operation: &str, input: Value) -> Result<Value, String> {
    let state = app.state::<Updates>();
    let _guard = state.operation.lock().await;
    let root = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("TakeBoard");
    let file = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("update-preferences.json");
    let output = app
        .shell()
        .sidecar("takeboard-node")
        .map_err(|e| e.to_string())?
        .args([
            root.join("desktop-updates.mjs")
                .to_string_lossy()
                .to_string(),
            file.to_string_lossy().to_string(),
            env!("CARGO_PKG_VERSION").into(),
            operation.into(),
            input.to_string(),
        ])
        .current_dir(root)
        .output()
        .await
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr)
            .chars()
            .take(500)
            .collect());
    }
    let value: Value =
        serde_json::from_slice(&output.stdout).map_err(|_| "无法读取更新检查结果")?;
    if operation == "status" {
        let latest = state.latest.lock().map_err(|_| "更新状态不可用")?.clone();
        if latest["channel"] == value["channel"] && !latest.is_null() {
            return Ok(latest);
        }
    } else {
        *state.latest.lock().map_err(|_| "更新状态不可用")? = value.clone();
        publish_notice(app, value["status"] == "update");
    }
    Ok(value)
}

fn publish_notice(app: &tauri::AppHandle, available: bool) {
    if let Some(item) = app
        .menu()
        .and_then(|menu| menu.get("check-updates"))
        .and_then(|item| item.as_menuitem().cloned())
    {
        let _ = item.set_text(if available {
            "有新版本 · 检查更新…"
        } else {
            "检查更新…"
        });
    }
    for label in ["main", "remote-workspace"] {
        if let Some(window) = app.get_webview_window(label) {
            let _ = window.eval(&format!("window.__takeboardUpdateAvailable={available};window.dispatchEvent(new CustomEvent('takeboard:update-available',{{detail:{available}}}));"));
        }
    }
}

#[tauri::command]
pub async fn update_action(
    app: tauri::AppHandle,
    window: WebviewWindow,
    operation: String,
    input: Option<Value>,
) -> Result<Value, String> {
    if window.label() != "updates" {
        return Err("请从应用更新窗口操作".into());
    }
    if !matches!(
        operation.as_str(),
        "status" | "save" | "check" | "download" | "notes"
    ) {
        return Err("未知更新操作".into());
    }
    if operation == "download" || operation == "notes" {
        // The page cannot supply a URL or executable. Open only the verified last result.
        let value = app
            .state::<Updates>()
            .latest
            .lock()
            .map_err(|_| "更新状态不可用")?
            .clone();
        if input.as_ref().and_then(|value| value["version"].as_str())
            != value["release"]["version"].as_str()
        {
            return Err("发布信息已变化，请重新检查更新后再下载".into());
        }
        let field = if operation == "download" {
            "downloadUrl"
        } else {
            "notesUrl"
        };
        let url = value["release"][field].as_str().ok_or("请先检查更新")?;
        #[allow(deprecated)]
        app.shell().open(url, None).map_err(|e| e.to_string())?;
        return Ok(json!({"opened":true}));
    }
    run(&app, &operation, input.unwrap_or(json!({}))).await
}

pub fn automatic(app: tauri::AppHandle) {
    // Background-only: no dialog, download, restart or remote server mutation.
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(15));
        tauri::async_runtime::spawn(async move {
            // Informational badge only; server pages receive no updater IPC capability.
            let _ = run(&app, "automatic", json!({})).await;
        });
    });
}
