use std::{fs, path::Path};

use uuid::Uuid;

use crate::backup::{
    error::BackupError,
    model::{BackupJob, NewBackupJob},
    repository::BackupRepository,
};

pub struct BackupService;

impl BackupService {
    pub fn list() -> Result<Vec<BackupJob>, BackupError> {
        let repository = BackupRepository::new("/etc/kida/backups.d");

        repository.list()
    }

    pub fn create(path: &Path) -> Result<BackupJob, BackupError> {
        let content = fs::read_to_string(path)?;

        let input: NewBackupJob =
            toml::from_str(&content).map_err(|source| BackupError::InvalidConfig {
                path: path.to_path_buf(),
                source,
            })?;

        let job = BackupJob {
            id: Uuid::new_v4().to_string(),
            name: input.name,
            sources: input.sources,
            targets: input.targets,
            compression: input.compression,
            lifecycle: input.lifecycle,
            schedule: input.schedule,
            retention: input.retention,
        };

        let repository = BackupRepository::new("/etc/kida/backups.d");
        repository.create(&job)?;

        Ok(job)
    }
}
