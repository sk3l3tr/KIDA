use std::path::PathBuf;

use serde::{Serialize, de::DeserializeOwned};

use super::{JsonStorage, Storage, TomlStorage};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StorageFormat {
    Json,
    Toml,
}

pub struct StorageFactory;

impl StorageFactory {
    pub fn create<T>(
        format: StorageFormat,
        path: impl Into<PathBuf>,
    ) -> Box<dyn Storage<T> + Send + Sync>
    where
        T: Serialize + DeserializeOwned + Send + Sync + 'static,
    {
        let path = path.into();

        match format {
            StorageFormat::Json => Box::new(JsonStorage::<T>::new(path)),
            StorageFormat::Toml => Box::new(TomlStorage::<T>::new(path)),
        }
    }
}
