use crate::{ExportError, Result};
use claw_spawner::GatewayRegistry;
use claw_updater::VersionInfo;
use clawking::GatewayConfig;
use log::info;
use serde::{Deserialize, Serialize};
use std::path::Path;

const SNAPSHOT_VERSION: &str = "1";
const MAGIC: &str = "clawpond-snapshot";

/// A complete snapshot of the entire ClawPond configuration.
///
/// Contains the master gateway config, all spawned gateways, and
/// tracked component versions. Can be serialized to JSON for
/// backup/migration and deserialized to restore state.
#[derive(Debug, Serialize, Deserialize)]
pub struct PondSnapshot {
    /// Magic identifier for format validation.
    magic: String,
    /// Snapshot schema version for forward compatibility.
    pub version: String,
    /// ISO 8601 timestamp of when the snapshot was created.
    pub created_at: String,
    /// Master gateway configuration (if configured).
    pub master: Option<GatewayConfig>,
    /// All spawned gateway configurations.
    pub gateways: GatewayRegistry,
    /// Tracked component versions.
    pub components: Vec<VersionInfo>,
}

impl PondSnapshot {
    /// Create a snapshot from the current application state.
    pub fn capture(
        master: Option<&GatewayConfig>,
        gateways: &GatewayRegistry,
        components: &[VersionInfo],
    ) -> Self {
        Self {
            magic: MAGIC.to_string(),
            version: SNAPSHOT_VERSION.to_string(),
            created_at: now_iso8601(),
            master: master.cloned(),
            gateways: gateways.clone(),
            components: components.to_vec(),
        }
    }

    /// Export the snapshot to a JSON file.
    pub fn export_to_file(&self, path: &Path) -> Result<()> {
        let json = serde_json::to_string_pretty(self)?;
        std::fs::write(path, &json)?;
        info!("Snapshot exported to {}", path.display());
        Ok(())
    }

    /// Export the snapshot as a JSON string.
    pub fn export_to_string(&self) -> Result<String> {
        let json = serde_json::to_string_pretty(self)?;
        Ok(json)
    }

    /// Import a snapshot from a JSON file.
    pub fn import_from_file(path: &Path) -> Result<Self> {
        let json = std::fs::read_to_string(path)?;
        Self::import_from_string(&json)
    }

    /// Import a snapshot from a JSON string.
    pub fn import_from_string(json: &str) -> Result<Self> {
        let snapshot: Self = serde_json::from_str(json)?;
        snapshot.validate()?;
        info!(
            "Snapshot imported (v{}, created {})",
            snapshot.version, snapshot.created_at
        );
        Ok(snapshot)
    }

    /// Validate the snapshot integrity.
    fn validate(&self) -> Result<()> {
        if self.magic != MAGIC {
            return Err(ExportError::InvalidFormat(format!(
                "expected magic '{}', got '{}'",
                MAGIC, self.magic
            )));
        }
        // Allow importing older versions but warn on newer
        if self.version.parse::<u32>().unwrap_or(0)
            > SNAPSHOT_VERSION.parse::<u32>().unwrap_or(0)
        {
            return Err(ExportError::VersionMismatch {
                snapshot: self.version.clone(),
                app: SNAPSHOT_VERSION.to_string(),
            });
        }
        Ok(())
    }
}

fn now_iso8601() -> String {
    // Simple UTC timestamp without external chrono dependency
    let duration = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = duration.as_secs();
    // Rough conversion - good enough for snapshot metadata
    let days = secs / 86400;
    let rem = secs % 86400;
    let hours = rem / 3600;
    let minutes = (rem % 3600) / 60;
    let seconds = rem % 60;

    // Days since 1970-01-01 to Y-M-D (simplified)
    let (year, month, day) = days_to_ymd(days);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        year, month, day, hours, minutes, seconds
    )
}

fn days_to_ymd(mut days: u64) -> (u64, u64, u64) {
    let mut year = 1970;
    loop {
        let days_in_year = if is_leap(year) { 366 } else { 365 };
        if days < days_in_year {
            break;
        }
        days -= days_in_year;
        year += 1;
    }
    let months: [u64; 12] = if is_leap(year) {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };
    let mut month = 0;
    for m in months {
        if days < m {
            break;
        }
        days -= m;
        month += 1;
    }
    (year, month + 1, days + 1)
}

fn is_leap(year: u64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_snapshot() {
        let snapshot = PondSnapshot::capture(
            Some(&GatewayConfig::default()),
            &GatewayRegistry::new(),
            &[],
        );
        let json = snapshot.export_to_string().unwrap();
        let restored = PondSnapshot::import_from_string(&json).unwrap();
        assert_eq!(restored.version, SNAPSHOT_VERSION);
        assert!(restored.master.is_some());
    }

    #[test]
    fn reject_invalid_magic() {
        let json = r#"{"magic":"wrong","version":"1","created_at":"","master":null,"gateways":{"gateways":{}},"components":[]}"#;
        let err = PondSnapshot::import_from_string(json).unwrap_err();
        assert!(err.to_string().contains("magic"));
    }
}
