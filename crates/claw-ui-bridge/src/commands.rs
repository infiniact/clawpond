use crate::AppState;
use crate::db;
use claw_export::PondSnapshot;
use clawking::GatewayConfig;
use serde::Serialize;
use std::collections::HashMap;
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

// -- Local OpenClaw process commands --

#[tauri::command]
pub async fn check_openclaw() -> clawking::OpenClawEnvStatus {
    tauri::async_runtime::spawn_blocking(clawking::check_openclaw_env)
        .await
        .unwrap_or_else(|_| clawking::OpenClawEnvStatus {
            node_installed: false,
            node_version: None,
            openclaw_installed: false,
            openclaw_version: None,
            npx_available: false,
        })
}

#[tauri::command]
pub async fn openclaw_start(_app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let home = clawking::openclaw_home();
        let env_path = home.join(".env");
        let mut port = "18789".to_string();
        let mut token = String::new();
        let mut bind = "lan".to_string();

        if env_path.exists() {
            if let Ok(content) = std::fs::read_to_string(&env_path) {
                for line in content.lines() {
                    let line = line.trim();
                    if let Some(val) = line.strip_prefix("OPENCLAW_GATEWAY_PORT=") {
                        port = val.to_string();
                    } else if let Some(val) = line.strip_prefix("OPENCLAW_GATEWAY_TOKEN=") {
                        token = val.to_string();
                    } else if let Some(val) = line.strip_prefix("OPENCLAW_GATEWAY_BIND=") {
                        bind = val.to_string();
                    }
                }
            }
        }

        let config = clawking::LocalOpenClawConfig { port, bind, token };
        clawking::openclaw_start(&config)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn openclaw_stop() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let home = clawking::openclaw_home();
        clawking::openclaw_stop(&home)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn openclaw_health() -> clawking::LocalServiceStatus {
    let home = clawking::openclaw_home();
    let env_path = home.join(".env");
    let mut port = "18789".to_string();

    if env_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&env_path) {
            for line in content.lines() {
                if let Some(val) = line.trim().strip_prefix("OPENCLAW_GATEWAY_PORT=") {
                    port = val.to_string();
                }
            }
        }
    }

    tauri::async_runtime::spawn_blocking(move || {
        clawking::openclaw_status(&home, &port)
    })
    .await
    .unwrap_or_else(|_| clawking::LocalServiceStatus {
        running: false,
        healthy: None,
        pid: None,
        error: Some("Health check task failed".into()),
    })
}

