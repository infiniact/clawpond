use thiserror::Error;

#[derive(Debug, Error)]
pub enum ClawkingError {
    #[error("Gateway connection failed: {0}")]
    ConnectionFailed(String),

    #[error("Gateway not configured")]
    NotConfigured,

    #[error("Invalid configuration: {0}")]
    InvalidConfig(String),

    #[error(transparent)]
    Io(#[from] std::io::Error),

    #[error(transparent)]
    Serde(#[from] serde_json::Error),
}
