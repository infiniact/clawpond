use claw_ui_bridge::AppState;
use std::sync::atomic::{AtomicU32, Ordering};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    webview::WebviewWindowBuilder,
    Emitter, Manager,
};

static WINDOW_COUNTER: AtomicU32 = AtomicU32::new(0);

/// On Windows, prevent console windows from flashing when spawning subprocesses.
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Extension trait to hide console windows on Windows (no-op on other platforms).
trait HideConsole {
    fn hide_console(&mut self) -> &mut Self;
}

impl HideConsole for std::process::Command {
    #[cfg(target_os = "windows")]
    fn hide_console(&mut self) -> &mut Self {
        self.creation_flags(CREATE_NO_WINDOW)
    }
    #[cfg(not(target_os = "windows"))]
    fn hide_console(&mut self) -> &mut Self {
        self
    }
}

#[tauri::command]
async fn pick_directory() -> Option<String> {
    let handle = rfd::AsyncFileDialog::new()
        .set_title("Select Gateway Directory")
        .pick_folder()
        .await;
    handle.map(|h| h.path().to_string_lossy().to_string())
}

#[tauri::command]
async fn pick_files() -> Vec<String> {
    let handles = rfd::AsyncFileDialog::new()
        .set_title("Select Files")
        .pick_files()
        .await;
    handles
        .unwrap_or_default()
        .into_iter()
        .map(|h| h.path().to_string_lossy().to_string())
        .collect()
}

#[tauri::command]
fn check_binary_exists(name: String) -> bool {
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("where")
        .arg(&name)
        .hide_console()
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    #[cfg(not(target_os = "windows"))]
    let result = std::process::Command::new("which")
        .arg(&name)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    result
}

#[tauri::command]
async fn run_shell_command(command: String) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    let output = std::process::Command::new("cmd")
        .args(["/C", &command])
        .hide_console()
        .output()
        .map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "windows"))]
    let output = {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        std::process::Command::new(&shell)
            .args(["-l", "-c", &command])
            .output()
            .map_err(|e| e.to_string())?
    };
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        Err(if stderr.is_empty() {
            format!("Command exited with code {}", output.status.code().unwrap_or(-1))
        } else {
            stderr
        })
    }
}

/// macOS GUI apps (launched from Dock/Finder) don't inherit the user's shell
/// PATH. They get a minimal PATH like `/usr/bin:/bin:/usr/sbin:/sbin`, which
/// doesn't include `/usr/local/bin` or `/opt/homebrew/bin` where `docker`,
/// `colima`, etc. are typically installed.
///
/// This reads PATH from the user's login shell and applies it to the process.
fn fix_path_env() {
    #[cfg(target_os = "macos")]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        if let Ok(output) = std::process::Command::new(&shell)
            .args(["-l", "-c", "printf '%s' \"$PATH\""])
            .output()
        {
            if output.status.success() {
                let shell_path = String::from_utf8_lossy(&output.stdout).to_string();
                if !shell_path.is_empty() {
                    std::env::set_var("PATH", &shell_path);
                }
            }
        }
    }
}

#[tauri::command]
#[allow(dead_code)]
async fn remove_directory(path: String) -> Result<(), String> {
    let expanded = shellexpand::tilde(&path).to_string();
    std::fs::remove_dir_all(&expanded).map_err(|e| e.to_string())
}

/// Detect the current OS and (on Linux) the package manager family.
/// Returns one of: "macos", "windows", "linux-deb", "linux-rpm", "linux".
#[tauri::command]
fn detect_platform() -> String {
    if cfg!(target_os = "macos") {
        "macos".into()
    } else if cfg!(target_os = "windows") {
        "windows".into()
    } else {
        // Linux — check for dpkg (deb) or rpm
        let has_dpkg = std::process::Command::new("dpkg")
            .arg("--version")
            .hide_console()
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if has_dpkg {
            return "linux-deb".into();
        }
        let has_rpm = std::process::Command::new("rpm")
            .arg("--version")
            .hide_console()
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if has_rpm {
            return "linux-rpm".into();
        }
        "linux".into()
    }
}

#[tauri::command]
async fn open_url_in_window(app: tauri::AppHandle, url: String, title: String) -> Result<(), String> {
    let id = WINDOW_COUNTER.fetch_add(1, Ordering::Relaxed);
    let label = format!("browser-{id}");

    WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::External(url.parse().map_err(|e: url::ParseError| e.to_string())?))
        .title(&title)
        .inner_size(1024.0, 768.0)
        .resizable(true)
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
async fn export_text_to_pdf(_app: tauri::AppHandle, text: String) -> Result<String, String> {
    use rfd::AsyncFileDialog;

    // 让用户选择保存位置
    let file_handle = AsyncFileDialog::new()
        .set_title("Save PDF")
        .set_file_name("export.pdf")
        .add_filter("PDF", &["pdf"])
        .save_file()
        .await;

    let file_path = match file_handle {
        Some(h) => h.path().to_string_lossy().to_string(),
        None => return Err("Cancelled".to_string()),
    };

    // 保存为纯文本文件，cupsfilter 原生支持 text/plain -> PDF
    let txt_path = format!("{}.txt", file_path.trim_end_matches(".pdf"));
    std::fs::write(&txt_path, &text).map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("/usr/sbin/cupsfilter")
            .arg("-m")
            .arg("application/pdf")
            .arg(&txt_path)
            .output()
            .map_err(|e| e.to_string())?;

        // 删除临时文本文件
        let _ = std::fs::remove_file(&txt_path);

        if output.status.success() {
            // cupsfilter 将 PDF 输出到 stdout
            std::fs::write(&file_path, &output.stdout).map_err(|e| e.to_string())?;
            Ok(file_path)
        } else {
            Err(format!("PDF conversion failed: {}", String::from_utf8_lossy(&output.stderr)))
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = std::fs::remove_file(&txt_path);
        Err("PDF export is currently only supported on macOS.".to_string())
    }
}

