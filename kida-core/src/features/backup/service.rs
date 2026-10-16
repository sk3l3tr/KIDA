use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
};

use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::{
    error::BackupError,
    model::{
        BackupJob, BackupRunResult, BackupTargetResult, BackupTargetStatus, LifecycleCommand,
        NewBackupJob,
    },
    repository::BackupRepository,
};

use crate::{
    conf,
    exec::executor,
    infrastructure::comm::protocol::{CommandRequest, CommandStatus},
};

// Ownership moves with the blocking task, including when its async waiter is cancelled.
struct TemporaryArtifact {
    path: PathBuf,
}

impl Drop for TemporaryArtifact {
    fn drop(&mut self) {
        if let Err(error) = fs::remove_file(&self.path)
            && error.kind() != std::io::ErrorKind::NotFound
        {
            let _ = writeln!(
                std::io::stderr(),
                "WARN: Failed to remove backup temporary artifact {}: {error}",
                self.path.display()
            );
        }
    }
}

pub struct BackupService;

impl BackupService {
    pub fn list() -> Result<Vec<BackupJob>, BackupError> {
        let repository = configured_repository()?;

        repository.list()
    }

    pub fn create(input: NewBackupJob) -> Result<BackupJob, BackupError> {
        let repository = configured_repository()?;
        Self::create_in(input, &repository)
    }

    pub(crate) fn create_in(
        input: NewBackupJob,
        repository: &BackupRepository,
    ) -> Result<BackupJob, BackupError> {
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

        repository.create(&job)?;

        Ok(job)
    }

    pub fn delete(identifier: &str) -> Result<BackupJob, BackupError> {
        let repository = configured_repository()?;

        repository.delete(identifier)
    }

    pub async fn run(identifier: &str) -> Result<BackupRunResult, BackupError> {
        let repository = configured_repository()?;
        let job = repository.get(identifier)?;

        // 1. Validar sources
        for source in &job.sources {
            if !source.exists() {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    format!("backup source not found: {}", source.display()),
                )
                .into());
            }
        }

        // 2. Validar targets requeridos
        for target in &job.targets {
            if target.required && !target.path.is_dir() {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    format!(
                        "required backup target unavailable: {}",
                        target.path.display()
                    ),
                )
                .into());
            }
        }

        // 3. pre_backup
        if let Err(error) = run_lifecycle(&job.lifecycle.pre_backup).await {
            // Intentar recuperación aunque falle el pre_backup.
            let post = run_post_backup(&job.lifecycle.post_backup).await;
            return complete_with_post(Err(error), post);
        }

        let artifact_name = format!("{}-{}.tar.zst", job.name, chrono_timestamp());

        let artifact = TemporaryArtifact {
            path: std::env::temp_dir().join(format!("kida-{}-{artifact_name}", Uuid::new_v4())),
        };

        // 4. The blocking task owns the temporary until creation has finished.
        let sources = job.sources.clone();
        let creation = tokio::task::spawn_blocking(move || {
            let result = create_artifact(&sources, &artifact.path);
            (artifact, result)
        })
        .await
        .map_err(|error| {
            BackupError::from(std::io::Error::other(format!(
                "Backup artifact task failed: {error}"
            )))
        });

        // Attempt every recovery step after creation has stopped accessing sources.
        // Cancellation of this async task does not guarantee that post_backup runs.
        let post = run_post_backup(&job.lifecycle.post_backup).await;
        let creation = creation.and_then(|(artifact, result)| result.map(|()| artifact));
        let artifact = complete_with_post(creation, post)?;

        // 8-11. Finalization owns and cleans the temporary, even on early return.
        tokio::task::spawn_blocking(move || finalize_backup(job, artifact_name, artifact))
            .await
            .map_err(|error| {
                BackupError::from(std::io::Error::other(format!(
                    "Backup finalization task failed: {error}"
                )))
            })?
    }
}

fn configured_repository() -> Result<BackupRepository, BackupError> {
    Ok(BackupRepository::new(
        &conf::get()
            .map_err(std::io::Error::other)?
            .backup
            .backup_dir,
    ))
}

