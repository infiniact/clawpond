use crate::{GatewayConfig, Result};
use log::info;

/// The master gateway controller.
///
/// Manages the lifecycle of the primary OpenClaw gateway: connecting,
/// monitoring health, and routing commands from the UI.
pub struct MasterGateway {
    config: GatewayConfig,
}

impl MasterGateway {
    pub fn new(config: GatewayConfig) -> Self {
        Self { config }
    }

    /// Connect to the master gateway.
    pub fn connect(&mut self) -> Result<()> {
        info!("Connecting to master gateway at {}", self.config.endpoint);
        self.config.active = true;
        Ok(())
    }

    /// Disconnect from the master gateway.
    pub fn disconnect(&mut self) -> Result<()> {
        info!("Disconnecting from master gateway");
        self.config.active = false;
        Ok(())
    }

    /// Check if the gateway is currently active.
    pub fn is_active(&self) -> bool {
        self.config.active
    }

    /// Return the current configuration.
    pub fn config(&self) -> &GatewayConfig {
        &self.config
    }
}
