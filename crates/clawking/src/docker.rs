use log::info;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Command, Stdio};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DockerEnvStatus {
    pub docker_installed: bool,
    pub docker_version: Option<String>,
    pub compose_installed: bool,
    pub compose_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PullProgress {
    /// 0..100
    pub percent: u8,
    /// e.g. "Downloading", "Extracting", "Pull complete"
    pub status: String,
    /// Number of layers completed
    pub layers_done: usize,
    /// Total number of layers discovered
    pub layers_total: usize,
    /// Current layer being processed (if any)
    pub current_layer: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PullResult {
    pub success: bool,
    pub image: String,
    pub image_id: Option<String>,
    pub error: Option<String>,
}

/// Detect whether docker and docker-compose are installed.
pub fn check_docker_env() -> DockerEnvStatus {
    let (docker_installed, docker_version) = detect_cmd("docker", &["--version"]);
    let (compose_installed, compose_version) = detect_compose();

    info!(
        "Docker env check: docker={} compose={}",
        docker_installed, compose_installed
    );

    DockerEnvStatus {
        docker_installed,
        docker_version,
        compose_installed,
        compose_version,
    }
}

/// Pull a Docker image, calling `on_progress` with each progress update.
pub fn pull_image_with_progress<F>(image: &str, on_progress: F) -> PullResult
where
    F: Fn(PullProgress),
{
    info!("Pulling docker image: {}", image);

    let mut child = match Command::new("docker")
        .args(["pull", image])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            return PullResult {
                success: false,
                image: image.to_string(),
                image_id: None,
                error: Some(format!("Failed to execute docker: {}", e)),
            };
        }
    };

    // Docker pull writes progress to stdout.
    // When piped (not a TTY), each status update is a separate line.
    // Format: "<layer_id>: <status>" or "Digest: ..." or "Status: ..."
    let stdout = child.stdout.take().expect("stdout piped");
    let reader = BufReader::new(stdout);

    // Track layer states: layer_id -> latest status keyword
    let mut layers: HashMap<String, String> = HashMap::new();
    let mut last_status: String;

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
        };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        last_status = trimmed.to_string();

        // Parse "<layer_id>: <status_text>"
        if let Some((layer_id, status_text)) = trimmed.split_once(": ") {
            let layer_id = layer_id.trim();
            let status_text = status_text.trim();

            // Skip meta lines like "Digest:", "Status:", "latest:"
            if !layer_id.contains(' ') && layer_id.len() <= 20 {
                let status_keyword = extract_status_keyword(status_text);
                layers.insert(layer_id.to_string(), status_keyword);
                last_status = status_text.to_string();
            }
        }

        let layers_total = layers.len().max(1);
        let layers_done = layers
            .values()
            .filter(|s| *s == "Pull complete" || *s == "Already exists")
            .count();

        let percent = if layers_total > 0 {
            ((layers_done as f64 / layers_total as f64) * 100.0) as u8
        } else {
            0
        };

        let current_layer = layers
            .iter()
            .find(|(_, s)| *s != "Pull complete" && *s != "Already exists")
            .map(|(id, _)| id.clone());

        on_progress(PullProgress {
            percent: percent.min(99), // reserve 100 for final success
            status: last_status.clone(),
            layers_done,
            layers_total,
            current_layer,
        });
    }

    let exit = child.wait();
    match exit {
        Ok(status) if status.success() => {
            let image_id = inspect_image(image);
            on_progress(PullProgress {
                percent: 100,
                status: "Pull complete".to_string(),
                layers_done: layers.len(),
                layers_total: layers.len(),
                current_layer: None,
            });
            PullResult {
                success: true,
                image: image.to_string(),
                image_id,
                error: None,
            }
        }
        Ok(_) => {
            // Collect stderr for error message
            let stderr_msg = child
                .stderr
                .take()
                .map(|s| {
                    let r = BufReader::new(s);
                    r.lines().filter_map(|l| l.ok()).collect::<Vec<_>>().join("\n")
                })
                .unwrap_or_default();
            PullResult {
                success: false,
                image: image.to_string(),
                image_id: None,
                error: Some(if stderr_msg.is_empty() {
                    "docker pull failed".to_string()
                } else {
                    stderr_msg
                }),
            }
        }
        Err(e) => PullResult {
            success: false,
            image: image.to_string(),
            image_id: None,
            error: Some(format!("Failed to wait for docker process: {}", e)),
        },
    }
}

