//! KIDA generic persistence module
mod error;
#[cfg_attr(
    not(test),
    allow(
        dead_code,
        reason = "Used by Docker ownership persistence; covered by tests"
    )
)]
mod json;
mod toml;

pub use error::StorageError;
pub use json::JsonStorage;
pub use toml::TomlStorage;

use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
};

use serde::{Serialize, de::DeserializeOwned};
use uuid::Uuid;

pub trait Storage<T>
where
    T: Serialize + DeserializeOwned,
{
    fn load(&self) -> Result<T, StorageError>;
    fn save(&self, data: &T) -> Result<(), StorageError>;
}

pub(crate) fn atomic_write(path: &Path, content: &[u8]) -> Result<(), StorageError> {
    write_atomic(path, content, true)
}

fn atomic_create(path: &Path, content: &[u8]) -> Result<(), StorageError> {
    write_atomic(path, content, false)
}

fn write_atomic(path: &Path, content: &[u8], replace: bool) -> Result<(), StorageError> {
    if let Some(parent) = path.parent()
        && !parent.as_os_str().is_empty()
    {
        fs::create_dir_all(parent)?;
    }

    let temp_path = path.with_extension(format!("{}.tmp", Uuid::new_v4()));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp_path)?;

    let result = (|| -> Result<(), StorageError> {
        file.write_all(content)?;
        file.sync_all()?;
        if replace {
            fs::rename(&temp_path, path)?;
        } else {
            // Publish a complete file atomically, failing if the destination exists.
            fs::hard_link(&temp_path, path)?;
        }
        Ok(())
    })();
    drop(file);

    if !replace || result.is_err() {
        // Preserve the original error; only remove the temporary we created.
        let _ = fs::remove_file(&temp_path);
    }
    result
}

#[cfg(test)]
pub(crate) mod tests;
