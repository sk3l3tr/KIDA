use std::{
    fs,
    path::{Path, PathBuf},
};

use super::model::KidaConfig;

pub struct ConfigManager {
    path: PathBuf,
    config: KidaConfig,
}

impl ConfigManager {
    pub fn load_or_create(path: impl Into<PathBuf>) -> Result<Self, Box<dyn std::error::Error>> {
        let path = path.into();

        let config = if path.exists() {
            let content = fs::read_to_string(&path)?;
            toml::from_str(&content)?
        } else {
            let config = KidaConfig::default();
            save_config(&path, &config)?;
            config
        };

        Ok(Self { path, config })
    }

    pub fn get(&self) -> &KidaConfig {
        &self.config
    }

    pub fn update(&mut self, config: KidaConfig) -> Result<(), Box<dyn std::error::Error>> {
        save_config(&self.path, &config)?;
        self.config = config;

        Ok(())
    }
}

fn save_config(path: &Path, config: &KidaConfig) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let content = toml::to_string_pretty(config)?;

    let tmp_path = path.with_extension("toml.tmp");

    fs::write(&tmp_path, content)?;
    fs::rename(tmp_path, path)?;

    Ok(())
}
