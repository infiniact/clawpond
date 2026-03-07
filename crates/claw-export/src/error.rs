use thiserror::Error;

#[derive(Debug, Error)]
pub enum ExportError {
    #[error("Export failed: {0}")]
    ExportFailed(String),

    #[error("Import failed: {0}")]
    ImportFailed(String),

    #[error("Invalid snapshot format: {0}")]
    InvalidFormat(String),

    #[error("Version mismatch: snapshot v{snapshot}, app v{app}")]
    VersionMismatch { snapshot: String, app: String },

    #[error(transparent)]
    Io(#[from] std::io::Error),

    #[error(transparent)]
    Serde(#[from] serde_json::Error),
}
