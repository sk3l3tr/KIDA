use serde::{Deserialize, Serialize};

use super::defaults::*;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct KidaConfig {
    pub unix: UnixConfig,
    pub http: HttpConfig,
    pub backup: BackupConfig,
    pub scheduler: SchedulerConfig,
    pub queue: QueueConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct UnixConfig {
    pub socket_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct HttpConfig {
    pub host: String,
    pub port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct BackupConfig {
    pub backup_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct SchedulerConfig {
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct QueueConfig {
    pub capacity: usize,
}

impl Default for KidaConfig {
    fn default() -> Self {
        Self {
            unix: UnixConfig::default(),
            http: HttpConfig::default(),
            backup: BackupConfig::default(),
            scheduler: SchedulerConfig::default(),
            queue: QueueConfig::default(),
        }
    }
}

impl Default for UnixConfig {
    fn default() -> Self {
        Self {
            socket_path: DEFAULT_UNIX_SOCKET_PATH.to_string(),
        }
    }
}

impl Default for HttpConfig {
    fn default() -> Self {
        Self {
            host: DEFAULT_HTTP_HOST.to_string(),
            port: DEFAULT_HTTP_PORT,
        }
    }
}

impl Default for BackupConfig {
    fn default() -> Self {
        Self {
            backup_dir: DEFAULT_BACKUP_DIRECTORY.to_string(),
        }
    }
}

impl Default for QueueConfig {
    fn default() -> Self {
        Self {
            capacity: DEFAULT_QUEUE_CAPACITY,
        }
    }
}

impl Default for SchedulerConfig {
    fn default() -> Self {
        Self {
            path: DEFAULT_SCHEDULER_PATH.to_string(),
        }
    }
}
