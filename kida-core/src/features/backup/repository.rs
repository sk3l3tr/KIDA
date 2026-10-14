use std::{
    fs,
    io::{Error, ErrorKind},
    path::{Path, PathBuf},
};

use super::{error::BackupError, model::BackupJob};
use crate::infrastructure::storage::{Storage, TomlStorage};

pub struct BackupRepository {
    directory: PathBuf,
}

impl BackupRepository {
    pub fn new(directory: impl Into<PathBuf>) -> Self {
        Self {
            directory: directory.into(),
        }
    }

    pub fn list(&self) -> Result<Vec<BackupJob>, BackupError> {
        if !self.directory.exists() {
            return Ok(Vec::new());
        }

        let mut jobs = Vec::new();

        for entry in fs::read_dir(&self.directory)? {
            let path = entry?.path();

            if !is_toml(&path) {
                continue;
            }

            let storage = TomlStorage::<StoredBackupJob>::new(path);
            jobs.push(storage.load()?.0);
        }

        jobs.sort_by(|a, b| a.name.cmp(&b.name));

        Ok(jobs)
    }

    pub fn create(&self, job: &BackupJob) -> Result<(), BackupError> {
        fs::create_dir_all(&self.directory)?;

        let path = self.directory.join(format!("{}.toml", job.id));

        if path.exists() {
            return Err(Error::new(
                ErrorKind::AlreadyExists,
                format!("backup job '{}' already exists", job.id),
            )
            .into());
        }

        let storage = TomlStorage::<StoredBackupJob>::new(path);
        storage.save(&StoredBackupJob(job.clone()))?;

        Ok(())
    }

    pub fn get(&self, identifier: &str) -> Result<BackupJob, BackupError> {
        if !self.directory.exists() {
            return Err(not_found(identifier).into());
        }

        for entry in fs::read_dir(&self.directory)? {
            let path = entry?.path();

            if !is_toml(&path) {
                continue;
            }

            let storage = TomlStorage::<StoredBackupJob>::new(path);
            let job = storage.load()?.0;

            if job.id == identifier || job.name == identifier {
                return Ok(job);
            }
        }

        Err(not_found(identifier).into())
    }

    pub fn delete(&self, identifier: &str) -> Result<BackupJob, BackupError> {
        if !self.directory.exists() {
            return Err(not_found(identifier).into());
        }

        for entry in fs::read_dir(&self.directory)? {
            let path = entry?.path();

            if !is_toml(&path) {
                continue;
            }

            let storage = TomlStorage::<StoredBackupJob>::new(&path);
            let job = storage.load()?.0;

            if job.id == identifier || job.name == identifier {
                fs::remove_file(&path)?;
                return Ok(job);
            }
        }

        Err(not_found(identifier).into())
    }
}

fn is_toml(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext == "toml")
}

fn not_found(identifier: &str) -> Error {
    Error::new(
        ErrorKind::NotFound,
        format!("Backup job not found: {identifier}"),
    )
}

// Only free JSON fields use JSON strings on disk. Distinct keys preserve legacy
// TOML strings literally rather than guessing whether they contain encoded JSON.
pub struct StoredBackupJob(pub(crate) BackupJob);

impl serde::Serialize for StoredBackupJob {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::Error;
        let mut value = serde_json::to_value(&self.0).map_err(S::Error::custom)?;
        transform_json(&mut value, true).map_err(S::Error::custom)?;
        value.serialize(serializer)
    }
}

impl<'de> serde::Deserialize<'de> for StoredBackupJob {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        use serde::de::Error;
        let mut value = <serde_json::Value as serde::Deserialize>::deserialize(deserializer)?;
        transform_json(&mut value, false).map_err(D::Error::custom)?;
        serde_json::from_value(value)
            .map(Self)
            .map_err(D::Error::custom)
    }
}

fn transform_json(value: &mut serde_json::Value, encode: bool) -> Result<(), serde_json::Error> {
    fn field(
        object: &mut serde_json::Value,
        name: &str,
        encode: bool,
    ) -> Result<(), serde_json::Error> {
        let encoded = format!("{name}_json");
        if let Some(object) = object.as_object_mut() {
            if encode {
                if let Some(value) = object.remove(name) {
                    object.insert(
                        encoded,
                        serde_json::Value::String(serde_json::to_string(&value)?),
                    );
                }
            } else if let Some(value) = object.remove(&encoded) {
                let text: String = serde_json::from_value(value)?;
                object.insert(name.into(), serde_json::from_str(&text)?);
            }
        }
        Ok(())
    }
    field(value, "schedule", encode)?;
    for stage in ["pre_backup", "post_backup"] {
        if let Some(commands) = value
            .get_mut("lifecycle")
            .and_then(|lifecycle| lifecycle.get_mut(stage))
            .and_then(serde_json::Value::as_array_mut)
        {
            for command in commands {
                field(command, "params", encode)?;
            }
        }
    }
    Ok(())
}
