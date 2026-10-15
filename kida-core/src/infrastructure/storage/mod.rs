//! KIDA generic persistence module
mod error;
#[allow(dead_code, reason = "Retain the storage format selection interface")]
mod factory;
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
#[allow(unused_imports, reason = "Retain the storage factory interface")]
pub use factory::{StorageFactory, StorageFormat};
pub use json::JsonStorage;
pub use toml::TomlStorage;

use serde::{Serialize, de::DeserializeOwned};

pub trait Storage<T>
where
    T: Serialize + DeserializeOwned,
{
    fn load(&self) -> Result<T, StorageError>;
    fn save(&self, data: &T) -> Result<(), StorageError>;
}

#[cfg(test)]
pub(crate) mod tests;
