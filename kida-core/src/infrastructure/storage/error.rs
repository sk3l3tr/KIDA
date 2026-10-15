use std::{io, path::PathBuf};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("storage file not found: {path:?}")]
    NotFound { path: PathBuf },

    #[error("storage I/O error: {0}")]
    Io(#[from] io::Error),

    #[error("JSON serialization failed: {0}")]
    #[cfg_attr(
        not(test),
        allow(
            dead_code,
            reason = "Used by Docker ownership JSON persistence; covered by tests"
        )
    )]
    JsonSerialize(serde_json::Error),

    #[error("invalid JSON file {path:?}: {source}")]
    #[cfg_attr(
        not(test),
        allow(
            dead_code,
            reason = "Used by Docker ownership JSON persistence; covered by tests"
        )
    )]
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
