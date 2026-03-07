use thiserror::Error;

#[derive(Debug, Error)]
pub enum SpawnerError {
    #[error("Failed to spawn gateway: {0}")]
    SpawnFailed(String),

    #[error("Gateway '{0}' already exists")]
    AlreadyExists(String),

    #[error("Gateway '{0}' not found")]
    NotFound(String),

    #[error("Maximum gateway limit reached ({0})")]
    LimitReached(usize),

    #[error(transparent)]
    Clawking(#[from] clawking::ClawkingError),

    #[error(transparent)]
    Io(#[from] std::io::Error),
}
