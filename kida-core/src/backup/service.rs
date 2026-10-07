use crate::backup::{error::BackupError, model::BackupJob, repository::BackupRepository};

pub struct BackupService;

impl BackupService {
    pub fn list() -> Result<Vec<BackupJob>, BackupError> {
        let repository = BackupRepository::new("/etc/kida/backups.d");

        repository.list()
    }
}
