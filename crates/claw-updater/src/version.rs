use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionInfo {
    pub component: String,
    pub current: String,
    pub latest: Option<String>,
}

impl VersionInfo {
    pub fn new(component: &str, current: &str) -> Self {
        Self {
            component: component.to_string(),
            current: current.to_string(),
            latest: None,
        }
    }

    pub fn has_update(&self) -> bool {
        self.latest
            .as_ref()
            .is_some_and(|latest| latest != &self.current)
    }
}
