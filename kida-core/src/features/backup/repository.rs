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
struct StoredBackupJob(BackupJob);

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

#[cfg(test)]
mod tests {
    use super::super::{model::NewBackupJob, service::BackupService};
    use super::*;
    use serde_json::{Value, json};

    #[test]
    fn typed_creation_round_trips_free_json_and_repository_operations() {
        let directory = std::env::temp_dir().join(format!("kida-backup-{}", uuid::Uuid::new_v4()));
        let repository = BackupRepository::new(&directory);
        let fixture: Value =
            serde_json::from_str(include_str!("../../../../tests/fixtures/backup.json")).unwrap();
        let input: NewBackupJob = serde_json::from_value(fixture.clone()).unwrap();
        let job = BackupService::create_in(input, &repository).unwrap();
        assert_eq!(uuid::Uuid::parse_str(&job.id).unwrap().get_version_num(), 4);
        let mut value = serde_json::to_value(&job).unwrap();
        value.as_object_mut().unwrap().remove("id");
        assert_eq!(value, fixture);
        let toml_input: NewBackupJob =
            toml::from_str(include_str!("../../../../tests/fixtures/backup.toml")).unwrap();
        let toml_job = BackupService::create_in(toml_input, &repository).unwrap();
        let mut toml_value = serde_json::to_value(&toml_job).unwrap();
        toml_value.as_object_mut().unwrap().remove("id");
        assert_eq!(toml_value, fixture);
        repository.delete(&toml_job.id).unwrap();
        assert!(repository.create(&job).is_err());
        for loaded in [
            repository.get(&job.id).unwrap(),
            repository.get(&job.name).unwrap(),
            repository.list().unwrap().pop().unwrap(),
        ] {
            assert_eq!(
                serde_json::to_value(loaded).unwrap(),
                serde_json::to_value(&job).unwrap()
            );
        }
        assert_eq!(repository.delete(&job.name).unwrap().id, job.id);
        assert!(repository.list().unwrap().is_empty());
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn reads_legacy_toml_without_reinterpreting_strings() {
        let text = format!(
            "id = 'legacy'\n{}",
            include_str!("../../../../tests/fixtures/backup.toml")
        );
        let stored: StoredBackupJob = toml::from_str(&text).unwrap();
        assert_eq!(stored.0.lifecycle.pre_backup[0].params, Value::Null);
        assert_eq!(stored.0.lifecycle.post_backup[0].params, json!("null"));
        let minimal: StoredBackupJob = toml::from_str("id='old'\nname='old'\nsources=[]\ntargets=[]\ncompression='tar_zstd'\nschedule='[null]'\n").unwrap();
        assert_eq!(minimal.0.schedule, Some(json!("[null]")));
        assert!(minimal.0.lifecycle.pre_backup.is_empty());
    }

    #[test]
    fn scalar_and_nested_json_values_round_trip() {
        for value in [
            json!(null),
            json!("null"),
            json!(true),
            json!(42),
            json!([null, {}, [1]]),
            json!({"nested":{"null":null}}),
        ] {
            let mut job: BackupJob = serde_json::from_value(json!({"id":"id", "name":"name", "sources":[], "targets":[], "compression":"tar_zstd", "lifecycle":{"pre_backup":[{"command":"c", "params":value}]}})).unwrap();
            job.schedule = Some(value.clone());
            let encoded = toml::to_string(&StoredBackupJob(job)).unwrap();
            let loaded: StoredBackupJob = toml::from_str(&encoded).unwrap();
            // An explicit null schedule has the public Option<Value> semantics.
            assert_eq!(
                loaded.0.schedule,
                if value.is_null() {
                    None
                } else {
                    Some(value.clone())
                }
            );
            assert_eq!(loaded.0.lifecycle.pre_backup[0].params, value);
        }
        assert!(toml::from_str::<StoredBackupJob>("id='id'\nname='n'\nsources=[]\ntargets=[]\ncompression='tar_zstd'\nschedule_json='{'\n").is_err());
    }
}
