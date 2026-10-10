use std::path::PathBuf;

use crate::storage::{Storage, StorageError, TomlStorage};

use super::model::KidaConfig;

pub struct ConfigManager {
    storage: TomlStorage<KidaConfig>,
    config: KidaConfig,
}

impl ConfigManager {
    pub fn load_or_create(path: impl Into<PathBuf>) -> Result<Self, Box<dyn std::error::Error>> {
        let storage = TomlStorage::new(path);

        let config = match storage.load() {
            Ok(config) => config,

            Err(StorageError::NotFound { .. }) => {
                let config = KidaConfig::default();
                storage.save(&config)?;
                config
            }

            Err(error) => return Err(error.into()),
        };

        Ok(Self { storage, config })
    }

    pub fn get(&self) -> &KidaConfig {
        &self.config
    }

    pub fn update(&mut self, config: KidaConfig) -> Result<(), Box<dyn std::error::Error>> {
        self.storage.save(&config)?;
        self.config = config;

        Ok(())
    }
}
