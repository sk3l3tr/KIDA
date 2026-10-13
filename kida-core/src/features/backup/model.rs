use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct BackupConfiguration {
    #[serde(default)]
    pub jobs: Vec<BackupJob>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupJob {
    pub id: String,
    pub name: String,

    pub sources: Vec<PathBuf>,
    pub targets: Vec<BackupTarget>,

    pub compression: Compression,

    #[serde(default)]
    pub lifecycle: Lifecycle,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub schedule: Option<Value>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub retention: Option<RetentionPolicy>,
}

#[derive(Debug, Deserialize)]
pub struct NewBackupJob {
    pub name: String,

    pub sources: Vec<PathBuf>,
    pub targets: Vec<BackupTarget>,

    #[serde(default)]
    pub compression: Compression,

    #[serde(default)]
    pub lifecycle: Lifecycle,

    #[serde(default)]
    pub schedule: Option<Value>,

    #[serde(default)]
    pub retention: Option<RetentionPolicy>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupTarget {
    pub path: PathBuf,

    #[serde(default = "default_required")]
    pub required: bool,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub filesystem_uuid: Option<String>,
}

fn default_required() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Compression {
    TarZstd,
}

impl Default for Compression {
    fn default() -> Self {
        Self::TarZstd
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LifecycleCommand {
    pub command: String,

    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Lifecycle {
    #[serde(default)]
    pub pre_backup: Vec<LifecycleCommand>,

    #[serde(default)]
    pub post_backup: Vec<LifecycleCommand>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetentionPolicy {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_age: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub keep_last: Option<u32>,

    #[serde(default)]
    pub protected_restore_points: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum BackupTargetStatus {
    Ok,
    Failed,
    Unavailable,
}

#[derive(Debug, Clone, Serialize)]
pub struct BackupTargetResult {
    pub path: PathBuf,
    pub status: BackupTargetStatus,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BackupRunResult {
    pub job_id: String,
    pub artifact_name: String,
    pub checksum: String,
    pub size: u64,
    pub targets: Vec<BackupTargetResult>,
}
