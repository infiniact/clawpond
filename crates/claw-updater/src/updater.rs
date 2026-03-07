use crate::{Result, VersionInfo};
use log::info;

/// Manages update checking, downloading, and applying for OpenClaw components.
pub struct UpdateManager {
    components: Vec<VersionInfo>,
}

impl UpdateManager {
    pub fn new() -> Self {
        Self {
            components: Vec::new(),
        }
    }

    /// Register a component to be tracked for updates.
    pub fn track(&mut self, component: &str, current_version: &str) {
        self.components
            .push(VersionInfo::new(component, current_version));
    }

    /// Check all tracked components for available updates.
    pub fn check_all(&mut self) -> Result<Vec<&VersionInfo>> {
        info!("Checking updates for {} components", self.components.len());
        // TODO: query remote update API
        Ok(self.components.iter().filter(|c| c.has_update()).collect())
    }

    /// Apply an update to a specific component.
    pub fn apply(&self, component: &str) -> Result<()> {
        info!("Applying update for component '{}'", component);
        // TODO: download and install
        Ok(())
    }

    pub fn components(&self) -> &[VersionInfo] {
        &self.components
    }

    /// Replace all tracked components (used for snapshot import).
    pub fn restore_components(&mut self, components: Vec<VersionInfo>) {
        info!("Restoring {} tracked components", components.len());
        self.components = components;
    }
}

impl Default for UpdateManager {
    fn default() -> Self {
        Self::new()
    }
}