fn finalize_backup(
    job: BackupJob,
    artifact_name: String,
    artifact: TemporaryArtifact,
) -> Result<BackupRunResult, BackupError> {
    let checksum = sha256(&artifact.path)?;
    let size = fs::metadata(&artifact.path)?.len();

    // 9. Replicar + verificar
    let mut target_results = Vec::new();

    for target in &job.targets {
        if !target.path.is_dir() {
            target_results.push(BackupTargetResult {
                path: target.path.clone(),
                status: BackupTargetStatus::Unavailable,
                error: Some("target unavailable".to_string()),
            });

            continue;
        }

        let destination = target.path.join(&artifact_name);

        let result = (|| -> Result<(), BackupError> {
            fs::copy(&artifact.path, &destination)?;

            let destination_checksum = sha256(&destination)?;

            if destination_checksum != checksum {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    format!("checksum mismatch for {}", destination.display()),
                )
                .into());
            }

            Ok(())
        })();

        match result {
            Ok(()) => target_results.push(BackupTargetResult {
                path: target.path.clone(),
                status: BackupTargetStatus::Ok,
                error: None,
            }),

            Err(error) => target_results.push(BackupTargetResult {
                path: target.path.clone(),
                status: BackupTargetStatus::Failed,
                error: Some(error.to_string()),
            }),
        }
    }

    // 10. Comprobar destinos required
    let required_failed = job
        .targets
        .iter()
        .zip(&target_results)
        .any(|(target, result)| {
            target.required && !matches!(result.status, BackupTargetStatus::Ok)
        });

    if required_failed {
        return Err(std::io::Error::other("one or more required backup targets failed").into());
    }

    Ok(BackupRunResult {
        job_id: job.id,
        artifact_name,
        checksum,
        size,
        targets: target_results,
    })
}

fn complete_with_post<T>(
    primary: Result<T, BackupError>,
    post: Result<(), BackupError>,
) -> Result<T, BackupError> {
    match (primary, post) {
        (Ok(value), Ok(())) => Ok(value),
        (Err(primary), Ok(())) => Err(primary),
        (Ok(_), Err(post)) => Err(post),
        (Err(primary), Err(post)) => Err(BackupError::Recovery {
            primary: Box::new(primary),
            post: Box::new(post),
        }),
    }
}

async fn run_lifecycle(commands: &[LifecycleCommand]) -> Result<(), BackupError> {
    for command in commands {
        execute_lifecycle_command(command).await?;
    }
    Ok(())
}

async fn run_post_backup(commands: &[LifecycleCommand]) -> Result<(), BackupError> {
    let mut errors = Vec::new();
    for (index, command) in commands.iter().enumerate() {
        if let Err(error) = execute_lifecycle_command(command).await {
            errors.push(format!("step {} ({}): {error}", index + 1, command.command));
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(BackupError::PostBackup(errors.join("; ")))
    }
}

async fn execute_lifecycle_command(command: &LifecycleCommand) -> Result<(), BackupError> {
    let response = executor::execute_lifecycle(CommandRequest {
        id: Uuid::new_v4().to_string(),
        command: command.command.clone(),
        params: command.params.clone(),
    })
    .await;

    if matches!(response.status, CommandStatus::Error) {
        return Err(std::io::Error::other(
            response
                .error
                .unwrap_or_else(|| format!("lifecycle command failed: {}", command.command)),
        )
        .into());
    }
    Ok(())
}

fn create_artifact(sources: &[PathBuf], destination: &Path) -> Result<(), BackupError> {
    let file = File::create(destination)?;
    let encoder = zstd::Encoder::new(file, 3)?;
    let mut archive = tar::Builder::new(encoder);

    for source in sources {
        let archive_path = source.strip_prefix("/").unwrap_or(source);

        if source.is_dir() {
            archive.append_dir_all(archive_path, source)?;
        } else {
            archive.append_path_with_name(source, archive_path)?;
        }
    }

    let encoder = archive.into_inner()?;
    encoder.finish()?;

    Ok(())
}

fn sha256(path: &Path) -> Result<String, BackupError> {
    let mut file = File::open(path)?;
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

fn chrono_timestamp() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H-%M-%S").to_string()
}

#[cfg(test)]
#[path = "service_tests.rs"]
mod tests;
