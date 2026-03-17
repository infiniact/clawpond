use log::{info, warn};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

trait HideConsole {
    fn hide_console(&mut self) -> &mut Self;
}

impl HideConsole for Command {
    #[cfg(target_os = "windows")]
    fn hide_console(&mut self) -> &mut Self {
        self.creation_flags(CREATE_NO_WINDOW)
    }
    #[cfg(not(target_os = "windows"))]
    fn hide_console(&mut self) -> &mut Self {
        self
    }
}

/// Result of checking the local OpenClaw environment.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenClawEnvStatus {
    pub node_installed: bool,
    pub node_version: Option<String>,
    pub openclaw_installed: bool,
    pub openclaw_version: Option<String>,
    pub npx_available: bool,
}

/// Configuration for starting a local OpenClaw gateway process.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalOpenClawConfig {
    pub port: String,
    pub bind: String,
    pub token: String,
}

/// Status of the local OpenClaw service.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalServiceStatus {
    pub running: bool,
    pub healthy: Option<bool>,
    pub pid: Option<u32>,
    pub error: Option<String>,
}

/// Resolve the OpenClaw home directory (~/.openclaw).
pub fn openclaw_home() -> PathBuf {
    dirs::home_dir()
        .map(|h| h.join(".openclaw"))
        .unwrap_or_else(|| PathBuf::from(".openclaw"))
}

/// Check if node, openclaw, and npx are available.
pub fn check_openclaw_env() -> OpenClawEnvStatus {
    let (node_installed, node_version) = detect_cmd("node", &["--version"]);
    let (openclaw_installed, openclaw_version) = detect_cmd("openclaw", &["--version"]);
    let (npx_available, _) = detect_cmd("npx", &["--version"]);

    info!(
        "OpenClaw env check: node={} openclaw={} npx={}",
        node_installed, openclaw_installed, npx_available
    );

    OpenClawEnvStatus {
        node_installed,
        node_version,
        openclaw_installed,
        openclaw_version,
        npx_available,
    }
}

/// Start the OpenClaw gateway as a local process.
/// Writes PID to ~/.openclaw/logs/openclaw.pid
/// Redirects output to ~/.openclaw/logs/openclaw.log
pub fn openclaw_start(config: &LocalOpenClawConfig) -> Result<(), String> {
    let home = openclaw_home();
    let logs_dir = home.join("logs");
    std::fs::create_dir_all(&logs_dir)
        .map_err(|e| format!("Failed to create logs directory: {}", e))?;

    let pid_path = logs_dir.join("openclaw.pid");
    let log_path = logs_dir.join("openclaw.log");

    // Check if already running
    if let Some(pid) = read_pid(&pid_path) {
        if is_process_alive(pid) {
            info!("OpenClaw already running with PID {}", pid);
            return Ok(());
        }
        // Stale PID file, remove it
        let _ = std::fs::remove_file(&pid_path);
    }

    // Open log file for output redirection
    let log_file = std::fs::File::create(&log_path)
        .map_err(|e| format!("Failed to create log file: {}", e))?;
    let log_stderr = log_file
        .try_clone()
        .map_err(|e| format!("Failed to clone log file handle: {}", e))?;

    // Build env vars from ~/.openclaw/.env
    let mut env_vars: HashMap<String, String> = HashMap::new();
    let env_path = home.join(".env");
    if env_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&env_path) {
            for line in content.lines() {
                let line = line.trim();
                if line.is_empty() || line.starts_with('#') {
                    continue;
                }
                if let Some((key, value)) = line.split_once('=') {
                    env_vars.insert(key.trim().to_string(), value.trim().to_string());
                }
            }
        }
    }

    // Try `openclaw` binary first, fallback to `npx openclaw`
    let base_cmd = if detect_cmd("openclaw", &["--version"]).0 {
        "openclaw".to_string()
    } else if detect_cmd("npx", &["--version"]).0 {
        "npx openclaw".to_string()
    } else {
        return Err("Neither 'openclaw' nor 'npx' found. Please install openclaw: npm install -g openclaw".to_string());
    };

    let full_cmd = format!(
        "{} gateway --port {} --bind {}",
        base_cmd, config.port, config.bind
    );

    info!("Starting OpenClaw: {}", full_cmd);

    // Launch through login shell so node/npx are on PATH
    let shell = login_shell();
    let child = Command::new(&shell)
        .args(["-l", "-i", "-c", &full_cmd])
        .envs(&env_vars)
        .env("OPENCLAW_GATEWAY_TOKEN", &config.token)
        .current_dir(&home)
        .stdout(log_file)
        .stderr(log_stderr)
        .hide_console()
        .spawn()
        .map_err(|e| format!("Failed to start openclaw: {}", e))?;

    let pid = child.id();

    // Write PID file
    std::fs::write(&pid_path, pid.to_string())
        .map_err(|e| format!("Failed to write PID file: {}", e))?;

    info!("OpenClaw started with PID {} (log: {})", pid, log_path.display());
    Ok(())
}

