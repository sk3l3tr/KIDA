use std::{
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
};

use chrono::{DateTime, Utc};
use uuid::Uuid;

use super::{
    artifacts::{
        ArtifactRepository, StoredArtifact, canonical_id, is_filename, sha256, sha256_file,
    },
    error::BackupError,
    health::model::ResolvedBackupArtifact,
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

    #[cfg_attr(
        not(test),
        allow(
            dead_code,
            reason = "Artifact resolution awaits Health lifecycle integration"
        )
    )]
    pub fn resolve_artifact(
        identifier: &str,
        version: &str,
    ) -> Result<ResolvedBackupArtifact, BackupError> {
        let config = conf::get().map_err(io::Error::other)?;
        let job = configured_repository()?.get_unique(identifier)?;
        ArtifactRepository::new(&config.backup_health.data_root).resolve(&job.id, version)
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

        let artifact_id = Uuid::new_v4().to_string();
        canonical_id(&job.id)?;
        let created_at = Utc::now();
        let artifact_name = artifact_name(&job.name, &created_at, &artifact_id);
        if !is_filename(&artifact_name) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "backup name must not contain path components",
            )
            .into());
        }
        let catalog = ArtifactRepository::new(
            &conf::get()
                .map_err(io::Error::other)?
                .backup_health
                .data_root,
        );

        // 3. pre_backup
        if let Err(error) = run_lifecycle(&job.lifecycle.pre_backup).await {
            // Intentar recuperación aunque falle el pre_backup.
            let post = run_post_backup(&job.lifecycle.post_backup).await;
            return complete_with_post(Err(error), post);
        }

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
        tokio::task::spawn_blocking(move || {
            finalize_backup(
                job,
                artifact_id,
                created_at,
                artifact_name,
                artifact,
                catalog,
            )
        })
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
    artifact_id: String,
    created_at: DateTime<Utc>,
    artifact_name: String,
    artifact: TemporaryArtifact,
    catalog: ArtifactRepository,
) -> Result<BackupRunResult, BackupError> {
    let checksum = sha256(&artifact.path)?;
    let size = fs::metadata(&artifact.path)?.len();

    // 9. Replicar + verificar
    let mut target_results = Vec::new();
    let mut destinations = Vec::new();

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

        let result = copy_replica(&artifact.path, &destination, &checksum, size);

        match result {
            Ok(destination) => {
                destinations.push(destination);
                target_results.push(BackupTargetResult {
                    path: target.path.clone(),
                    status: BackupTargetStatus::Ok,
                    error: None,
                });
            }

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

    let registration = if destinations.is_empty() {
        Ok(())
    } else {
        catalog.create(&StoredArtifact {
            artifact_id,
            job_id: job.id.clone(),
            artifact_name: artifact_name.clone(),
            created_at: created_at.to_rfc3339(),
            checksum: checksum.clone(),
            size,
            destinations,
        })
    };
    if required_failed {
        let primary = io::Error::other("one or more required backup targets failed").into();
        return match registration {
            Ok(()) => Err(primary),
            Err(catalog) => Err(BackupError::ArtifactRegistration {
                primary: Box::new(primary),
                catalog: Box::new(catalog),
            }),
        };
    }
    registration?;

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

fn copy_replica(
    source: &Path,
    destination: &Path,
    checksum: &str,
    size: u64,
) -> Result<PathBuf, BackupError> {
    let parent = fs::canonicalize(
        destination
            .parent()
            .ok_or_else(|| io::Error::other("missing backup target parent"))?,
    )?;
    let destination = parent.join(
        destination
            .file_name()
            .ok_or_else(|| io::Error::other("invalid artifact filename"))?,
    );
    let mut input = File::open(source)?;
    let path = parent.join(format!(".kida-copy-{}.tmp", Uuid::new_v4()));
    let mut file = OpenOptions::new()
        .read(true)
        .write(true)
        .create_new(true)
        .open(&path)?;
    let _staging = TemporaryArtifact { path: path.clone() };
    io::copy(&mut input, &mut file)?;
    file.sync_all()?;
    if file.metadata()?.len() != size || sha256_file(&mut file)? != checksum {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "backup replica checksum or size mismatch",
        )
        .into());
    }
    fs::hard_link(path, &destination)?;
    Ok(destination)
}

fn artifact_name(name: &str, created_at: &DateTime<Utc>, id: &str) -> String {
    format!(
        "{name}-{}-{id}.tar.zst",
        created_at.format("%Y-%m-%dT%H-%M-%S")
    )
}

#[cfg(test)]
#[path = "service_tests.rs"]
mod tests;
