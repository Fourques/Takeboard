use serde::Serialize;
mod connections;
use std::{
    io::{Read, Write},
    net::{SocketAddr, TcpListener, TcpStream},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager, State};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

struct DesktopRuntime {
    child: Mutex<Option<OwnedLauncher>>,
    generation: AtomicU64,
}
struct OwnedLauncher {
    process: CommandChild,
    exited: Arc<AtomicBool>,
}
struct DesktopStartup(Mutex<StartupEvent>);

#[derive(Clone, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
enum StartupEvent {
    Starting,
    Ready { url: String },
    Failed { message: String },
}

fn set_startup(app: &tauri::AppHandle, status: StartupEvent) {
    if let Ok(mut current) = app.state::<DesktopStartup>().0.lock() {
        *current = status.clone();
    }
    let _ = app.emit_to("main", "takeboard-startup", status);
}

fn stop_server(app: &tauri::AppHandle) {
    let state = app.state::<DesktopRuntime>();
    state.generation.fetch_add(1, Ordering::SeqCst);
    if let Ok(mut runtime) = state.child.lock() {
        if let Some(mut child) = runtime.take() {
            // Killing the launcher first used to orphan its Node server. Let it
            // stop the owned server over IPC, then wait for the launcher to exit.
            let _ = child.process.write(b"takeboard.launcher.shutdown\n");
            let deadline = Instant::now() + Duration::from_secs(28);
            while !child.exited.load(Ordering::SeqCst) && Instant::now() < deadline {
                thread::sleep(Duration::from_millis(50));
            }
            if !child.exited.load(Ordering::SeqCst) {
                // The server also observes its parent's IPC disconnect, including crashes.
                let _ = child.process.kill();
            }
        }
    };
}

fn choose_port() -> Result<u16, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|error| format!("无法选择本机端口：{error}"))?;
    listener
        .local_addr()
        .map(|address| address.port())
        .map_err(|error| format!("无法读取本机端口：{error}"))
}

fn health_matches(port: u16, instance_id: Option<&str>) -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(700)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(700)));
    if write!(
        stream,
        "GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
    )
    .is_err()
    {
        return false;
    }
    let mut response = String::new();
    stream.read_to_string(&mut response).is_ok()
        && response.starts_with("HTTP/1.1 200")
        && response.contains("\"service\":\"takeboard-server\"")
        && response.contains("\"status\":\"ok\"")
        && instance_id.map_or(true, |id| {
            response.contains(&format!("\"instanceId\":\"{id}\""))
        })
}

fn health_ready(port: u16) -> bool {
    health_matches(port, None)
}

fn wait_for_server(app: tauri::AppHandle, port: u16, generation: u64) {
    thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(35);
        while Instant::now() < deadline {
            if app
                .state::<DesktopRuntime>()
                .generation
                .load(Ordering::SeqCst)
                != generation
            {
                return;
            }
            if health_ready(port) {
                set_startup(
                    &app,
                    StartupEvent::Ready {
                        url: format!("http://127.0.0.1:{port}"),
                    },
                );
                return;
            }
            thread::sleep(Duration::from_millis(300));
        }
        if app
            .state::<DesktopRuntime>()
            .generation
            .load(Ordering::SeqCst)
            != generation
        {
            return;
        }
        stop_server(&app);
        set_startup(
            &app,
            StartupEvent::Failed {
                message: "本机服务没有在 35 秒内就绪。请检查磁盘权限，或打开便携版运行 doctor。"
                    .into(),
            },
        );
    });
}

