use serde::{Deserialize, Serialize};

use super::{BackupHealthConfig, defaults::*};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct KidaConfig {
    pub docker: DockerConfig,
    pub unix: UnixConfig,
    pub http: HttpConfig,
    pub backup: BackupConfig,
    pub backup_health: BackupHealthConfig,
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
    pub max_concurrent_jobs: usize,
}

impl QueueConfig {
    pub(super) fn validate(&self) -> Result<(), std::io::Error> {
        if self.max_concurrent_jobs == 0
            || self.max_concurrent_jobs > tokio::sync::Semaphore::MAX_PERMITS
            || self
                .capacity
                .checked_add(self.max_concurrent_jobs)
                .is_none()
        {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "queue.max_concurrent_jobs must be positive and fit semaphore and admission limits",
            ));
        }
        Ok(())
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
            max_concurrent_jobs: DEFAULT_MAX_CONCURRENT_JOBS,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct DockerConfig {
    pub ownership_dir: String,
}
impl Default for DockerConfig {
    fn default() -> Self {
        Self {
            ownership_dir: DEFAULT_DOCKER_OWNERSHIP_DIR.into(),
        }
    }
}
