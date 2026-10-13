use std::{io, path::PathBuf};

use thiserror::Error;

use crate::infrastructure::storage::StorageError;

#[derive(Debug, Error)]
pub enum BackupError {
    #[error("backup I/O error: {0}")]
    Io(#[from] io::Error),

    #[error(transparent)]
    Storage(#[from] StorageError),

    #[error("invalid backup configuration '{path}': {source}")]
    InvalidConfig {
        path: PathBuf,

        #[source]
        source: toml::de::Error,
    },
}
