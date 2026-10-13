mod defaults;
mod manager;
mod model;

use std::{path::PathBuf, sync::OnceLock};

pub use defaults::*;
pub use manager::ConfigManager;
pub use model::KidaConfig;

static CONFIG: OnceLock<KidaConfig> = OnceLock::new();

/// Load and publish the configuration once. Changes require a restart.
pub fn init(path: impl Into<PathBuf>) -> Result<(), Box<dyn std::error::Error>> {
    if CONFIG.get().is_some() {
        return Err(std::io::Error::other("configuration already initialized").into());
    }

    let manager = ConfigManager::load_or_create(path)?;
    CONFIG
        .set(manager.get().clone())
        .map_err(|_| std::io::Error::other("configuration already initialized"))?;
    Ok(())
}

/// Return the in-memory configuration without reading or creating any files.
pub fn get() -> Result<&'static KidaConfig, &'static str> {
    CONFIG.get().ok_or("configuration not initialized")
}

#[cfg(test)]
mod tests;