#[tauri::command]
pub fn write_local_config(
    config_json: serde_json::Value,
    gateway_port: String,
    gateway_bind: String,
    gateway_token: String,
    provider_env_key: String,
    provider_api_key: String,
) -> Result<(), String> {
    let home = clawking::openclaw_home();
    let workspace_dir = home.join("workspace");

    // Write openclaw.json to ~/.openclaw/openclaw.json
    let config_str = serde_json::to_string_pretty(&config_json)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    clawking::write_local_config(&home, &config_str)?;

    // Write .env with directory references for compatibility with existing commands
    let mut env_vars = std::collections::HashMap::new();
    env_vars.insert("OPENCLAW_WORKSPACE_DIR".to_string(), workspace_dir.to_string_lossy().to_string());
    env_vars.insert("OPENCLAW_GATEWAY_PORT".to_string(), gateway_port);
    env_vars.insert("OPENCLAW_GATEWAY_BIND".to_string(), gateway_bind);
    env_vars.insert("OPENCLAW_GATEWAY_TOKEN".to_string(), gateway_token);
    if !provider_env_key.is_empty() && !provider_api_key.is_empty() {
        env_vars.insert(provider_env_key, provider_api_key);
    }
    clawking::write_local_env(&home, &env_vars)?;

    // Create standard subdirectories
    std::fs::create_dir_all(home.join("workspace/memory"))
        .map_err(|e| format!("Failed to create workspace dirs: {}", e))?;
    std::fs::create_dir_all(home.join("workspace/tmp"))
        .map_err(|e| format!("Failed to create workspace dirs: {}", e))?;
    std::fs::create_dir_all(home.join("workspace/pond"))
        .map_err(|e| format!("Failed to create pond dir: {}", e))?;
    std::fs::create_dir_all(home.join("logs"))
        .map_err(|e| format!("Failed to create logs dir: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn write_local_auth_profiles(
    provider: String,
    api_key: String,
) -> Result<(), String> {
    let home = clawking::openclaw_home();
    clawking::write_local_auth_profiles(&home, &provider, &api_key)
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
    // Check new standard location first
    if let Some(home) = dirs::home_dir() {
        let openclaw_home = home.join(".openclaw");
        if openclaw_home.join("openclaw.json").exists() {
            return Some("~/.openclaw".to_string());
        }
    }

    // Legacy locations
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

/// Migrate a pond gateway directory from a legacy location to the new ~/.openclaw/workspace/pond/ path.
/// Moves the directory and rewrites absolute paths in .env.
#[tauri::command]
pub fn migrate_pond_dir(old_root_dir: String, new_root_dir: String) -> Result<(), String> {
    let old_expanded = shellexpand::tilde(&old_root_dir).to_string();
    let new_expanded = shellexpand::tilde(&new_root_dir).to_string();
    let old_path = std::path::Path::new(&old_expanded);
    let new_path = std::path::Path::new(&new_expanded);

    if !old_path.exists() {
        return Err(format!("Source directory does not exist: {}", old_expanded));
    }
    if new_path.exists() {
        return Err(format!("Target directory already exists: {}", new_expanded));
    }

    // Ensure parent of new path exists
    if let Some(parent) = new_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create parent directory: {}", e))?;
    }

    // Move the directory
    std::fs::rename(old_path, new_path)
        .map_err(|e| format!("Failed to move directory: {}", e))?;

    // Rewrite .env: replace old absolute paths with new ones
    let env_path = new_path.join(".env");
    if env_path.exists() {
        let content = std::fs::read_to_string(&env_path)
            .map_err(|e| format!("Failed to read .env: {}", e))?;
        let updated = content.replace(&old_expanded, &new_expanded);
        std::fs::write(&env_path, updated)
            .map_err(|e| format!("Failed to write .env: {}", e))?;
    }

    Ok(())
}

/// Read gateway connection info (port + token) from the .env file in the root dir.
#[tauri::command]
pub fn read_gateway_info(root_dir: String) -> Result<GatewayInfo, String> {
    let expanded = shellexpand::tilde(&root_dir).to_string();
    let env_path = std::path::Path::new(&expanded).join(".env");
    let content = std::fs::read_to_string(&env_path)
        .map_err(|e| format!("Failed to read .env: {}", e))?;

    let mut port = "18789".to_string();
    let mut token = String::new();

    for line in content.lines() {
        let line = line.trim();
        if let Some(val) = line.strip_prefix("OPENCLAW_GATEWAY_PORT=") {
            port = val.to_string();
        } else if let Some(val) = line.strip_prefix("OPENCLAW_GATEWAY_TOKEN=") {
            token = val.to_string();
        }
    }

    Ok(GatewayInfo { port, token })
}

#[derive(Serialize)]
pub struct GatewayInfo {
    pub port: String,
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

/// Resolve the OPENCLAW_WORKSPACE_DIR from the .env file in root_dir.
fn resolve_workspace_dir(root_dir: &str) -> Result<std::path::PathBuf, String> {
    let expanded = shellexpand::tilde(root_dir).to_string();
    let env_path = std::path::Path::new(&expanded).join(".env");
    let content = std::fs::read_to_string(&env_path)
        .map_err(|e| format!("Failed to read .env: {}", e))?;

    let mut workspace_dir = None;
    for line in content.lines() {
        let line = line.trim();
        if let Some(val) = line.strip_prefix("OPENCLAW_WORKSPACE_DIR=") {
            workspace_dir = Some(val.to_string());
        }
    }

    let dir = workspace_dir.ok_or_else(|| "OPENCLAW_WORKSPACE_DIR not found in .env".to_string())?;
    let dir_expanded = shellexpand::tilde(&dir).to_string();
    Ok(std::path::PathBuf::from(dir_expanded))
}

/// Read scheduled tasks from {workspace}/memory/heartbeat-state.json.
#[tauri::command]
pub fn read_scheduled_tasks(root_dir: String) -> Result<serde_json::Value, String> {
    let workspace = resolve_workspace_dir(&root_dir)?;
    let path = workspace.join("memory/heartbeat-state.json");

    if !path.exists() {
        return Ok(serde_json::json!({
            "lastChecks": {},
            "cronJobs": {}
        }));
    }

    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read heartbeat-state.json: {}", e))?;
    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse heartbeat-state.json: {}", e))
}

/// Write scheduled tasks to {workspace}/memory/heartbeat-state.json.
#[tauri::command]
pub fn write_scheduled_tasks(root_dir: String, state: serde_json::Value) -> Result<(), String> {
    let workspace = resolve_workspace_dir(&root_dir)?;
    let memory_dir = workspace.join("memory");
    std::fs::create_dir_all(&memory_dir)
        .map_err(|e| format!("Failed to create memory directory: {}", e))?;

    let path = memory_dir.join("heartbeat-state.json");
    let content = serde_json::to_string_pretty(&state)
        .map_err(|e| format!("Failed to serialize state: {}", e))?;
    std::fs::write(&path, content)
        .map_err(|e| format!("Failed to write heartbeat-state.json: {}", e))
}

/// Read agents from `openclaw.json`: both `agents.list[]` (excluding "main")
/// and the main agent's `subagents.allowAgents[]`.
#[tauri::command]
pub fn list_workspace_agents(root_dir: String) -> Result<WorkspaceAgentsInfo, String> {
    let expanded = shellexpand::tilde(&root_dir).to_string();
    let config_path = std::path::Path::new(&expanded).join("config/openclaw.json");
    let content = match std::fs::read_to_string(&config_path) {
        Ok(c) => c,
        Err(_) => return Ok(WorkspaceAgentsInfo { agents: Vec::new(), allowed: Vec::new() }),
    };
    let json: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse openclaw.json: {}", e))?;

    let mut agents = Vec::new();
    let mut allowed = Vec::new();

    if let Some(list) = json.pointer("/agents/list").and_then(|v| v.as_array()) {
        for entry in list {
            if let Some(id) = entry.get("id").and_then(|v| v.as_str()) {
                if id == "main" {
                    // Extract allowAgents from the main entry
                    if let Some(allow) = entry.pointer("/subagents/allowAgents").and_then(|v| v.as_array()) {
                        for a in allow {
                            if let Some(s) = a.as_str() {
                                allowed.push(s.to_string());
                            }
                        }
                    }
                } else {
                    agents.push(id.to_string());
                }
            }
        }
    }
    agents.sort();
    allowed.sort();
    Ok(WorkspaceAgentsInfo { agents, allowed })
}

#[derive(Serialize)]
pub struct WorkspaceAgentsInfo {
    pub agents: Vec<String>,
    pub allowed: Vec<String>,
}

/// Toggle an agent in/out of the main agent's `subagents.allowAgents[]` in `openclaw.json`.
#[tauri::command]
pub fn toggle_agent_allowed(root_dir: String, agent_name: String, allow: bool) -> Result<(), String> {
    let expanded = shellexpand::tilde(&root_dir).to_string();
    let config_path = std::path::Path::new(&expanded).join("config/openclaw.json");
    let content = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read openclaw.json: {}", e))?;
    let mut json: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse openclaw.json: {}", e))?;

    // Find the main agent index
    let main_idx = json.pointer("/agents/list")
        .and_then(|v| v.as_array())
        .and_then(|list| list.iter().position(|e| e.get("id").and_then(|v| v.as_str()) == Some("main")))
        .ok_or_else(|| "main agent not found in agents.list".to_string())?;

    let path = format!("/agents/list/{}/subagents/allowAgents", main_idx);

    if allow {
        // Add to allowAgents
        if let Some(arr) = json.pointer_mut(&path).and_then(|v| v.as_array_mut()) {
            let name_val = serde_json::Value::String(agent_name.clone());
            if !arr.contains(&name_val) {
                arr.push(name_val);
            }
        } else {
            // Create subagents.allowAgents
            if let Some(main_entry) = json
                .pointer_mut(&format!("/agents/list/{}", main_idx))
                .and_then(|v| v.as_object_mut())
            {
                let subagents = main_entry
                    .entry("subagents")
                    .or_insert_with(|| serde_json::json!({}));
                if let Some(obj) = subagents.as_object_mut() {
                    obj.insert("allowAgents".to_string(), serde_json::json!([agent_name]));
                }
            }
        }
    } else {
        // Remove from allowAgents
        if let Some(arr) = json.pointer_mut(&path).and_then(|v| v.as_array_mut()) {
            arr.retain(|v| v.as_str() != Some(&agent_name));
        }
    }

    let output = serde_json::to_string_pretty(&json)
        .map_err(|e| format!("Failed to serialize openclaw.json: {}", e))?;
    std::fs::write(&config_path, output.as_bytes())
        .map_err(|e| format!("Failed to write openclaw.json: {}", e))?;
    Ok(())
}

/// Copy a gateway directory into ~/.openclaw/workspace/pond/{name}.
/// If the source is already under the pond directory, returns the original path unchanged.
/// Returns the new tilde-collapsed rootDir.
#[tauri::command]
pub fn copy_to_pond(root_dir: String, name: String) -> Result<String, String> {
    let expanded = shellexpand::tilde(&root_dir).to_string();
    let src = std::path::Path::new(&expanded);

    let home = dirs::home_dir().ok_or("Cannot resolve home directory")?;
    let pond_dir = home.join(".openclaw/workspace/pond");
    let dest_tilde = format!("~/.openclaw/workspace/pond/{}", name);
    let dest = pond_dir.join(&name);

    // Already in pond — no-op
    if src.starts_with(&pond_dir) {
        return Ok(root_dir);
    }

    if !src.exists() {
        return Err(format!("Source directory does not exist: {}", expanded));
    }

    std::fs::create_dir_all(&pond_dir)
        .map_err(|e| format!("Failed to create pond directory: {}", e))?;

    if dest.exists() {
        return Err(format!("Target already exists: {}", dest.display()));
    }

    copy_dir_recursive(src, &dest)?;

    Ok(dest_tilde)
}

fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(dst)
        .map_err(|e| format!("Failed to create {:?}: {}", dst, e))?;
    for entry in std::fs::read_dir(src)
        .map_err(|e| format!("Failed to read {:?}: {}", src, e))?
        .flatten()
    {
        let path = entry.path();
        let file_name = path.file_name().unwrap();
        let dest = dst.join(file_name);
        if path.is_dir() {
            copy_dir_recursive(&path, &dest)?;
        } else {
            std::fs::copy(&path, &dest)
                .map_err(|e| format!("Failed to copy {:?}: {}", file_name, e))?;
        }
    }
    Ok(())
}

// ── Disk scan: discover existing gateways not yet imported ──

#[derive(Serialize)]
pub struct DiscoveredGateway {
    #[serde(rename = "rootDir")]
    pub root_dir: String,
    #[serde(rename = "type")]
    pub gw_type: String, // "local" | "docker"
    pub name: String,
}

/// Scan well-known directories for gateway configs that may not be imported yet.
#[tauri::command]
pub fn scan_gateways() -> Vec<DiscoveredGateway> {
    let mut results = Vec::new();

    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return results,
    };

    // 1. Check ~/.openclaw/openclaw.json → local ClawKing
    let openclaw_home = home.join(".openclaw");
    if openclaw_home.join("openclaw.json").exists() {
        results.push(DiscoveredGateway {
            root_dir: "~/.openclaw".to_string(),
            gw_type: "local".to_string(),
            name: "ClawKing".to_string(),
        });
    }

    // 2. Scan ~/.openclaw/workspace/pond/* for docker gateways
    let pond_dir = openclaw_home.join("workspace/pond");
    if let Ok(entries) = std::fs::read_dir(&pond_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            if path.join("docker-compose.yml").exists()
                || path.join("config/openclaw.json").exists()
            {
                let dir_name = path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();
                results.push(DiscoveredGateway {
                    root_dir: format!("~/.openclaw/workspace/pond/{}", dir_name),
                    gw_type: "docker".to_string(),
                    name: dir_name,
                });
            }
        }
    }

    // 3. Legacy paths: ~/clawpond/clawking/pond/* and ~/clawpond/pond/*
    for legacy_base in &[
        home.join("clawpond/clawking/pond"),
        home.join("clawpond/pond"),
    ] {
        if let Ok(entries) = std::fs::read_dir(legacy_base) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }
                if path.join("docker-compose.yml").exists()
                    || path.join("config/openclaw.json").exists()
                {
                    let dir_name = path
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_string();
                    // Use tilde-collapsed path
                    let rel = path
                        .strip_prefix(&home)
                        .map(|p| format!("~/{}", p.to_string_lossy()))
                        .unwrap_or_else(|_| path.to_string_lossy().to_string());
                    results.push(DiscoveredGateway {
                        root_dir: rel,
                        gw_type: "docker".to_string(),
                        name: dir_name,
                    });
                }
            }
        }
    }

    results
}