/// Get the image ID if the image exists locally.
pub fn inspect_image(image: &str) -> Option<String> {
    let output = Command::new("docker")
        .args(["image", "inspect", image, "--format", "{{.Id}}"])
        .output()
        .ok()?;

    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        None
    }
}

fn extract_status_keyword(status_text: &str) -> String {
    // Status text may be: "Pulling fs layer", "Downloading [==>  ] 1.2MB/50MB",
    // "Download complete", "Extracting [==>  ] ...", "Pull complete", "Already exists"
    // Extract just the keyword before any bracket or size info
    if let Some(idx) = status_text.find('[') {
        status_text[..idx].trim().to_string()
    } else {
        status_text.to_string()
    }
}

fn detect_cmd(cmd: &str, args: &[&str]) -> (bool, Option<String>) {
    match Command::new(cmd).args(args).output() {
        Ok(out) if out.status.success() => {
            let version = String::from_utf8_lossy(&out.stdout).trim().to_string();
            (true, Some(version))
        }
        _ => (false, None),
    }
}

fn detect_compose() -> (bool, Option<String>) {
    // Try `docker compose version` first (v2 plugin)
    let (ok, ver) = detect_cmd("docker", &["compose", "version"]);
    if ok {
        return (true, ver);
    }
    // Fallback to standalone `docker-compose`
    let (ok, ver) = detect_cmd("docker-compose", &["--version"]);
    if ok {
        return (true, ver);
    }
    // Also try `docker-composer` (sometimes seen on macOS)
    detect_cmd("docker-composer", &["--version"])
}

/// Determine the compose command available on this system.
/// Returns ("docker", ["compose"]) for v2 plugin, or ("docker-compose", []) / ("docker-composer", []) for standalone.
fn compose_cmd() -> Option<(String, Vec<String>)> {
    if detect_cmd("docker", &["compose", "version"]).0 {
        Some(("docker".to_string(), vec!["compose".to_string()]))
    } else if detect_cmd("docker-compose", &["--version"]).0 {
        Some(("docker-compose".to_string(), vec![]))
    } else if detect_cmd("docker-composer", &["--version"]).0 {
        Some(("docker-composer".to_string(), vec![]))
    } else {
        None
    }
}

// ── Config generation ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComposeConfig {
    pub image: String,
    pub config_dir: String,
    pub workspace_dir: String,
    pub gateway_port: String,
    pub bridge_port: String,
    pub gateway_bind: String,
    pub gateway_token: String,
    /// Provider API key env var name, e.g. "ANTHROPIC_API_KEY"
    pub provider_env_key: String,
    /// Provider API key value
    pub provider_api_key: String,
    /// Global shared directory on host, mounted into all gateways
    pub shared_dir: String,
}

