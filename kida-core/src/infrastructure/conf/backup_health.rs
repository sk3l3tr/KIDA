use std::{
    fs, io,
    path::{Component, Path, PathBuf},
};

use serde::{Deserialize, Serialize};

use super::defaults::*;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct BackupHealthConfig {
    pub restore_root: PathBuf,
    pub data_root: PathBuf,
    pub manual_ttl_hours: u64,
    pub health_timeout_seconds: u64,
    pub report_retention_days: u64,
    pub max_active_runs: usize,
}

impl Default for BackupHealthConfig {
    fn default() -> Self {
        Self {
            restore_root: DEFAULT_HEALTH_RESTORE_ROOT.into(),
            data_root: DEFAULT_HEALTH_DATA_ROOT.into(),
            manual_ttl_hours: DEFAULT_HEALTH_MANUAL_TTL_HOURS,
            health_timeout_seconds: DEFAULT_HEALTH_TIMEOUT_SECONDS,
            report_retention_days: DEFAULT_HEALTH_REPORT_RETENTION_DAYS,
            max_active_runs: DEFAULT_HEALTH_MAX_ACTIVE_RUNS,
        }
    }
}

impl BackupHealthConfig {
    pub(super) fn validate(&self) -> io::Result<()> {
        if self.manual_ttl_hours == 0
            || self.manual_ttl_hours.checked_mul(3600).is_none()
            || self.health_timeout_seconds == 0
            || self.report_retention_days == 0
            || self.report_retention_days.checked_mul(86400).is_none()
            || self.max_active_runs == 0
            || self.max_active_runs > tokio::sync::Semaphore::MAX_PERMITS
        {
            return Err(invalid(
                "durations and max_active_runs must be positive and fit their limits",
            ));
        }

        let restore = resolved_root(&self.restore_root)?;
        let data = resolved_root(&self.data_root)?;
        if restore.starts_with(&data) || data.starts_with(&restore) {
            return Err(invalid("restore_root and data_root must not overlap"));
        }
        Ok(())
    }
}

fn invalid(message: &str) -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidInput,
        format!("backup_health: {message}"),
    )
}

// Resolve existing ancestors, including symlinks, without creating future roots.
fn resolved_root(path: &Path) -> io::Result<PathBuf> {
    if !path.is_absolute() {
        return Err(invalid("restore_root and data_root must be absolute paths"));
    }
    let mut resolved = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => continue,
            Component::ParentDir => {
                resolved.pop();
            }
            _ => resolved.push(component.as_os_str()),
        }
        match fs::symlink_metadata(&resolved) {
            Ok(_) => {
                resolved = fs::canonicalize(&resolved)?;
                if !resolved.is_dir() {
                    return Err(invalid("restore_root and data_root must name directories"));
                }
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => (),
            Err(error) => return Err(error),
        }
    }
    Ok(resolved)
}
