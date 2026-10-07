use crate::backup::{error::BackupError, model::BackupJob};
use std::{
    fs,
    io::{Error, ErrorKind},
    path::{Path, PathBuf},
};

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
            let entry = entry?;
            let path = entry.path();

            if !is_toml(&path) {
                continue;
            }

            let content = fs::read_to_string(&path)?;

            let job: BackupJob =
                toml::from_str(&content).map_err(|source| BackupError::InvalidConfig {
                    path: path.clone(),
                    source,
                })?;

            jobs.push(job);
        }

        jobs.sort_by(|a, b| a.name.cmp(&b.name));

        Ok(jobs)
    }

    pub fn create(&self, job: &BackupJob) -> Result<(), BackupError> {
        fs::create_dir_all(&self.directory)?;

        let path = self.directory.join(format!("{}.toml", job.id));

        if path.exists() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::AlreadyExists,
                format!("backup job '{}' already exists", job.id),
            )
            .into());
        }

        let content = toml::to_string_pretty(job).map_err(BackupError::SerializeConfig)?;

        fs::write(path, content)?;

        Ok(())
    }

    pub fn delete(&self, identifier: &str) -> Result<BackupJob, BackupError> {
        if !self.directory.exists() {
            return Err(Error::new(
                ErrorKind::NotFound,
                format!("Backup job not found: {identifier}"),
            )
            .into());
        }

        for entry in fs::read_dir(&self.directory)? {
            let entry = entry?;
            let path = entry.path();

            if !is_toml(&path) {
                continue;
            }

            let content = fs::read_to_string(&path)?;

            let job: BackupJob =
                toml::from_str(&content).map_err(|source| BackupError::InvalidConfig {
                    path: path.clone(),
                    source,
                })?;

            if job.id == identifier || job.name == identifier {
                // TODO: cancel/remove associated schedule when scheduling exists.

                fs::remove_file(&path)?;

                return Ok(job);
            }
        }

        Err(Error::new(
            ErrorKind::NotFound,
            format!("Backup job not found: {identifier}"),
        )
        .into())
    }
}

fn is_toml(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension == "toml")
}
