use serde::{Deserialize, Serialize};

use super::defaults::*;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct KidaConfig {
    pub unix: UnixConfig,
    pub http: HttpConfig,
    pub backup: BackupConfig,
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

impl Default for KidaConfig {
    fn default() -> Self {
        Self {
            unix: UnixConfig::default(),
            http: HttpConfig::default(),
            backup: BackupConfig::default(),
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