/// Write `.env` and `docker-compose.yml` to the given root directory.
pub fn write_compose_files(root_dir: &Path, cfg: &ComposeConfig) -> Result<(), String> {
    std::fs::create_dir_all(root_dir).map_err(|e| format!("Failed to create directory: {}", e))?;

    // Write .env
    let mut env_content = format!(
        "OPENCLAW_IMAGE={image}\n\
         OPENCLAW_CONFIG_DIR={config_dir}\n\
         OPENCLAW_WORKSPACE_DIR={workspace_dir}\n\
         OPENCLAW_GATEWAY_PORT={gateway_port}\n\
         OPENCLAW_BRIDGE_PORT={bridge_port}\n\
         OPENCLAW_GATEWAY_BIND={gateway_bind}\n\
         OPENCLAW_GATEWAY_TOKEN={gateway_token}\n",
        image = cfg.image,
        config_dir = cfg.config_dir,
        workspace_dir = cfg.workspace_dir,
        gateway_port = cfg.gateway_port,
        bridge_port = cfg.bridge_port,
        gateway_bind = cfg.gateway_bind,
        gateway_token = cfg.gateway_token,
    );
    // Append provider API key if set
    if !cfg.provider_env_key.is_empty() && !cfg.provider_api_key.is_empty() {
        env_content.push_str(&format!("{}={}\n", cfg.provider_env_key, cfg.provider_api_key));
    }
    // Append shared directory if set
    if !cfg.shared_dir.is_empty() {
        env_content.push_str(&format!("OPENCLAW_SHARED_DIR={}\n", cfg.shared_dir));
    }
    let env_path = root_dir.join(".env");
    let mut f = std::fs::File::create(&env_path)
        .map_err(|e| format!("Failed to create .env: {}", e))?;
    f.write_all(env_content.as_bytes())
        .map_err(|e| format!("Failed to write .env: {}", e))?;

    // Build the provider env line for docker-compose
    let provider_env_line = if !cfg.provider_env_key.is_empty() {
        format!(
            "\n      {key}: ${{{key}}}",
            key = cfg.provider_env_key
        )
    } else {
        String::new()
    };

    // Build the shared volume line for docker-compose
    let shared_volume_line = if !cfg.shared_dir.is_empty() {
        "\n      - ${OPENCLAW_SHARED_DIR}:/home/node/.openclaw/shared".to_string()
    } else {
        String::new()
    };

    // Write docker-compose.yml
    let compose_content = format!(
        r#"services:
  openclaw-gateway:
    image: ${{OPENCLAW_IMAGE:-ghcr.io/openclaw/openclaw:latest}}
    environment:
      HOME: /home/node
      TERM: xterm-256color
      OPENCLAW_GATEWAY_TOKEN: ${{OPENCLAW_GATEWAY_TOKEN}}{provider_env}
    volumes:
      - ${{OPENCLAW_CONFIG_DIR}}:/home/node/.openclaw
      - ${{OPENCLAW_WORKSPACE_DIR}}:/home/node/.openclaw/workspace{shared_vol}
    ports:
      - "127.0.0.1:${{OPENCLAW_GATEWAY_PORT:-18789}}:${{OPENCLAW_GATEWAY_PORT:-18789}}"
      - "127.0.0.1:${{OPENCLAW_BRIDGE_PORT:-18790}}:${{OPENCLAW_BRIDGE_PORT:-18790}}"
    init: true
    restart: unless-stopped
    command:
      - "node"
      - "dist/index.js"
      - "gateway"
      - "--bind"
      - "${{OPENCLAW_GATEWAY_BIND:-lan}}"
      - "--port"
      - "${{OPENCLAW_GATEWAY_PORT:-18789}}"
    healthcheck:
      test:
        - "CMD"
        - "node"
        - "-e"
        - "fetch('http://127.0.0.1:${{OPENCLAW_GATEWAY_PORT:-18789}}/healthz').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
      interval: 30s
      timeout: 5s
      retries: 5
      start_period: 20s

  openclaw-cli:
    image: ${{OPENCLAW_IMAGE:-ghcr.io/openclaw/openclaw:latest}}
    network_mode: "service:openclaw-gateway"
    cap_drop:
      - NET_RAW
      - NET_ADMIN
    security_opt:
      - no-new-privileges:true
    environment:
      HOME: /home/node
      TERM: xterm-256color
      OPENCLAW_GATEWAY_TOKEN: ${{OPENCLAW_GATEWAY_TOKEN}}{provider_env}
      BROWSER: echo
    volumes:
      - ${{OPENCLAW_CONFIG_DIR}}:/home/node/.openclaw
      - ${{OPENCLAW_WORKSPACE_DIR}}:/home/node/.openclaw/workspace{shared_vol}
    stdin_open: true
    tty: true
    init: true
    entrypoint: ["node", "dist/index.js"]
    depends_on:
      - openclaw-gateway
"#,
        provider_env = provider_env_line,
        shared_vol = shared_volume_line,
    );

    let compose_path = root_dir.join("docker-compose.yml");
    let mut f = std::fs::File::create(&compose_path)
        .map_err(|e| format!("Failed to create docker-compose.yml: {}", e))?;
    f.write_all(compose_content.as_bytes())
        .map_err(|e| format!("Failed to write docker-compose.yml: {}", e))?;

    // Create config and workspace sub-directories
    std::fs::create_dir_all(Path::new(&cfg.config_dir))
        .map_err(|e| format!("Failed to create config dir: {}", e))?;
    std::fs::create_dir_all(Path::new(&cfg.workspace_dir))
        .map_err(|e| format!("Failed to create workspace dir: {}", e))?;
    // Create shared directory if specified
    if !cfg.shared_dir.is_empty() {
        std::fs::create_dir_all(Path::new(&cfg.shared_dir))
            .map_err(|e| format!("Failed to create shared dir: {}", e))?;
    }

    info!("Wrote compose files to {}", root_dir.display());
    Ok(())
}

