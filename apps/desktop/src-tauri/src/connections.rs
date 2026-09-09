use crate::OwnedLauncher;
use serde_json::{json, Value};
use std::{
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_shell::{process::CommandEvent, ShellExt};

pub struct Connections {
    operation: tauri::async_runtime::Mutex<()>,
    child: Mutex<Option<OwnedLauncher>>,
    generation: AtomicU64,
    status: Mutex<Value>,
}
impl Default for Connections {
    fn default() -> Self {
        Self {
            operation: tauri::async_runtime::Mutex::new(()),
            child: Mutex::new(None),
            generation: AtomicU64::new(0),
            status: Mutex::new(json!({"state":"idle"})),
        }
    }
}
fn publish(app: &tauri::AppHandle, value: Value) {
    if let Ok(mut status) = app.state::<Connections>().status.lock() {
        *status = value.clone();
    }
    let _ = app.emit_to("connections", "takeboard-connection", value);
}
fn trusted(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "connections" {
        return Err("连接管理仅允许从桌面连接窗口操作".into());
    }
    Ok(())
}
pub async fn open(app: tauri::AppHandle) -> tauri::Result<()> {
    let state = app.state::<Connections>();
    let _guard = state.operation.lock().await;
    if let Some(window) = app.get_webview_window("connections") {
        window.show()?;
        window.set_focus()?;
    } else {
        WebviewWindowBuilder::new(
            &app,
            "connections",
            WebviewUrl::App("connections.html".into()),
        )
        .title("TakeBoard · 连接设备")
        .inner_size(680.0, 720.0)
        .min_inner_size(380.0, 440.0)
        .build()?;
    }
    Ok(())
}
fn remote_window_closed(app: tauri::AppHandle, generation: u64) {
    tauri::async_runtime::spawn(async move {
        let state = app.state::<Connections>();
        let _guard = state.operation.lock().await;
        // A delayed close event must never tear down a newer connection.
        if state.generation.load(Ordering::SeqCst) == generation {
            let stopping = app.clone();
            let _ = tauri::async_runtime::spawn_blocking(move || stop(&stopping)).await;
        }
    });
}
pub fn stop(app: &tauri::AppHandle) {
    let state = app.state::<Connections>();
    state.generation.fetch_add(1, Ordering::SeqCst);
    if let Ok(mut owned) = state.child.lock() {
        if let Some(mut child) = owned.take() {
            let _ = child.process.write(b"takeboard.launcher.shutdown\n");
            let deadline = Instant::now() + Duration::from_secs(4);
            while !child.exited.load(Ordering::SeqCst) && Instant::now() < deadline {
                thread::sleep(Duration::from_millis(30));
            }
            if !child.exited.load(Ordering::SeqCst) {
                let _ = child.process.kill();
            }
        }
    }
    publish(app, json!({"state":"idle"}));
}
#[tauri::command]
pub fn connection_status(app: tauri::AppHandle, window: WebviewWindow) -> Result<Value, String> {
    trusted(&window)?;
    let value = app
        .state::<Connections>()
        .status
        .lock()
        .map_err(|_| "连接状态不可用")?
        .clone();
    Ok(value)
}
#[tauri::command]
pub async fn disconnect_remote(app: tauri::AppHandle, window: WebviewWindow) -> Result<(), String> {
    trusted(&window)?;
    let state = app.state::<Connections>();
    let _guard = state.operation.lock().await;
    // An HTTPS window would otherwise remain fully usable after "disconnect".
    if let Some(remote) = app.get_webview_window("remote-workspace") {
        remote.close().map_err(|error| error.to_string())?;
    }
    let stopping = app.clone();
    tauri::async_runtime::spawn_blocking(move || stop(&stopping))
        .await
        .map_err(|error| error.to_string())?;
    Ok(())
}
#[tauri::command]
pub async fn connect_remote(
    app: tauri::AppHandle,
    window: WebviewWindow,
    target: Value,
) -> Result<(), String> {
    trusted(&window)?;
    let state = app.state::<Connections>();
    let _guard = state.operation.lock().await;
    let payload = serde_json::to_string(&target).map_err(|error| error.to_string())?;
    if payload.len() > 4096 {
        return Err("连接信息过长".into());
    }
    if let Some(remote) = app.get_webview_window("remote-workspace") {
        remote.close().map_err(|error| error.to_string())?;
    }
    let stopping = app.clone();
    tauri::async_runtime::spawn_blocking(move || stop(&stopping))
        .await
        .map_err(|error| error.to_string())?;
    let generation = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
    let root = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?
        .join("TakeBoard");
    let script = root.join("desktop-connection.mjs");
    if !script.is_file() {
        return Err("安装包缺少连接模块，请更新 TakeBoard".into());
    }
    let (mut events, child) = app
        .shell()
        .sidecar("takeboard-node")
        .map_err(|error| error.to_string())?
        .args([script.to_string_lossy().to_string(), payload])
        .current_dir(root)
        .spawn()
        .map_err(|error| error.to_string())?;
    let exited = Arc::new(AtomicBool::new(false));
    *state.child.lock().map_err(|_| "连接进程不可用")? = Some(OwnedLauncher {
        process: child,
        exited: exited.clone(),
    });
    publish(&app, json!({"state":"connecting"}));
    let event_app = app.clone();
    tauri::async_runtime::spawn(async move {
        let app = event_app;
        while let Some(event) = events.recv().await {
            if matches!(event, CommandEvent::Terminated(_)) {
                exited.store(true, Ordering::SeqCst);
            }
            if app.state::<Connections>().generation.load(Ordering::SeqCst) != generation {
                continue;
            }
            match event {
                CommandEvent::Stdout(bytes) => {
                    if let Ok(value) = serde_json::from_slice::<Value>(&bytes) {
                        if matches!(value["state"].as_str(), Some("ready" | "failed")) {
                            publish(&app, value);
                        }
                    }
                }
                CommandEvent::Terminated(_) => {
                    let failed = app
                        .state::<Connections>()
                        .status
                        .lock()
                        .map(|status| status["state"] == "failed")
                        .unwrap_or(false);
                    if !failed {
                        publish(
                            &app,
                            json!({"state":"failed","message":"连接进程已退出，请重新连接。服务器任务不会被停止。"}),
                        );
                    }
                }
                _ => {}
            }
        }
        exited.store(true, Ordering::SeqCst);
    });
    Ok(())
}
#[tauri::command]
pub async fn open_remote_workspace(
    app: tauri::AppHandle,
    window: WebviewWindow,
) -> Result<(), String> {
    trusted(&window)?;
    let state = app.state::<Connections>();
    let _guard = state.operation.lock().await;
    let value = app
        .state::<Connections>()
        .status
        .lock()
        .map_err(|_| "连接状态不可用")?
        .clone();
    if value["state"] != "ready" {
        return Err("请先建立并验证连接".into());
    }
    let mut url: tauri::Url = value["url"]
        .as_str()
        .ok_or("连接地址缺失")?
        .parse()
        .map_err(|_| "连接地址无效")?;
    let address = value["target"]["address"].as_str().unwrap_or("远程设备");
    let name = value["target"]["name"]
        .as_str()
        .filter(|name| !name.is_empty())
        .unwrap_or(address);
    let title = format!("TakeBoard · {name}");
    let display = json!({
        "kind": value["target"]["kind"], "address": address,
        "name": value["target"]["name"].as_str().unwrap_or(""),
        "instanceId": value["instanceId"].as_str().unwrap_or("")
    });
    let fragment: String =
        tauri::Url::parse_with_params("https://localhost", &[("tb-device", display.to_string())])
            .map_err(|error| error.to_string())?
            .query()
            .unwrap_or("")
            .into();
    url.set_fragment(Some(&fragment));
    if let Some(remote) = app.get_webview_window("remote-workspace") {
        remote
            .set_title(&title)
            .map_err(|error| error.to_string())?;
        remote.navigate(url).map_err(|error| error.to_string())?;
        remote.show().map_err(|error| error.to_string())?;
        remote.set_focus().map_err(|error| error.to_string())?;
    } else {
        // No capabilities are assigned to this remote-content window.
        let navigation_app = app.clone();
        let remote = WebviewWindowBuilder::new(&app, "remote-workspace", WebviewUrl::External(url))
            .on_navigation(move |url| {
                crate::local_files::navigation(&navigation_app, "remote-workspace", url)
            })
            .on_download(crate::local_files::download)
            .title(&title)
            .inner_size(1440.0, 900.0)
            .min_inner_size(720.0, 520.0)
            .build()
            .map_err(|error| error.to_string())?;
        // Capture ownership when this window is created, not when its delayed
        // Destroyed event arrives (by then a different connection may be active).
        let generation = state.generation.load(Ordering::SeqCst);
        let closing_app = app.clone();
        remote.on_window_event(move |event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                remote_window_closed(closing_app.clone(), generation);
            }
        });
    }
    Ok(())
}

#[tauri::command]
pub fn open_local_workspace(app: tauri::AppHandle, window: WebviewWindow) -> Result<(), String> {
    trusted(&window)?;
    let local = app.get_webview_window("main").ok_or("本机窗口不可用")?;
    local.show().map_err(|error| error.to_string())?;
    local.unminimize().map_err(|error| error.to_string())?;
    local.set_focus().map_err(|error| error.to_string())
}
