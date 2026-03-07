use clawking::GatewayConfig;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Tracks all spawned gateway instances by name.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GatewayRegistry {
    gateways: HashMap<String, GatewayConfig>,
}

impl GatewayRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add(&mut self, name: String, config: GatewayConfig) {
        self.gateways.insert(name, config);
    }

    pub fn remove(&mut self, name: &str) -> Option<GatewayConfig> {
        self.gateways.remove(name)
    }

    pub fn get(&self, name: &str) -> Option<&GatewayConfig> {
        self.gateways.get(name)
    }

    pub fn list(&self) -> &HashMap<String, GatewayConfig> {
        &self.gateways
    }

    pub fn count(&self) -> usize {
        self.gateways.len()
    }
}
