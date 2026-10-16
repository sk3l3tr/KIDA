use std::{fs, io::ErrorKind, marker::PhantomData, path::PathBuf};

use serde::{Serialize, de::DeserializeOwned};

use super::{Storage, StorageError, atomic_write};

pub struct JsonStorage<T> {
    path: PathBuf,
    _marker: PhantomData<T>,
}

impl<T> JsonStorage<T> {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self {
            path: path.into(),
            _marker: PhantomData,
        }
    }
}

impl<T> Storage<T> for JsonStorage<T>
where
    T: Serialize + DeserializeOwned,
{
    fn load(&self) -> Result<T, StorageError> {
        let content = fs::read(&self.path).map_err(|error| {
            if error.kind() == ErrorKind::NotFound {
                StorageError::NotFound {
                    path: self.path.clone(),
                }
            } else {
                StorageError::Io(error)
            }
        })?;

        serde_json::from_slice(&content).map_err(|source| StorageError::JsonDeserialize {
            path: self.path.clone(),
            source,
        })
    }

    fn save(&self, data: &T) -> Result<(), StorageError> {
        // Proteger ficheros existentes corruptos.
        match fs::read(&self.path) {
            Ok(content) => {
                let _: T = serde_json::from_slice(&content).map_err(|source| {
                    StorageError::JsonDeserialize {
                        path: self.path.clone(),
                        source,
                    }
                })?;
            }
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => return Err(StorageError::Io(error)),
        }

        // Serializar antes de modificar el filesystem.
        let content = serde_json::to_vec_pretty(data).map_err(StorageError::JsonSerialize)?;

        atomic_write(&self.path, &content)
    }
}