fn start_server(app: &tauri::AppHandle) -> Result<(u16, u64), String> {
    let data_root = app
        .path()
        .home_dir()
        .map_err(|error| format!("无法定位用户目录：{error}"))?
        .join("TakeBoardData");
    if let (Ok(id), Ok(record)) = (
        std::fs::read_to_string(data_root.join(".takeboard-instance-id")),
        std::fs::read_to_string(data_root.join(".system").join("instance.json")),
    ) {
        if let Ok(record) = serde_json::from_str::<serde_json::Value>(&record) {
            if record["instanceId"].as_str() == Some(id.trim()) {
                if let Some(port) = record["port"]
                    .as_u64()
                    .and_then(|value| u16::try_from(value).ok())
                    .filter(|port| *port > 0)
                {
                    if health_matches(port, Some(id.trim())) {
                        if record["version"].as_str() != Some(env!("CARGO_PKG_VERSION")) {
                            return Err(
                                "同一数据目录已有其他版本正在运行，请先从原启动方式停止它。".into(),
                            );
                        }
                        // Reusing a service does not transfer process ownership to this window.
                        let generation = app
                            .state::<DesktopRuntime>()
                            .generation
                            .fetch_add(1, Ordering::SeqCst)
                            + 1;
                        return Ok((port, generation));
                    }
                }
            }
        }
    }
    let port = choose_port()?;
    let resource_root: PathBuf = app
        .path()
        .resource_dir()
        .map_err(|error| format!("无法定位应用资源：{error}"))?
        .join("TakeBoard");
    let launcher = resource_root.join("launcher.mjs");
    if !launcher.is_file() {
        return Err("桌面包缺少 TakeBoard 运行资源，请重新安装。".into());
    }
    let command = app
        .shell()
        .sidecar("takeboard-node")
        .map_err(|error| format!("无法定位内置运行时：{error}"))?
        .args([
            launcher.to_string_lossy().to_string(),
            "start".into(),
            "--no-open".into(),
        ])
        .env("TAKEBOARD_DATA_ROOT", data_root)
        .env("TAKEBOARD_PORT", port.to_string())
        .env("TAKEBOARD_DESKTOP", "1")
        .current_dir(resource_root);
    let (mut events, child) = command
        .spawn()
        .map_err(|error| format!("无法启动 TakeBoard 服务：{error}"))?;
    let runtime = app.state::<DesktopRuntime>();
    let generation = runtime.generation.fetch_add(1, Ordering::SeqCst) + 1;
    let exited = Arc::new(AtomicBool::new(false));
    *runtime.child.lock().map_err(|_| "桌面进程状态不可用")? = Some(OwnedLauncher {
        process: child,
        exited: exited.clone(),
    });
    let event_app = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Stderr(bytes) => {
                    eprintln!("{}", String::from_utf8_lossy(&bytes));
                }
                CommandEvent::Terminated(payload) => {
                    exited.store(true, Ordering::SeqCst);
                    if event_app
                        .state::<DesktopRuntime>()
                        .generation
                        .load(Ordering::SeqCst)
                        != generation
                    {
                        continue;
                    }
                    let ready = event_app
                        .state::<DesktopStartup>()
                        .0
                        .lock()
                        .map(|status| matches!(*status, StartupEvent::Ready { .. }))
                        .unwrap_or(false);
                    if !ready {
                        set_startup(
                            &event_app,
                            StartupEvent::Failed {
                                message: format!(
                                    "本机服务提前退出（状态码：{}）。请重试；若仍失败，请运行诊断。",
                                    payload.code.map_or_else(|| "未知".into(), |code| code.to_string())
                                ),
                            },
                        );
                    }
                }
                _ => {}
            }
        }
    });
    Ok((port, generation))
}

#[tauri::command]
fn desktop_status(
    startup: State<'_, DesktopStartup>,
    window: tauri::WebviewWindow,
) -> StartupEvent {
    if window.label() != "main" {
        return StartupEvent::Failed {
            message: "只能从本机启动窗口读取服务状态。".into(),
        };
    }
    startup
        .0
        .lock()
        .map(|status| status.clone())
        .unwrap_or_else(|_| StartupEvent::Failed {
            message: "桌面启动状态不可用，请重新打开应用。".into(),
        })
}

#[tauri::command]
fn restart_server(app: tauri::AppHandle, window: tauri::WebviewWindow) -> StartupEvent {
    // Explicitly guard application commands too; remote pages must never control
    // the local launcher, independently of the framework's capability defaults.
    if window.label() != "main" {
        return StartupEvent::Failed {
            message: "只能从本机启动窗口重启服务。".into(),
        };
    }
    stop_server(&app);
    set_startup(&app, StartupEvent::Starting);
    match start_server(&app) {
        Ok((port, generation)) => {
            wait_for_server(app, port, generation);
            StartupEvent::Starting
        }
        Err(message) => {
            let failed = StartupEvent::Failed { message };
            set_startup(&app, failed.clone());
            failed
        }
    }
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .manage(connections::Connections::default())
        .manage(DesktopRuntime {
            child: Mutex::new(None),
            generation: AtomicU64::new(0),
        })
        .manage(DesktopStartup(Mutex::new(StartupEvent::Starting)))
        .invoke_handler(tauri::generate_handler![
            desktop_status,
            restart_server,
            connections::connection_status,
            connections::connect_remote,
            connections::disconnect_remote,
            connections::open_remote_workspace
        ])
        .on_menu_event(|app, event| {
            if event.id().as_ref() == "connect-device" {
                // WebView2 creation from a synchronous menu callback deadlocks on Windows.
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = connections::open(app).await {
                        eprintln!("Could not open connection manager: {error}");
                    }
                });
            }
        })
        .setup(|app| {
            let menu = tauri::menu::Menu::default(app.handle())?;
            let connect = tauri::menu::MenuItem::with_id(
                app,
                "connect-device",
                "连接设备…",
                true,
                Some("CmdOrCtrl+Shift+K"),
            )?;
            menu.append(&tauri::menu::Submenu::with_items(
                app,
                "连接",
                true,
                &[&connect],
            )?)?;
            app.set_menu(menu)?;
            match start_server(app.handle()) {
                Ok((port, generation)) => wait_for_server(app.handle().clone(), port, generation),
                Err(message) => {
                    set_startup(app.handle(), StartupEvent::Failed { message });
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("TakeBoard desktop could not be initialized");

    app.run(|handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            connections::stop(handle);
            stop_server(handle);
        }
    });
}
