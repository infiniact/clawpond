use claw_ui_bridge::AppState;
use std::sync::atomic::{AtomicU32, Ordering};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    webview::WebviewWindowBuilder,
    Emitter, Manager,
};

static WINDOW_COUNTER: AtomicU32 = AtomicU32::new(0);

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
    std::process::Command::new("which")
        .arg(&name)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[tauri::command]
async fn run_shell_command(command: String) -> Result<String, String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let output = std::process::Command::new(&shell)
        .args(["-l", "-c", &command])
        .output()
        .map_err(|e| e.to_string())?;
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    fix_path_env();

    tauri::Builder::default()
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            pick_directory,
            pick_files,
            check_binary_exists,
            run_shell_command,
            open_url_in_window,
            claw_ui_bridge::connect_master,
            claw_ui_bridge::get_master_status,
            claw_ui_bridge::spawn_gateway,
            claw_ui_bridge::list_gateways,
            claw_ui_bridge::remove_gateway,
            claw_ui_bridge::check_updates,
            claw_ui_bridge::apply_update,
            claw_ui_bridge::check_docker,
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
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
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
