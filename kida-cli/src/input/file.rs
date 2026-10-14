use std::{fs, path::Path};

use serde::de::DeserializeOwned;

use super::error::InputError;

pub fn read_toml<T: DeserializeOwned>(path: &Path) -> Result<T, InputError> {
    let content = fs::read_to_string(path)
        .map_err(|error| InputError::new(format!("cannot read file {}", path.display()), error))?;

    toml::from_str(&content)
        .map_err(|error| InputError::new(format!("invalid TOML in {}", path.display()), error))
}
