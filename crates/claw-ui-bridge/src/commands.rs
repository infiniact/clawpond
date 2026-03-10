use crate::AppState;
use claw_export::PondSnapshot;
use clawking::GatewayConfig;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

#[derive(Serialize)]
pub struct GatewayStatus {
    pub active: bool,
    pub endpoint: String,
}

#[derive(Serialize)]
pub struct SpawnedGateway {
    pub name: String,
    pub endpoint: String,
    pub active: bool,
}

// -- Clawking: master gateway commands --

#[tauri::command]
pub fn connect_master(endpoint: String, state: State<AppState>) -> Result<(), String> {
    let config = GatewayConfig {
        endpoint,
        token: None,
        active: true,
    };
    let mut master = state.master.lock().map_err(|e| e.to_string())?;
    *master = Some(clawking::MasterGateway::new(config));
    Ok(())
}

#[tauri::command]
pub fn get_master_status(state: State<AppState>) -> Result<Option<GatewayStatus>, String> {
    let master = state.master.lock().map_err(|e| e.to_string())?;
    Ok(master.as_ref().map(|m| GatewayStatus {
        active: m.is_active(),
        endpoint: m.config().endpoint.clone(),
    }))
}

// -- Claw-spawner: multi-gateway commands --

#[tauri::command]
pub fn spawn_gateway(name: String, endpoint: String, state: State<AppState>) -> Result<(), String> {
    let config = GatewayConfig {
        endpoint,
        token: None,
        active: false,
    };
    let mut spawner = state.spawner.lock().map_err(|e| e.to_string())?;
    spawner.spawn(name, config).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_gateways(state: State<AppState>) -> Result<Vec<SpawnedGateway>, String> {
    let spawner = state.spawner.lock().map_err(|e| e.to_string())?;
    let list = spawner
        .registry()
        .list()
        .iter()
        .map(|(name, config)| SpawnedGateway {
            name: name.clone(),
            endpoint: config.endpoint.clone(),
            active: config.active,
        })
        .collect();
    Ok(list)
}

#[tauri::command]
pub fn remove_gateway(name: String, state: State<AppState>) -> Result<(), String> {
    let mut spawner = state.spawner.lock().map_err(|e| e.to_string())?;
    spawner.remove(&name).map_err(|e| e.to_string())
}

// -- Claw-updater commands --

#[tauri::command]
pub fn check_updates(state: State<AppState>) -> Result<Vec<claw_updater::VersionInfo>, String> {
    let mut updater = state.updater.lock().map_err(|e| e.to_string())?;
    let updates = updater.check_all().map_err(|e| e.to_string())?;
    Ok(updates.into_iter().cloned().collect())
}

#[tauri::command]
pub fn apply_update(component: String, state: State<AppState>) -> Result<(), String> {
    let updater = state.updater.lock().map_err(|e| e.to_string())?;
    updater.apply(&component).map_err(|e| e.to_string())
}

// -- Docker environment commands --

/// Check if a TCP port is available (not in use).
#[tauri::command]
pub fn check_port_available(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_ok()
}

#[tauri::command]
pub fn check_docker() -> clawking::DockerEnvStatus {
    clawking::check_docker_env()
}

#[tauri::command]
pub async fn docker_pull_image(image: String, app: AppHandle) -> Result<clawking::PullResult, String> {
    let result = tauri::async_runtime::spawn_blocking(move || {
        clawking::pull_image_with_progress(&image, |progress| {
            let _ = app.emit("docker-pull-progress", &progress);
        })
    })
    .await
    .map_err(|e| e.to_string())?;

    if result.success {
        Ok(result)
    } else {
        Err(result.error.unwrap_or_else(|| "Unknown error".to_string()))
    }
}

#[tauri::command]
pub fn docker_image_exists(image: String) -> bool {
    clawking::inspect_image(&image).is_some()
}

#[tauri::command]
pub fn write_compose_config(
    root_dir: String,
    image: String,
    config_dir: String,
    workspace_dir: String,
    gateway_port: String,
    bridge_port: String,
    gateway_bind: String,
    gateway_token: String,
    provider_env_key: String,
    provider_api_key: String,
    shared_dir: String,
) -> Result<(), String> {
    let expanded = shellexpand::tilde(&root_dir).to_string();
    let cfg_expanded = shellexpand::tilde(&config_dir).to_string();
    let ws_expanded = shellexpand::tilde(&workspace_dir).to_string();
    let shared_expanded = if shared_dir.is_empty() {
        String::new()
    } else {
        shellexpand::tilde(&shared_dir).to_string()
    };

    clawking::write_compose_files(
        std::path::Path::new(&expanded),
        &clawking::ComposeConfig {
            image,
            config_dir: cfg_expanded,
            workspace_dir: ws_expanded,
            gateway_port,
            bridge_port,
            gateway_bind,
            gateway_token,
            provider_env_key,
            provider_api_key,
            shared_dir: shared_expanded,
        },
    )
}

#[tauri::command]
pub fn write_openclaw_config(
    config_dir: String,
    config_json: serde_json::Value,
) -> Result<(), String> {
    let expanded = shellexpand::tilde(&config_dir).to_string();
    clawking::write_openclaw_config(std::path::Path::new(&expanded), &config_json)
}

#[tauri::command]
pub fn write_auth_profiles(
    config_dir: String,
    provider: String,
    api_key: String,
) -> Result<(), String> {
    let expanded = shellexpand::tilde(&config_dir).to_string();
    clawking::write_auth_profiles(std::path::Path::new(&expanded), &provider, &api_key)
}

/// Check common root directories for an existing OpenClaw config.
/// Returns the root_dir if found, None otherwise.
#[tauri::command]
pub fn detect_config() -> Option<String> {
    let candidates = if cfg!(target_os = "windows") {
        vec![
            dirs::home_dir().map(|h| h.join("clawpond\\clawking").to_string_lossy().to_string()),
            dirs::home_dir().map(|h| h.join("clawpond").to_string_lossy().to_string()),
        ]
    } else {
        vec![
            Some("~/clawpond/clawking".to_string()),
            Some("~/clawpond".to_string()),
        ]
    };
    for candidate in candidates.into_iter().flatten() {
        let expanded = shellexpand::tilde(&candidate).to_string();
        let root = std::path::Path::new(&expanded);
        if root.join("docker-compose.yml").exists() || root.join("config/openclaw.json").exists() {
            return Some(candidate);
        }
    }
    None
}

/// Read gateway connection info (port + token) from the .env file in the root dir.
#[tauri::command]
pub fn read_gateway_info(root_dir: String) -> Result<GatewayInfo, String> {
    let expanded = shellexpand::tilde(&root_dir).to_string();
    let env_path = std::path::Path::new(&expanded).join(".env");
    let content = std::fs::read_to_string(&env_path)
        .map_err(|e| format!("Failed to read .env: {}", e))?;

    let mut port = "18789".to_string();
    let mut bridge_port = "18790".to_string();
    let mut token = String::new();

    for line in content.lines() {
        let line = line.trim();
        if let Some(val) = line.strip_prefix("OPENCLAW_GATEWAY_PORT=") {
            port = val.to_string();
        } else if let Some(val) = line.strip_prefix("OPENCLAW_BRIDGE_PORT=") {
            bridge_port = val.to_string();
        } else if let Some(val) = line.strip_prefix("OPENCLAW_GATEWAY_TOKEN=") {
            token = val.to_string();
        }
    }

    Ok(GatewayInfo { port, bridge_port, token })
}

#[derive(Serialize)]
pub struct GatewayInfo {
    pub port: String,
    pub bridge_port: String,
    pub token: String,
}

/// Read existing config from .env + config/openclaw.json for form pre-fill.
/// Secret fields (API keys, tokens) are excluded.
#[tauri::command]
pub fn read_existing_config(root_dir: String) -> Result<ExistingConfig, String> {
    let expanded = shellexpand::tilde(&root_dir).to_string();
    let root = std::path::Path::new(&expanded);

    let mut result = ExistingConfig::default();

    // Parse .env
    if let Ok(content) = std::fs::read_to_string(root.join(".env")) {
        for line in content.lines() {
            let line = line.trim();
            if let Some(val) = line.strip_prefix("OPENCLAW_IMAGE=") {
                result.image = Some(val.to_string());
            } else if let Some(val) = line.strip_prefix("OPENCLAW_GATEWAY_PORT=") {
                result.gateway_port = Some(val.to_string());
            } else if let Some(val) = line.strip_prefix("OPENCLAW_BRIDGE_PORT=") {
                result.bridge_port = Some(val.to_string());
            } else if let Some(val) = line.strip_prefix("OPENCLAW_GATEWAY_BIND=") {
                result.gateway_bind = Some(val.to_string());
            }
        }
    }

    // Parse config/openclaw.json
    if let Ok(content) = std::fs::read_to_string(root.join("config/openclaw.json")) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
            // Extract model name from agents.defaults.model
            if let Some(model) = json.pointer("/agents/defaults/model").and_then(|v| v.as_str()) {
                result.model_name = Some(model.to_string());
            }
            // Extract channels config (without secrets)
            if let Some(channels) = json.get("channels").and_then(|v| v.as_object()) {
                result.channels = Some(
                    serde_json::Value::Object(channels.clone()),
                );
            }
        }
    }

    Ok(result)
}