/// Write `openclaw.json` to the config directory.
/// Contains model selection, channel configs, and enabled skills.
pub fn write_openclaw_config(
    config_dir: &Path,
    openclaw_cfg: &serde_json::Value,
) -> Result<(), String> {
    std::fs::create_dir_all(config_dir)
        .map_err(|e| format!("Failed to create config dir: {}", e))?;

    let path = config_dir.join("openclaw.json");
    let content = serde_json::to_string_pretty(openclaw_cfg)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    let mut f =
        std::fs::File::create(&path).map_err(|e| format!("Failed to create openclaw.json: {}", e))?;
    f.write_all(content.as_bytes())
        .map_err(|e| format!("Failed to write openclaw.json: {}", e))?;

    info!("Wrote openclaw.json to {}", config_dir.display());
    Ok(())
}

/// Write auth-profiles.json for the main agent so it can find provider API keys.
pub fn write_auth_profiles(
    config_dir: &Path,
    provider: &str,
    api_key: &str,
) -> Result<(), String> {
    if provider.is_empty() || api_key.is_empty() {
        return Ok(());
    }

    let agent_dir = config_dir.join("agents/main/agent");
    std::fs::create_dir_all(&agent_dir)
        .map_err(|e| format!("Failed to create agent dir: {}", e))?;

    let profiles = serde_json::json!({
        "version": 1,
        "profiles": {
            format!("{}:manual", provider): {
                "type": "token",
                "provider": provider,
                "token": api_key,
            }
        }
    });

    let path = agent_dir.join("auth-profiles.json");
    let content = serde_json::to_string_pretty(&profiles)
        .map_err(|e| format!("Failed to serialize auth profiles: {}", e))?;

    let mut f =
        std::fs::File::create(&path).map_err(|e| format!("Failed to create auth-profiles.json: {}", e))?;
    f.write_all(content.as_bytes())
        .map_err(|e| format!("Failed to write auth-profiles.json: {}", e))?;

    info!("Wrote auth-profiles.json to {}", agent_dir.display());
    Ok(())
}

// ── Container stats ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContainerStats {
    pub cpu_percent: f64,
    pub mem_usage_mb: f64,
}

/// Get CPU and memory usage for the gateway container via `docker stats --no-stream`.
pub fn compose_stats(root_dir: &Path) -> Option<ContainerStats> {
    let (cmd, base_args) = compose_cmd()?;

    // Get the container ID for the gateway service
    let ps_output = Command::new(&cmd)
        .args(&base_args)
        .args(["-f", "docker-compose.yml", "ps", "-q", "openclaw-gateway"])
        .current_dir(root_dir)
        .output()
        .ok()?;

    if !ps_output.status.success() {
        return None;
    }

    let container_id = String::from_utf8_lossy(&ps_output.stdout).trim().to_string();
    if container_id.is_empty() {
        return None;
    }

    // Get stats via docker stats --no-stream
    let stats_output = Command::new("docker")
        .args([
            "stats", "--no-stream", "--format",
            "{{.CPUPerc}}\t{{.MemUsage}}",
            &container_id,
        ])
        .output()
        .ok()?;

    if !stats_output.status.success() {
        return None;
    }

    let line = String::from_utf8_lossy(&stats_output.stdout).trim().to_string();
    if line.is_empty() {
        return None;
    }

    // Parse "2.34%\t128.5MiB / 7.77GiB"
    let parts: Vec<&str> = line.split('\t').collect();
    if parts.len() < 2 {
        return None;
    }

    let cpu_percent = parts[0].trim_end_matches('%').parse::<f64>().ok()?;

    // Parse memory: take the first value (current usage) before " / "
    let mem_str = parts[1].split('/').next()?.trim();
    let mem_usage_mb = parse_mem_to_mb(mem_str)?;

    Some(ContainerStats {
        cpu_percent,
        mem_usage_mb,
    })
}

