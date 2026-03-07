use claw_spawner::GatewaySpawner;
use claw_updater::UpdateManager;
use clawking::MasterGateway;
use std::sync::Mutex;

/// Shared application state accessible from Tauri commands.
pub struct AppState {
    pub master: Mutex<Option<MasterGateway>>,
    pub spawner: Mutex<GatewaySpawner>,
    pub updater: Mutex<UpdateManager>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            master: Mutex::new(None),
            spawner: Mutex::new(GatewaySpawner::new()),
            updater: Mutex::new(UpdateManager::new()),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
