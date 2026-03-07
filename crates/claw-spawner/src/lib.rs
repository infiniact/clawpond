mod error;
mod registry;
mod spawner;

pub use error::SpawnerError;
pub use registry::GatewayRegistry;
pub use spawner::GatewaySpawner;

pub type Result<T> = std::result::Result<T, SpawnerError>;
