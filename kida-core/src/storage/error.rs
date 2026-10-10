use std::{io, path::PathBuf};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("storage file not found: {path:?}")]
    NotFound { path: PathBuf },

    #[error("storage I/O error: {0}")]
    Io(#[from] io::Error),

    #[error("JSON serialization failed: {0}")]
    JsonSerialize(serde_json::Error),

    #[error("invalid JSON file {path:?}: {source}")]
    JsonDeserialize {
        path: PathBuf,
        #[source]
        source: serde_json::Error,
    },

    #[error("TOML serialization failed: {0}")]
    TomlSerialize(#[from] toml::ser::Error),

    #[error("invalid TOML file {path:?}: {source}")]
    TomlDeserialize {
        path: PathBuf,
        #[source]
        source: toml::de::Error,
    },
}