/// Stop the OpenClaw gateway by reading PID and sending SIGTERM.
pub fn openclaw_stop(home_dir: &Path) -> Result<(), String> {
    let pid_path = home_dir.join("logs/openclaw.pid");

    let pid = read_pid(&pid_path)
        .ok_or_else(|| "No PID file found — OpenClaw may not be running".to_string())?;

    if !is_process_alive(pid) {
        let _ = std::fs::remove_file(&pid_path);
        return Ok(());
    }

    info!("Stopping OpenClaw (PID {})", pid);

    // Send SIGTERM
    #[cfg(unix)]
    {
        unsafe {
            libc::kill(pid as i32, libc::SIGTERM);
        }
    }
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T"])
            .hide_console()
            .output();
    }

    // Wait up to 10 seconds for the process to exit
    for _ in 0..20 {
        if !is_process_alive(pid) {
            let _ = std::fs::remove_file(&pid_path);
            info!("OpenClaw stopped");
            return Ok(());
        }
        std::thread::sleep(std::time::Duration::from_millis(500));
    }

    // Force kill if still alive
    #[cfg(unix)]
    {
        warn!("OpenClaw did not exit gracefully, sending SIGKILL");
        unsafe {
            libc::kill(pid as i32, libc::SIGKILL);
        }
    }
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F", "/T"])
            .hide_console()
            .output();
    }

    let _ = std::fs::remove_file(&pid_path);
    Ok(())
}

/// Check if the local OpenClaw gateway is running.
/// Checks PID liveness + HTTP /healthz endpoint.
pub fn openclaw_status(home_dir: &Path, port: &str) -> LocalServiceStatus {
    let pid_path = home_dir.join("logs/openclaw.pid");
    let pid = read_pid(&pid_path);

    let process_alive = pid.map_or(false, is_process_alive);

    if !process_alive {
        // Clean up stale PID file
        if pid.is_some() {
            let _ = std::fs::remove_file(&pid_path);
        }
        return LocalServiceStatus {
            running: false,
            healthy: None,
            pid: None,
            error: None,
        };
    }

    // Check HTTP health
    let url = format!("http://127.0.0.1:{}/healthz", port);
    let healthy = match ureq::get(&url).call() {
        Ok(resp) => Some(resp.status().as_u16() == 200),
        Err(_) => Some(false),
    };

    LocalServiceStatus {
        running: true,
        healthy,
        pid,
        error: None,
    }
}

/// Write openclaw.json to ~/.openclaw/openclaw.json
pub fn write_local_config(home_dir: &Path, config_json: &str) -> Result<(), String> {
    std::fs::create_dir_all(home_dir)
        .map_err(|e| format!("Failed to create directory: {}", e))?;

    let path = home_dir.join("openclaw.json");
    std::fs::write(&path, config_json)
        .map_err(|e| format!("Failed to write openclaw.json: {}", e))?;

    info!("Wrote openclaw.json to {}", home_dir.display());
    Ok(())
}