#[tauri::command]
async fn share_to_wechat(app: tauri::AppHandle, text: String) -> Result<(), String> {
    // 将文本复制到剪贴板
    use tauri_plugin_clipboard_manager::ClipboardExt;
    
    app.clipboard()
        .write_text(&text)
        .map_err(|e| e.to_string())?;
    
    // macOS: 打开微信
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-a")
            .arg("WeChat")
            .spawn()
            .map_err(|e| format!("Failed to open WeChat: {}", e))?;
    }
    
    // Windows: 打开微信
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "WeChat"])
            .spawn()
            .map_err(|e| format!("Failed to open WeChat: {}", e))?;
    }
    
    // Linux: 提示用户
    #[cfg(target_os = "linux")]
    {
        return Err("Please manually paste and share in WeChat. Text has been copied to clipboard.".to_string());
    }
    
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    fix_path_env();

    tauri::Builder::default()
        .manage(AppState::new())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            pick_directory,
            pick_files,
            check_binary_exists,
            run_shell_command,
            remove_directory,
            detect_platform,
            open_url_in_window,
            export_text_to_pdf,
            share_to_wechat,
            claw_ui_bridge::connect_master,
            claw_ui_bridge::get_master_status,
            claw_ui_bridge::spawn_gateway,
            claw_ui_bridge::list_gateways,
            claw_ui_bridge::remove_gateway,
            claw_ui_bridge::check_updates,
            claw_ui_bridge::apply_update,
            claw_ui_bridge::check_docker,
            claw_ui_bridge::check_openclaw,
            claw_ui_bridge::openclaw_start,
            claw_ui_bridge::openclaw_stop,
            claw_ui_bridge::openclaw_health,
            claw_ui_bridge::write_local_config,
            claw_ui_bridge::write_local_auth_profiles,
            claw_ui_bridge::check_port_available,
            claw_ui_bridge::docker_pull_image,
            claw_ui_bridge::docker_image_exists,
            claw_ui_bridge::write_compose_config,
            claw_ui_bridge::write_openclaw_config,
            claw_ui_bridge::write_auth_profiles,
            claw_ui_bridge::detect_config,
            claw_ui_bridge::read_gateway_info,
            claw_ui_bridge::read_existing_config,
            claw_ui_bridge::read_openclaw_config,
            claw_ui_bridge::update_env_value,
            claw_ui_bridge::compose_start,
            claw_ui_bridge::compose_stop,
            claw_ui_bridge::compose_health,
            claw_ui_bridge::compose_stats,
            claw_ui_bridge::fetch_provider_models,
            claw_ui_bridge::test_provider_model,
            claw_ui_bridge::export_snapshot,
            claw_ui_bridge::export_snapshot_to_file,
            claw_ui_bridge::import_snapshot,
            claw_ui_bridge::import_snapshot_from_file,
            claw_ui_bridge::copy_to_workspace,
            claw_ui_bridge::save_base64_to_workspace,
            claw_ui_bridge::list_workspace_agents,
            claw_ui_bridge::add_workspace_agent,
            claw_ui_bridge::toggle_agent_allowed,
            claw_ui_bridge::read_scheduled_tasks,
            claw_ui_bridge::write_scheduled_tasks,
            claw_ui_bridge::migrate_pond_dir,
            claw_ui_bridge::db_get_setting,
            claw_ui_bridge::db_set_setting,
            claw_ui_bridge::db_delete_setting,
            claw_ui_bridge::db_load_gateways,
            claw_ui_bridge::db_save_gateways,
            claw_ui_bridge::db_load_agent_icons,
            claw_ui_bridge::db_save_agent_icons,
            claw_ui_bridge::db_load_messages,
            claw_ui_bridge::db_append_messages,
            claw_ui_bridge::db_update_message,
            claw_ui_bridge::db_save_all_messages,
            claw_ui_bridge::db_record_usage,
            claw_ui_bridge::db_get_daily_usage,
            claw_ui_bridge::db_get_hourly_usage,
            claw_ui_bridge::db_persist_usage_bulk,
            claw_ui_bridge::db_prune_old_usage,
            claw_ui_bridge::db_migrate_from_localstorage,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // On Windows, remove native title bar & frame — the frontend renders custom controls.
            #[cfg(target_os = "windows")]
            {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_decorations(false);
                }
            }

            // ── System tray ──
            let start_gateway =
                MenuItem::with_id(app, "start_gateway", "Start Gateway", true, None::<&str>)?;
            let stop_gateway =
                MenuItem::with_id(app, "stop_gateway", "Stop Gateway", true, None::<&str>)?;
            let show_window =
                MenuItem::with_id(app, "show_window", "Show Window", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let separator2 = PredefinedMenuItem::separator(app)?;

            let menu = Menu::with_items(
                app,
                &[
                    &start_gateway,
                    &stop_gateway,
                    &separator,
                    &show_window,
                    &separator2,
                    &quit,
                ],
            )?;

            let tray_icon = tauri::include_image!("icons/icon.png");

            TrayIconBuilder::with_id("main-tray")
                .icon(tray_icon)
                .icon_as_template(true)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("ClawPond")
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "start_gateway" => {
                        let _ = app.emit("tray-gateway-action", "start");
                    }
                    "stop_gateway" => {
                        let _ = app.emit("tray-gateway-action", "stop");
                    }
                    "show_window" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