// ── SQLite DB commands ──

#[tauri::command]
pub fn db_get_setting(key: String, state: State<AppState>) -> Result<Option<String>, String> {
    let guard = state.db()?;
    let conn = guard.as_ref().unwrap();
    db::get_setting(&conn, &key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_set_setting(key: String, value: String, state: State<AppState>) -> Result<(), String> {
    let guard = state.db()?;
    let conn = guard.as_ref().unwrap();
    db::set_setting(&conn, &key, &value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_delete_setting(key: String, state: State<AppState>) -> Result<(), String> {
    let guard = state.db()?;
    let conn = guard.as_ref().unwrap();
    db::delete_setting(&conn, &key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_load_gateways(state: State<AppState>) -> Result<Vec<db::StoredGateway>, String> {
    let guard = state.db()?;
    let conn = guard.as_ref().unwrap();
    db::load_gateways(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_save_gateways(gateways: Vec<db::StoredGateway>, state: State<AppState>) -> Result<(), String> {
    let guard = state.db()?;
    let conn = guard.as_ref().unwrap();
    db::save_gateways(&conn, &gateways).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_merge_messages(from_root_dir: String, to_root_dir: String, state: State<AppState>) -> Result<(), String> {
    let guard = state.db()?;
    let conn = guard.as_ref().unwrap();
    db::merge_messages(&conn, &from_root_dir, &to_root_dir).map_err(|e| e.to_string())
}

/// Merge workspace files (memory/ folder and *.md) from one gateway root into another.
/// When `append_md` is false, .md files that already exist at the destination are skipped.
/// When `append_md` is true, .md files that already exist are appended to (content concatenated).
/// After a successful merge, source files are deleted.
#[tauri::command]
pub fn merge_workspace_files(from_root_dir: String, to_root_dir: String, append_md: bool) -> Result<MergeFilesResult, String> {
    let from_ws = resolve_workspace_dir(&from_root_dir)?;
    let to_ws = resolve_workspace_dir(&to_root_dir)?;

    let mut copied = 0u32;
    let mut skipped = 0u32;
    let mut appended = 0u32;

    // 1. Merge memory/ directory (recursive, then delete source)
    let from_memory = from_ws.join("memory");
    let to_memory = to_ws.join("memory");
    if from_memory.is_dir() {
        std::fs::create_dir_all(&to_memory)
            .map_err(|e| format!("Failed to create memory dir: {}", e))?;
        merge_dir_recursive(&from_memory, &to_memory, append_md, &mut copied, &mut skipped, &mut appended)?;
        // Remove source memory dir after merge
        let _ = std::fs::remove_dir_all(&from_memory);
    }

    // 2. Merge *.md files at workspace root
    if from_ws.is_dir() {
        let entries: Vec<_> = std::fs::read_dir(&from_ws)
            .map(|rd| rd.flatten().collect())
            .unwrap_or_default();
        for entry in entries {
            let path = entry.path();
            if path.is_file() {
                if let Some(ext) = path.extension() {
                    if ext.eq_ignore_ascii_case("md") {
                        let file_name = path.file_name().unwrap();
                        let dest = to_ws.join(file_name);
                        if dest.exists() {
                            if append_md {
                                // Append source content to dest
                                let src_content = std::fs::read_to_string(&path)
                                    .map_err(|e| format!("Failed to read {:?}: {}", file_name, e))?;
                                use std::io::Write;
                                let mut f = std::fs::OpenOptions::new()
                                    .append(true)
                                    .open(&dest)
                                    .map_err(|e| format!("Failed to open {:?} for append: {}", file_name, e))?;
                                write!(f, "\n\n---\n\n{}", src_content)
                                    .map_err(|e| format!("Failed to append to {:?}: {}", file_name, e))?;
                                appended += 1;
                            } else {
                                skipped += 1;
                            }
                        } else {
                            std::fs::copy(&path, &dest)
                                .map_err(|e| format!("Failed to copy {:?}: {}", file_name, e))?;
                            copied += 1;
                        }
                        // Delete source .md after merge
                        let _ = std::fs::remove_file(&path);
                    }
                }
            }
        }
    }

    Ok(MergeFilesResult { copied, skipped, appended })
}

#[derive(Serialize)]
pub struct MergeFilesResult {
    pub copied: u32,
    pub skipped: u32,
    pub appended: u32,
}

/// Recursively copy files from src_dir to dst_dir.
/// For .md files when `append_md` is true, append content if dest exists.
/// Other files that already exist are skipped.
/// Source files are deleted after successful copy/append.
fn merge_dir_recursive(
    src_dir: &std::path::Path,
    dst_dir: &std::path::Path,
    append_md: bool,
    copied: &mut u32,
    skipped: &mut u32,
    appended: &mut u32,
) -> Result<(), String> {
    if let Ok(entries) = std::fs::read_dir(src_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let file_name = path.file_name().unwrap();
            let dest = dst_dir.join(file_name);

            if path.is_dir() {
                std::fs::create_dir_all(&dest)
                    .map_err(|e| format!("Failed to create dir {:?}: {}", dest, e))?;
                merge_dir_recursive(&path, &dest, append_md, copied, skipped, appended)?;
                // Remove empty source dir
                let _ = std::fs::remove_dir(&path);
            } else if path.is_file() {
                let is_md = path.extension()
                    .map(|e| e.eq_ignore_ascii_case("md"))
                    .unwrap_or(false);

                if dest.exists() {
                    if append_md && is_md {
                        let src_content = std::fs::read_to_string(&path)
                            .map_err(|e| format!("Failed to read {:?}: {}", file_name, e))?;
                        use std::io::Write;
                        let mut f = std::fs::OpenOptions::new()
                            .append(true)
                            .open(&dest)
                            .map_err(|e| format!("Failed to open {:?} for append: {}", file_name, e))?;
                        write!(f, "\n\n---\n\n{}", src_content)
                            .map_err(|e| format!("Failed to append to {:?}: {}", file_name, e))?;
                        *appended += 1;
                    } else {
                        *skipped += 1;
                    }
                } else {
                    std::fs::copy(&path, &dest)
                        .map_err(|e| format!("Failed to copy {:?}: {}", file_name, e))?;
                    *copied += 1;
                }
                // Delete source file after merge
                let _ = std::fs::remove_file(&path);
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn db_load_agent_icons(state: State<AppState>) -> Result<HashMap<String, String>, String> {
    let guard = state.db()?;
    let conn = guard.as_ref().unwrap();
    db::load_agent_icons(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_save_agent_icons(icons: HashMap<String, String>, state: State<AppState>) -> Result<(), String> {
    let guard = state.db()?;
    let conn = guard.as_ref().unwrap();
    db::save_agent_icons(&conn, &icons).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_load_messages(
    root_dir: String,
    offset: i64,
    limit: i64,
    state: State<AppState>,
) -> Result<db::LoadMessagesResult, String> {
    let guard = state.db()?;
    let conn = guard.as_ref().unwrap();
    db::load_messages(&conn, &root_dir, offset, limit).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_append_messages(
    root_dir: String,
    messages: Vec<db::ChatMessage>,
    state: State<AppState>,
) -> Result<(), String> {
    let guard = state.db()?;
    let conn = guard.as_ref().unwrap();
    db::append_messages(&conn, &root_dir, &messages).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_update_message(
    root_dir: String,
    id: String,
    updates: db::ChatMessage,
    state: State<AppState>,
) -> Result<(), String> {
    let guard = state.db()?;
    let conn = guard.as_ref().unwrap();
    db::update_message(&conn, &root_dir, &id, &updates).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_save_all_messages(
    root_dir: String,
    messages: Vec<db::ChatMessage>,
    state: State<AppState>,
) -> Result<(), String> {
    let guard = state.db()?;
    let conn = guard.as_ref().unwrap();
    db::save_all_messages(&conn, &root_dir, &messages).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_record_usage(
    gateway_id: String,
    tokens: i64,
    state: State<AppState>,
) -> Result<(), String> {
    let guard = state.db()?;
    let conn = guard.as_ref().unwrap();
    db::record_usage(&conn, &gateway_id, tokens).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_get_daily_usage(
    gateway_id: String,
    days: i32,
    state: State<AppState>,
) -> Result<Vec<db::DayUsage>, String> {
    let guard = state.db()?;
    let conn = guard.as_ref().unwrap();
    db::get_daily_usage(&conn, &gateway_id, days).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_get_hourly_usage(
    gateway_id: String,
    state: State<AppState>,
) -> Result<Vec<db::HourUsage>, String> {
    let guard = state.db()?;
    let conn = guard.as_ref().unwrap();
    db::get_today_hourly_usage(&conn, &gateway_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_persist_usage_bulk(
    gateway_id: String,
    hour_totals: HashMap<String, i64>,
    state: State<AppState>,
) -> Result<(), String> {
    let guard = state.db()?;
    let conn = guard.as_ref().unwrap();
    db::persist_usage_bulk(&conn, &gateway_id, &hour_totals).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_prune_old_usage(state: State<AppState>) -> Result<(), String> {
    let guard = state.db()?;
    let conn = guard.as_ref().unwrap();
    db::prune_old_usage(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_migrate_from_localstorage(
    payload: db::MigrationPayload,
    state: State<AppState>,
) -> Result<(), String> {
    let guard = state.db()?;
    let conn = guard.as_ref().unwrap();
    db::migrate_from_payload(&conn, &payload).map_err(|e| e.to_string())
}
/// `subagents.allowAgents[]`. Uses defaults from `agents.defaults` for model.
#[tauri::command]
pub fn add_workspace_agent(root_dir: String, agent_name: String) -> Result<(), String> {
    let expanded = shellexpand::tilde(&root_dir).to_string();
    let config_path = std::path::Path::new(&expanded).join("config/openclaw.json");
    let content = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read openclaw.json: {}", e))?;
    let mut json: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse openclaw.json: {}", e))?;

    // Check if agent already exists in list
    if let Some(list) = json.pointer("/agents/list").and_then(|v| v.as_array()) {
        if list.iter().any(|e| e.get("id").and_then(|v| v.as_str()) == Some(&agent_name)) {
            return Ok(()); // Already exists
        }
    }

    // Read default model from agents.defaults.model.primary
    let default_model = json
        .pointer("/agents/defaults/model/primary")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    // Build the new agent entry
    let new_agent = serde_json::json!({
        "id": agent_name,
        "name": agent_name,
        "workspace": format!("/home/node/.openclaw/workspace-{}", agent_name),
        "agentDir": format!("/home/node/.openclaw/agents/{}/agent", agent_name),
        "model": default_model,
    });

    // Append to agents.list
    if let Some(list) = json.pointer_mut("/agents/list").and_then(|v| v.as_array_mut()) {
        list.push(new_agent);
    } else {
        return Err("agents.list not found in openclaw.json".to_string());
    }

    // Add to main agent's subagents.allowAgents
    if let Some(list) = json.pointer("/agents/list").and_then(|v| v.as_array()) {
        if let Some(idx) = list.iter().position(|e| e.get("id").and_then(|v| v.as_str()) == Some("main")) {
            let path = format!("/agents/list/{}/subagents/allowAgents", idx);
            if let Some(allow) = json.pointer_mut(&path).and_then(|v| v.as_array_mut()) {
                let name_val = serde_json::Value::String(agent_name.clone());
                if !allow.contains(&name_val) {
                    allow.push(name_val);
                }
            } else {
                // Create subagents.allowAgents if it doesn't exist
                if let Some(main_entry) = json
                    .pointer_mut(&format!("/agents/list/{}", idx))
                    .and_then(|v| v.as_object_mut())
                {
                    let subagents = main_entry
                        .entry("subagents")
                        .or_insert_with(|| serde_json::json!({}));
                    if let Some(obj) = subagents.as_object_mut() {
                        obj.insert(
                            "allowAgents".to_string(),
                            serde_json::json!([agent_name]),
                        );
                    }
                }
            }
        }
    }

    // Write back with pretty formatting
    let output = serde_json::to_string_pretty(&json)
        .map_err(|e| format!("Failed to serialize openclaw.json: {}", e))?;
    std::fs::write(&config_path, output.as_bytes())
        .map_err(|e| format!("Failed to write openclaw.json: {}", e))?;

    Ok(())
}
