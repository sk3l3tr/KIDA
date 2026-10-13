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

            let storage = TomlStorage::<BackupJob>::new(path);
            jobs.push(storage.load()?);
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

        let storage = TomlStorage::<BackupJob>::new(path);
        storage.save(job)?;

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

            let storage = TomlStorage::<BackupJob>::new(path);
            let job = storage.load()?;

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

            let storage = TomlStorage::<BackupJob>::new(&path);
            let job = storage.load()?;

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
