use std::{fs, io::ErrorKind, marker::PhantomData, path::PathBuf};

use serde::{Serialize, de::DeserializeOwned};

use super::{Storage, StorageError, atomic_write};

pub struct TomlStorage<T> {
    path: PathBuf,
    _marker: PhantomData<T>,
}

impl<T> TomlStorage<T> {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self {
            path: path.into(),
            _marker: PhantomData,
        }
    }
}

impl<T> Storage<T> for TomlStorage<T>
where
    T: Serialize + DeserializeOwned,
{
    fn load(&self) -> Result<T, StorageError> {
        let content = fs::read_to_string(&self.path).map_err(|error| {
            if error.kind() == ErrorKind::NotFound {
                StorageError::NotFound {
                    path: self.path.clone(),
                }
            } else {
                StorageError::Io(error)
            }
        })?;

        toml::from_str(&content).map_err(|source| StorageError::TomlDeserialize {
            path: self.path.clone(),
            source,
        })
    }

    fn save(&self, data: &T) -> Result<(), StorageError> {
        // Proteger ficheros existentes corruptos.
        match fs::read_to_string(&self.path) {
            Ok(content) => {
                let _: T =
                    toml::from_str(&content).map_err(|source| StorageError::TomlDeserialize {
                        path: self.path.clone(),
                        source,
                    })?;
            }
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => return Err(StorageError::Io(error)),
        }

        // Serializar antes de modificar el filesystem.
        let content = toml::to_string_pretty(data)?;

        atomic_write(&self.path, content.as_bytes())
    }
}
