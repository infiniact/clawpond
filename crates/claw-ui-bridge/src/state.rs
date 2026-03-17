use crate::db;
use claw_spawner::GatewaySpawner;
use claw_updater::UpdateManager;
use clawking::MasterGateway;
use rusqlite::Connection;
use std::sync::Mutex;

/// Shared application state accessible from Tauri commands.
pub struct AppState {
    pub master: Mutex<Option<MasterGateway>>,
    pub spawner: Mutex<GatewaySpawner>,
    pub updater: Mutex<UpdateManager>,
    db: Mutex<Option<Connection>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            master: Mutex::new(None),
            spawner: Mutex::new(GatewaySpawner::new()),
            updater: Mutex::new(UpdateManager::new()),
            db: Mutex::new(None),
        }
    }

    /// Get the DB connection, lazily initializing on first access.
    pub fn db(&self) -> Result<std::sync::MutexGuard<'_, Option<Connection>>, String> {
        let mut guard = self.db.lock().map_err(|e| e.to_string())?;
        if guard.is_none() {
            let conn = db::open_or_create().map_err(|e| format!("Failed to open database: {}", e))?;
            *guard = Some(conn);
        }
        Ok(guard)
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
