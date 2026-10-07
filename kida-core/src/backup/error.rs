use std::{io, path::PathBuf};

use thiserror::Error;

#[derive(Debug, Error)]
pub enum BackupError {
    #[error("backup configuration I/O error: {0}")]
    Io(#[from] io::Error),

    #[error("invalid backup configuration '{path}': {source}")]
    InvalidConfig {
        path: PathBuf,

        #[source]
        source: toml::de::Error,
    },
}
