mod config;
mod docker;
mod error;
mod gateway;
mod models;

pub use config::GatewayConfig;
pub use docker::{
    check_docker_env, compose_down, compose_stats, compose_status, compose_up, inspect_image,
    pull_image_with_progress, write_auth_profiles, write_compose_files, write_openclaw_config,
    ComposeConfig, ContainerStats, DockerEnvStatus, PullProgress, PullResult, ServiceStatus,
};
pub use error::ClawkingError;
pub use gateway::MasterGateway;
pub use models::{fetch_models, test_model, FetchModelsResult, TestModelResult};

pub type Result<T> = std::result::Result<T, ClawkingError>;
