mod config;
mod docker;
mod error;
mod gateway;
pub mod local_process;
mod models;

pub use config::GatewayConfig;
pub use docker::{
    browser_down, browser_status, browser_up, check_docker_env, check_image_update,
    compose_down, compose_stats, compose_status, compose_up, compose_up_with_progress,
    inspect_image, migrate_compose_to_shared_browser, pull_image_with_progress,
    resolve_playwright_image, update_browser_sidecar, write_auth_profiles, write_browser_compose,
    write_compose_files, write_openclaw_config, ComposeConfig, ComposeUpProgress, ContainerStats,
    DockerEnvStatus, ImageUpdateInfo, PullProgress, PullResult, ServiceStatus,
};
pub use error::ClawkingError;
pub use gateway::MasterGateway;
pub use local_process::{
    check_openclaw_env, openclaw_home, openclaw_start, openclaw_status, openclaw_stop,
    write_local_auth_profiles, write_local_config, write_local_env, LocalOpenClawConfig,
    LocalServiceStatus, OpenClawEnvStatus,
};
pub use models::{fetch_models, test_model, FetchModelsResult, TestModelResult};

pub type Result<T> = std::result::Result<T, ClawkingError>;
