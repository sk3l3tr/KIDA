use std::{
    fs,
    path::{Path, PathBuf},
};

use crate::backup::{error::BackupError, model::BackupJob};

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
}

fn is_toml(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension == "toml")
}
