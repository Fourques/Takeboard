use serde::Serialize;
use std::{
    io::{Read, Write},
    net::{SocketAddr, TcpListener, TcpStream},
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
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
    child: Mutex<Option<CommandChild>>,
    generation: AtomicU64,
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
    let _ = app.emit("takeboard-startup", status);
}

fn stop_server(app: &tauri::AppHandle) {
    let state = app.state::<DesktopRuntime>();
    state.generation.fetch_add(1, Ordering::SeqCst);
    if let Ok(mut runtime) = state.child.lock() {
        if let Some(child) = runtime.take() {
            let _ = child.kill();
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

fn health_ready(port: u16) -> bool {
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
    let data_root = app
        .path()
        .home_dir()
        .map_err(|error| format!("无法定位用户目录：{error}"))?
        .join("TakeBoardData");
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
    *runtime.child.lock().map_err(|_| "桌面进程状态不可用")? = Some(child);
    let event_app = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Stderr(bytes) => {
                    eprintln!("{}", String::from_utf8_lossy(&bytes));
                }
                CommandEvent::Terminated(payload) => {
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
fn desktop_status(startup: State<'_, DesktopStartup>) -> StartupEvent {
    startup
        .0
        .lock()
        .map(|status| status.clone())
        .unwrap_or_else(|_| StartupEvent::Failed {
            message: "桌面启动状态不可用，请重新打开应用。".into(),
        })
}

#[tauri::command]
fn restart_server(app: tauri::AppHandle) -> StartupEvent {
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
        .manage(DesktopRuntime {
            child: Mutex::new(None),
            generation: AtomicU64::new(0),
        })
        .manage(DesktopStartup(Mutex::new(StartupEvent::Starting)))
        .invoke_handler(tauri::generate_handler![desktop_status, restart_server])
        .setup(|app| {
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
            stop_server(handle);
        }
    });
}
