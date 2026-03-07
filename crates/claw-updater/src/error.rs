use thiserror::Error;

#[derive(Debug, Error)]
pub enum UpdateError {
    #[error("Update check failed: {0}")]
    CheckFailed(String),

    #[error("Download failed: {0}")]
    DownloadFailed(String),

    #[error("Installation failed: {0}")]
    InstallFailed(String),

    #[error("Already up to date")]
    AlreadyUpToDate,

    #[error(transparent)]
    Io(#[from] std::io::Error),

    #[error(transparent)]
    Serde(#[from] serde_json::Error),
}