/// Write auth-profiles.json to ~/.openclaw/agents/main/agent/auth-profiles.json
pub fn write_local_auth_profiles(home_dir: &Path, provider: &str, api_key: &str) -> Result<(), String> {
    if provider.is_empty() || api_key.is_empty() {
        return Ok(());
    }

    let agent_dir = home_dir.join("agents/main/agent");
    std::fs::create_dir_all(&agent_dir)
        .map_err(|e| format!("Failed to create agent dir: {}", e))?;

    let path = agent_dir.join("auth-profiles.json");

    // Read existing profiles if present
    let mut profiles: serde_json::Value = if path.exists() {
        let existing = std::fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read auth-profiles.json: {}", e))?;
        serde_json::from_str(&existing).unwrap_or_else(|_| {
            serde_json::json!({ "version": 1, "profiles": {} })
        })
    } else {
        serde_json::json!({ "version": 1, "profiles": {} })
    };

    if profiles.get("profiles").is_none() {
        profiles["profiles"] = serde_json::json!({});
    }

    let profile_key = format!("{}:manual", provider);
    profiles["profiles"][&profile_key] = serde_json::json!({
        "type": "token",
        "provider": provider,
        "token": api_key,
    });

    let content = serde_json::to_string_pretty(&profiles)
        .map_err(|e| format!("Failed to serialize auth profiles: {}", e))?;

    std::fs::write(&path, content.as_bytes())
        .map_err(|e| format!("Failed to write auth-profiles.json: {}", e))?;

    info!("Wrote auth-profiles.json to {}", agent_dir.display());
    Ok(())
}

/// Write .env file to ~/.openclaw/.env with the provided environment variables.
pub fn write_local_env(home_dir: &Path, env_vars: &HashMap<String, String>) -> Result<(), String> {
    std::fs::create_dir_all(home_dir)
        .map_err(|e| format!("Failed to create directory: {}", e))?;

    let env_path = home_dir.join(".env");

    let mut content = String::new();
    // Sort keys for consistent output
    let mut keys: Vec<&String> = env_vars.keys().collect();
    keys.sort();
    for key in keys {
        content.push_str(&format!("{}={}\n", key, env_vars[key]));
    }

    let mut f = std::fs::File::create(&env_path)
        .map_err(|e| format!("Failed to create .env: {}", e))?;
    f.write_all(content.as_bytes())
        .map_err(|e| format!("Failed to write .env: {}", e))?;

    info!("Wrote .env to {}", home_dir.display());
    Ok(())
}

// ── Helpers ──

/// Get the user's login shell.
fn login_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
}

/// Run a command through the user's login shell to inherit proper PATH.
/// Uses `shell -l -i -c "<cmd> <args>"`.
fn detect_cmd(cmd: &str, args: &[&str]) -> (bool, Option<String>) {
    let shell = login_shell();
    let full_cmd = if args.is_empty() {
        cmd.to_string()
    } else {
        format!("{} {}", cmd, args.join(" "))
    };

    match Command::new(&shell)
        .args(["-l", "-i", "-c", &full_cmd])
        .hide_console()
        .output()
    {
        Ok(out) if out.status.success() => {
            let version = String::from_utf8_lossy(&out.stdout).trim().to_string();
            (true, Some(version))
        }
        _ => (false, None),
    }
}

fn read_pid(pid_path: &Path) -> Option<u32> {
    std::fs::read_to_string(pid_path)
        .ok()?
        .trim()
        .parse::<u32>()
        .ok()
}

fn is_process_alive(pid: u32) -> bool {
    #[cfg(unix)]
    {
        // kill(pid, 0) checks if process exists without sending a signal
        unsafe { libc::kill(pid as i32, 0) == 0 }
    }
    #[cfg(windows)]
    {
        Command::new("tasklist")
            .args(["/FI", &format!("PID eq {}", pid), "/NH"])
            .hide_console()
            .output()
            .map(|o| {
                let stdout = String::from_utf8_lossy(&o.stdout);
                stdout.contains(&pid.to_string())
            })
            .unwrap_or(false)
    }
}
