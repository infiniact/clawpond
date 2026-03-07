use crate::{GatewayRegistry, Result, SpawnerError};
use clawking::GatewayConfig;
use log::info;

const MAX_GATEWAYS: usize = 32;

/// Manages the creation and lifecycle of additional gateway instances.
pub struct GatewaySpawner {
    registry: GatewayRegistry,
}

impl GatewaySpawner {
    pub fn new() -> Self {
        Self {
            registry: GatewayRegistry::new(),
        }
    }

    /// Spawn a new gateway with the given name and config.
    pub fn spawn(&mut self, name: String, config: GatewayConfig) -> Result<()> {
        if self.registry.count() >= MAX_GATEWAYS {
            return Err(SpawnerError::LimitReached(MAX_GATEWAYS));
        }
        if self.registry.get(&name).is_some() {
            return Err(SpawnerError::AlreadyExists(name));
        }
        info!("Spawning gateway '{}' at {}", name, config.endpoint);
        self.registry.add(name, config);
        Ok(())
    }

    /// Remove a gateway by name.
    pub fn remove(&mut self, name: &str) -> Result<()> {
        self.registry
            .remove(name)
            .ok_or_else(|| SpawnerError::NotFound(name.to_string()))?;
        info!("Removed gateway '{}'", name);
        Ok(())
    }

    /// Get a reference to the gateway registry.
    pub fn registry(&self) -> &GatewayRegistry {
        &self.registry
    }

    /// Replace the entire registry (used for snapshot import).
    pub fn restore_registry(&mut self, registry: GatewayRegistry) {
        info!("Restoring gateway registry ({} entries)", registry.count());
        self.registry = registry;
    }
}

impl Default for GatewaySpawner {
    fn default() -> Self {
        Self::new()
    }
}
