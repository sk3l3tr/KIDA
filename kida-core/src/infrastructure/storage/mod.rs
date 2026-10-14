//! KIDA generic persistence module
mod error;
mod factory;
mod json;
mod toml;

pub use error::StorageError;
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