/// Parse a memory string like "128.5MiB", "1.2GiB", "500KiB" to MB.
fn parse_mem_to_mb(s: &str) -> Option<f64> {
    let s = s.trim();
    if let Some(val) = s.strip_suffix("GiB") {
        val.trim().parse::<f64>().ok().map(|v| v * 1024.0)
    } else if let Some(val) = s.strip_suffix("MiB") {
        val.trim().parse::<f64>().ok()
    } else if let Some(val) = s.strip_suffix("KiB") {
        val.trim().parse::<f64>().ok().map(|v| v / 1024.0)
    } else if let Some(val) = s.strip_suffix("GB") {
        val.trim().parse::<f64>().ok().map(|v| v * 1000.0)
    } else if let Some(val) = s.strip_suffix("MB") {
        val.trim().parse::<f64>().ok()
    } else if let Some(val) = s.strip_suffix("kB") {
        val.trim().parse::<f64>().ok().map(|v| v / 1000.0)
    } else if let Some(val) = s.strip_suffix("B") {
        val.trim().parse::<f64>().ok().map(|v| v / 1_000_000.0)
    } else {
        None
    }
}

// ── Service management ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceStatus {
    pub running: bool,
    pub healthy: Option<bool>,
    pub error: Option<String>,
}

/// Start the docker compose services in the given directory.
pub fn compose_up(root_dir: &Path) -> Result<(), String> {
    let (cmd, base_args) = compose_cmd().ok_or("Docker Compose not found")?;
    let output = Command::new(&cmd)
        .args(&base_args)
        .args(["-f", "docker-compose.yml", "up", "-d"])
        .current_dir(root_dir)
        .output()
        .map_err(|e| format!("Failed to run compose up: {}", e))?;

    if output.status.success() {
        info!("Compose up succeeded in {}", root_dir.display());
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        Err(format!("Compose up failed: {}", stderr))
    }
}

/// Stop the docker compose services in the given directory.
pub fn compose_down(root_dir: &Path) -> Result<(), String> {
    let (cmd, base_args) = compose_cmd().ok_or("Docker Compose not found")?;
    let output = Command::new(&cmd)
        .args(&base_args)
        .args(["-f", "docker-compose.yml", "down"])
        .current_dir(root_dir)
        .output()
        .map_err(|e| format!("Failed to run compose down: {}", e))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        Err(format!("Compose down failed: {}", stderr))
    }
}

/// Check if the gateway service is running and healthy.
pub fn compose_status(root_dir: &Path) -> ServiceStatus {
    let (cmd, base_args) = match compose_cmd() {
        Some(c) => c,
        None => return ServiceStatus { running: false, healthy: None, error: Some("Docker Compose not found".into()) },
    };

    let output = Command::new(&cmd)
        .args(&base_args)
        .args(["-f", "docker-compose.yml", "ps", "--format", "{{.State}}:{{.Health}}", "openclaw-gateway"])
        .current_dir(root_dir)
        .output();

    match output {
        Ok(out) if out.status.success() => {
            let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if stdout.is_empty() {
                return ServiceStatus { running: false, healthy: None, error: None };
            }
            let running = stdout.contains("running");
            let healthy = if stdout.contains("healthy") {
                Some(true)
            } else if stdout.contains("unhealthy") {
                Some(false)
            } else {
                None
            };
            ServiceStatus { running, healthy, error: None }
        }
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            ServiceStatus { running: false, healthy: None, error: Some(stderr) }
        }
        Err(e) => ServiceStatus { running: false, healthy: None, error: Some(e.to_string()) },
    }
}