#[derive(Serialize, Default)]
pub struct ExistingConfig {
    pub image: Option<String>,
    pub gateway_port: Option<String>,
    pub bridge_port: Option<String>,
    pub gateway_bind: Option<String>,
    pub model_name: Option<String>,
    pub channels: Option<serde_json::Value>,
}

/// Read the full openclaw.json as a raw JSON value for in-place editing.
#[tauri::command]
pub fn read_openclaw_config(root_dir: String) -> Result<serde_json::Value, String> {
    let expanded = shellexpand::tilde(&root_dir).to_string();
    let path = std::path::Path::new(&expanded).join("config/openclaw.json");
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read openclaw.json: {}", e))?;
    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse openclaw.json: {}", e))
}

/// Update a single key=value in the .env file. Adds the key if not present.
#[tauri::command]
pub fn update_env_value(root_dir: String, key: String, value: String) -> Result<(), String> {
    let expanded = shellexpand::tilde(&root_dir).to_string();
    let env_path = std::path::Path::new(&expanded).join(".env");
    let content = std::fs::read_to_string(&env_path)
        .map_err(|e| format!("Failed to read .env: {}", e))?;

    let prefix = format!("{}=", key);
    let mut found = false;
    let mut lines: Vec<String> = content
        .lines()
        .map(|l| {
            if l.trim().starts_with(&prefix) {
                found = true;
                format!("{}={}", key, value)
            } else {
                l.to_string()
            }
        })
        .collect();
    if !found {
        lines.push(format!("{}={}", key, value));
    }

    std::fs::write(&env_path, lines.join("\n") + "\n")
        .map_err(|e| format!("Failed to write .env: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn migrate_gateway_compose(root_dir: String) -> Result<bool, String> {
    let expanded = shellexpand::tilde(&root_dir).to_string();
    tauri::async_runtime::spawn_blocking(move || {
        clawking::migrate_compose_to_shared_browser(std::path::Path::new(&expanded))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn browser_start(cdp_port: String, app: AppHandle) -> Result<(), String> {
    let browser_dir = shellexpand::tilde("~/clawpond/browser").to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let dir = std::path::Path::new(&browser_dir);
        clawking::write_browser_compose(dir, &cdp_port)?;
        let _ = app.emit("browser-progress", "Starting shared browser...");
        clawking::browser_up(dir)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn browser_stop() -> Result<(), String> {
    let browser_dir = shellexpand::tilde("~/clawpond/browser").to_string();
    tauri::async_runtime::spawn_blocking(move || {
        clawking::browser_down(std::path::Path::new(&browser_dir))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn browser_health() -> bool {
    let browser_dir = shellexpand::tilde("~/clawpond/browser").to_string();
    tauri::async_runtime::spawn_blocking(move || {
        clawking::browser_status(std::path::Path::new(&browser_dir))
    })
    .await
    .unwrap_or(false)
}

#[tauri::command]
pub async fn compose_start(root_dir: String, app: AppHandle) -> Result<(), String> {
    let expanded = shellexpand::tilde(&root_dir).to_string();
    tauri::async_runtime::spawn_blocking(move || {
        clawking::compose_up_with_progress(std::path::Path::new(&expanded), |progress| {
            let _ = app.emit("compose-start-progress", &progress);
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn compose_stop(root_dir: String) -> Result<(), String> {
    let expanded = shellexpand::tilde(&root_dir).to_string();
    tauri::async_runtime::spawn_blocking(move || {
        clawking::compose_down(std::path::Path::new(&expanded))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn compose_health(root_dir: String) -> clawking::ServiceStatus {
    let expanded = shellexpand::tilde(&root_dir).to_string();
    tauri::async_runtime::spawn_blocking(move || {
        clawking::compose_status(std::path::Path::new(&expanded))
    })
    .await
    .unwrap_or_else(|_| clawking::ServiceStatus {
        running: false,
        healthy: None,
        error: Some("Health check task failed".into()),
    })
}

#[tauri::command]
pub async fn compose_stats(root_dir: String) -> Option<clawking::ContainerStats> {
    let expanded = shellexpand::tilde(&root_dir).to_string();
    tauri::async_runtime::spawn_blocking(move || {
        clawking::compose_stats(std::path::Path::new(&expanded))
    })
    .await
    .ok()
    .flatten()
}

#[tauri::command]
pub async fn fetch_provider_models(
    provider: String,
    api_key: String,
    custom_endpoint: String,
) -> Result<clawking::FetchModelsResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        clawking::fetch_models(&provider, &api_key, &custom_endpoint)
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn test_provider_model(
    provider: String,
    api_key: String,
    custom_endpoint: String,
    model: String,
) -> Result<clawking::TestModelResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        clawking::test_model(&provider, &api_key, &custom_endpoint, &model)
    })
    .await
    .map_err(|e| e.to_string())
}

// -- Claw-export: snapshot commands --

#[tauri::command]
pub fn export_snapshot(state: State<AppState>) -> Result<String, String> {
    let master = state.master.lock().map_err(|e| e.to_string())?;
    let spawner = state.spawner.lock().map_err(|e| e.to_string())?;
    let updater = state.updater.lock().map_err(|e| e.to_string())?;

    let snapshot = PondSnapshot::capture(
        master.as_ref().map(|m| m.config()),
        spawner.registry(),
        updater.components(),
    );
    snapshot.export_to_string().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn export_snapshot_to_file(path: String, state: State<AppState>) -> Result<(), String> {
    let master = state.master.lock().map_err(|e| e.to_string())?;
    let spawner = state.spawner.lock().map_err(|e| e.to_string())?;
    let updater = state.updater.lock().map_err(|e| e.to_string())?;

    let snapshot = PondSnapshot::capture(
        master.as_ref().map(|m| m.config()),
        spawner.registry(),
        updater.components(),
    );
    snapshot
        .export_to_file(std::path::Path::new(&path))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn import_snapshot(json: String, state: State<AppState>) -> Result<(), String> {
    let snapshot = PondSnapshot::import_from_string(&json).map_err(|e| e.to_string())?;
    apply_snapshot(snapshot, &state)
}

#[tauri::command]
pub fn import_snapshot_from_file(path: String, state: State<AppState>) -> Result<(), String> {
    let snapshot =
        PondSnapshot::import_from_file(std::path::Path::new(&path)).map_err(|e| e.to_string())?;
    apply_snapshot(snapshot, &state)
}

fn apply_snapshot(snapshot: PondSnapshot, state: &State<AppState>) -> Result<(), String> {
    // Restore master
    let mut master = state.master.lock().map_err(|e| e.to_string())?;
    *master = snapshot.master.map(clawking::MasterGateway::new);

    // Restore spawned gateways
    let mut spawner = state.spawner.lock().map_err(|e| e.to_string())?;
    spawner.restore_registry(snapshot.gateways);

    // Restore tracked components
    let mut updater = state.updater.lock().map_err(|e| e.to_string())?;
    updater.restore_components(snapshot.components);

    Ok(())
}

/// Copy a file to {root_dir}/workspace/tmp/, creating the directory if needed.
/// Returns the destination path inside the container: /home/node/.openclaw/workspace/tmp/{filename}
#[tauri::command]
pub fn copy_to_workspace(root_dir: String, source_path: String) -> Result<String, String> {
    let expanded_root = shellexpand::tilde(&root_dir).to_string();
    let tmp_dir = std::path::Path::new(&expanded_root).join("workspace/tmp");
    std::fs::create_dir_all(&tmp_dir)
        .map_err(|e| format!("Failed to create workspace/tmp: {}", e))?;

    let src = std::path::Path::new(&source_path);
    let file_name = src
        .file_name()
        .ok_or_else(|| "Invalid source file path".to_string())?;

    let dest = tmp_dir.join(file_name);

    // If a file with the same name exists, add a numeric suffix
    let dest = if dest.exists() {
        let stem = src.file_stem().unwrap_or_default().to_string_lossy();
        let ext = src
            .extension()
            .map(|e| format!(".{}", e.to_string_lossy()))
            .unwrap_or_default();
        let mut n = 1u32;
        loop {
            let candidate = tmp_dir.join(format!("{}-{}{}", stem, n, ext));
            if !candidate.exists() {
                break candidate;
            }
            n += 1;
        }
    } else {
        dest
    };

    std::fs::copy(src, &dest)
        .map_err(|e| format!("Failed to copy file: {}", e))?;

    // Return the container-relative path
    let filename = dest.file_name().unwrap().to_string_lossy();
    Ok(format!("/home/node/.openclaw/workspace/tmp/{}", filename))
}

/// Save base64-encoded data to {root_dir}/workspace/tmp/{file_name}.
/// Returns the container path: /home/node/.openclaw/workspace/tmp/{filename}
#[tauri::command]
pub fn save_base64_to_workspace(
    root_dir: String,
    file_name: String,
    base64_data: String,
) -> Result<String, String> {
    use base64::Engine;

    let expanded_root = shellexpand::tilde(&root_dir).to_string();
    let tmp_dir = std::path::Path::new(&expanded_root).join("workspace/tmp");
    std::fs::create_dir_all(&tmp_dir)
        .map_err(|e| format!("Failed to create workspace/tmp: {}", e))?;

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&base64_data)
        .map_err(|e| format!("Failed to decode base64: {}", e))?;

    let src = std::path::Path::new(&file_name);
    let dest = tmp_dir.join(&file_name);

    // If a file with the same name exists, add a numeric suffix
    let dest = if dest.exists() {
        let stem = src.file_stem().unwrap_or_default().to_string_lossy();
        let ext = src
            .extension()
            .map(|e| format!(".{}", e.to_string_lossy()))
            .unwrap_or_default();
        let mut n = 1u32;
        loop {
            let candidate = tmp_dir.join(format!("{}-{}{}", stem, n, ext));
            if !candidate.exists() {
                break candidate;
            }
            n += 1;
        }
    } else {
        dest
    };

    std::fs::write(&dest, &bytes)
        .map_err(|e| format!("Failed to write file: {}", e))?;

    let filename = dest.file_name().unwrap().to_string_lossy();
    Ok(format!("/home/node/.openclaw/workspace/tmp/{}", filename))
}
