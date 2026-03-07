mod error;
mod updater;
mod version;

pub use error::UpdateError;
pub use updater::UpdateManager;
pub use version::VersionInfo;

pub type Result<T> = std::result::Result<T, UpdateError>;
