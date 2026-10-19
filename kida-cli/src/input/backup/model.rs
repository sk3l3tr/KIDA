use serde::{Deserialize, Serialize};
use serde_json::Value;

use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize)]
pub struct NewBackupJob {
    pub name: String,
    pub sources: Vec<PathBuf>,
    pub targets: Vec<BackupTarget>,

    #[serde(default)]
    pub compression: Compression,

    #[serde(default)]
    pub lifecycle: Lifecycle,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schedule: Option<Value>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retention: Option<RetentionPolicy>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BackupTarget {
    pub path: PathBuf,

    #[serde(default = "default_required")]
    pub required: bool,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub filesystem_uuid: Option<String>,
}

pub fn default_required() -> bool {
    true
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Compression {
    #[default]
    TarZstd,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LifecycleCommand {
    pub command: String,

    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct Lifecycle {
    #[serde(default)]
    pub pre_backup: Vec<LifecycleCommand>,

    #[serde(default)]
    pub post_backup: Vec<LifecycleCommand>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RetentionPolicy {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_age: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub keep_last: Option<u32>,

    #[serde(default)]
    pub protected_restore_points: Vec<String>,
}
