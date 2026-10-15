use std::{
    fs::{self, OpenOptions},
    io::{ErrorKind, Write},
    marker::PhantomData,
    path::PathBuf,
};

use serde::{Serialize, de::DeserializeOwned};
use uuid::Uuid;

use super::{Storage, StorageError};

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
        // 1. Proteger ficheros existentes corruptos.
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

        // 2. Serializar antes de modificar el filesystem.
        let content = toml::to_string_pretty(data)?;

        // 3. Crear directorio si es necesario.
        if let Some(parent) = self.path.parent()
            && !parent.as_os_str().is_empty()
        {
            fs::create_dir_all(parent)?;
        }

        // 4. Temporal único en el mismo filesystem.
        let temp_path = self.path.with_extension(format!("{}.tmp", Uuid::new_v4()));

        let result = (|| -> Result<(), StorageError> {
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temp_path)?;

            file.write_all(content.as_bytes())?;
            file.sync_all()?;

            // 5. Reemplazo atómico.
            fs::rename(&temp_path, &self.path)?;

            Ok(())
        })();

        // 6. Limpiar temporal si falla la escritura.
        if result.is_err() {
            let _ = fs::remove_file(&temp_path);
        }

        result
    }
}
