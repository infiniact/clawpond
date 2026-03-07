use serde::{Deserialize, Serialize};

/// Configuration for the master OpenClaw gateway.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewayConfig {
    /// Gateway endpoint URL.
    pub endpoint: String,
    /// Authentication token.
    pub token: Option<String>,
    /// Whether this gateway is currently active.
    pub active: bool,
}

impl Default for GatewayConfig {
    fn default() -> Self {
        Self {
            endpoint: "http://localhost:18789".to_string(),
            token: None,
            active: false,
        }
    }
}
