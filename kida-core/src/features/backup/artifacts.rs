use std::{
    fs::{self, File},
    io::{self, Read, Seek},
    path::{Component, Path, PathBuf},
};

use chrono::{DateTime, FixedOffset};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::{error::BackupError, health::model::ResolvedBackupArtifact};
use crate::infrastructure::storage::{JsonStorage, Storage};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct StoredArtifact {
    pub artifact_id: String,
    pub job_id: String,
    pub artifact_name: String,
    pub created_at: String,
    pub checksum: String,
    pub size: u64,
    pub destinations: Vec<PathBuf>,
}

pub(crate) struct ArtifactRepository {
    directory: PathBuf,
}

impl ArtifactRepository {
    pub fn new(data_root: impl AsRef<Path>) -> Self {
        Self {
            directory: data_root.as_ref().join("artifacts"),
        }
    }

    pub fn create(&self, artifact: &StoredArtifact) -> Result<(), BackupError> {
        validate(artifact)?;
        JsonStorage::new(self.path(&artifact.job_id, &artifact.artifact_id)?).create(artifact)?;
        Ok(())
    }

    pub fn resolve(
        &self,
        job_id: &str,
        version: &str,
    ) -> Result<ResolvedBackupArtifact, BackupError> {
        let job_id = canonical_id(job_id)?;
        let artifact = if version == "latest" {
            self.latest(&job_id)?
        } else {
            let id = canonical_id(version)?;
            self.load(&job_id, &id)?
        };
        let mut failures = Vec::new();
        for path in &artifact.destinations {
            let verified = (|| -> Result<(), BackupError> {
                if !fs::metadata(path)?.is_file() {
                    return Err(invalid("artifact is not a regular file"));
                }
                let mut file = File::open(path)?;
                let metadata = file.metadata()?;
                if !metadata.is_file() || metadata.len() != artifact.size {
                    return Err(invalid("artifact size or file type mismatch"));
                }
                if sha256_file(&mut file)? != artifact.checksum {
                    return Err(invalid("artifact checksum mismatch"));
                }
                Ok(())
            })();
            match verified {
                Ok(()) => {
                    return Ok(ResolvedBackupArtifact {
                        artifact_id: artifact.artifact_id,
                        job_id: artifact.job_id,
                        artifact_name: artifact.artifact_name,
                        created_at: artifact.created_at,
                        path: path.clone(),
                        checksum: artifact.checksum,
                        size: artifact.size,
                    });
                }
                Err(error) => failures.push(format!("{}: {error}", path.display())),
            }
        }
        Err(invalid(&format!(
            "no verified destination for artifact {}: {}",
            artifact.artifact_id,
            failures.join("; ")
        )))
    }

    fn path(&self, job_id: &str, artifact_id: &str) -> Result<PathBuf, BackupError> {
        Ok(self
            .directory
            .join(canonical_id(job_id)?)
            .join(format!("{}.json", canonical_id(artifact_id)?)))
    }

    fn load(&self, job_id: &str, id: &str) -> Result<StoredArtifact, BackupError> {
        let artifact = JsonStorage::<StoredArtifact>::new(self.path(job_id, id)?).load()?;
        validate(&artifact)?;
        if artifact.job_id != job_id || artifact.artifact_id != id {
            return Err(invalid("artifact identity does not match its catalog path"));
        }
        Ok(artifact)
    }

    fn latest(&self, job_id: &str) -> Result<StoredArtifact, BackupError> {
        let directory = self.directory.join(job_id);
        let entries = match fs::read_dir(directory) {
            Ok(entries) => entries,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return Err(io::Error::new(
                    io::ErrorKind::NotFound,
                    "no registered backup artifacts",
                )
                .into());
            }
            Err(error) => return Err(error.into()),
        };
        let mut latest: Option<(DateTime<FixedOffset>, StoredArtifact)> = None;
        for entry in entries {
            let path = entry?.path();
            if path.extension().and_then(|extension| extension.to_str()) != Some("json") {
                continue;
            }
            let id = path
                .file_stem()
                .and_then(|stem| stem.to_str())
                .ok_or_else(|| invalid("invalid artifact catalog filename"))?;
            let artifact = self.load(job_id, id)?;
            let date = timestamp(&artifact.created_at)?;
            if latest.as_ref().is_none_or(|(previous_date, previous)| {
                (&date, &artifact.artifact_id) > (previous_date, &previous.artifact_id)
            }) {
                latest = Some((date, artifact));
            }
        }
        latest.map(|(_, artifact)| artifact).ok_or_else(|| {
            io::Error::new(io::ErrorKind::NotFound, "no registered backup artifacts").into()
        })
    }
}

fn validate(artifact: &StoredArtifact) -> Result<(), BackupError> {
    if canonical_id(&artifact.job_id)? != artifact.job_id
        || canonical_id(&artifact.artifact_id)? != artifact.artifact_id
    {
        return Err(invalid("catalog identities must be canonical UUIDs"));
    }
    timestamp(&artifact.created_at)?;
    if !is_filename(&artifact.artifact_name)
        || !artifact.artifact_name.ends_with(".tar.zst")
        || artifact.checksum.len() != 64
        || !artifact
            .checksum
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
        || artifact.size == 0
        || artifact.destinations.is_empty()
        || artifact.destinations.iter().any(|path| {
            !path.is_absolute() || path.file_name() != Some(artifact.artifact_name.as_ref())
        })
    {
        return Err(invalid("invalid artifact metadata"));
    }
    Ok(())
}

fn timestamp(value: &str) -> Result<DateTime<FixedOffset>, BackupError> {
    let date =
        DateTime::parse_from_rfc3339(value).map_err(|_| invalid("invalid artifact timestamp"))?;
    if date.offset().local_minus_utc() != 0 {
        return Err(invalid("artifact timestamp must be UTC"));
    }
    Ok(date)
}

pub(crate) fn canonical_id(value: &str) -> Result<String, BackupError> {
    Uuid::parse_str(value)
        .map(|id| id.to_string())
        .map_err(|_| invalid("invalid artifact or backup UUID"))
}

pub(crate) fn is_filename(value: &str) -> bool {
    let mut components = Path::new(value).components();
    matches!(components.next(), Some(Component::Normal(_))) && components.next().is_none()
}

pub(crate) fn sha256(path: &Path) -> Result<String, BackupError> {
    sha256_file(&mut File::open(path)?)
}

pub(crate) fn sha256_file(file: &mut File) -> Result<String, BackupError> {
    file.rewind()?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn invalid(message: &str) -> BackupError {
    io::Error::new(
        io::ErrorKind::InvalidData,
        format!("backup artifact: {message}"),
    )
    .into()
}

#[cfg(test)]
#[path = "artifacts_tests.rs"]
mod tests;
