use std::{
    fs,
    io::{Error, ErrorKind},
    path::Path,
};

use crate::{
    conf,
    features::backup::{error::BackupError, repository::BackupRepository},
    infrastructure::storage::{Storage, TomlStorage},
};

use super::model::{BackupHealthDefinition, ResolvedHealthDefinition};

pub fn load(path: impl AsRef<Path>) -> Result<ResolvedHealthDefinition, BackupError> {
    let config = conf::get().map_err(Error::other)?;
    load_in(
        path.as_ref(),
        &BackupRepository::new(&config.backup.backup_dir),
    )
}

pub(crate) fn load_in(
    path: &Path,
    repository: &BackupRepository,
) -> Result<ResolvedHealthDefinition, BackupError> {
    let definition_path = fs::canonicalize(path)?;
    let definition = TomlStorage::<BackupHealthDefinition>::new(&definition_path).load()?;
    validate(&definition)?;

    let compose = definition_path
        .parent()
        .expect("canonical definition path has a parent")
        .join(&definition.docker.compose);
    let compose_path = fs::canonicalize(compose)?;
    if !fs::metadata(&compose_path)?.is_file() {
        return Err(invalid("docker.compose must name a file").into());
    }
    // Opening verifies readability without invoking Docker or creating anything.
    fs::File::open(&compose_path)?;

    let reference = &definition.backup.reference;
    let mut matches = repository
        .list()?
        .into_iter()
        .filter(|job| job.id == *reference || job.name == *reference);
    let backup_job = matches.next().ok_or_else(|| {
        Error::new(
            ErrorKind::NotFound,
            format!("Backup job not found: {reference}"),
        )
    })?;
    if matches.next().is_some() {
        return Err(invalid(&format!("ambiguous backup reference: {reference}")).into());
    }

    Ok(ResolvedHealthDefinition {
        definition,
        definition_path,
        compose_path,
        backup_job,
    })
}

fn validate(definition: &BackupHealthDefinition) -> Result<(), Error> {
    for (field, value) in [
        ("id", definition.id.as_str()),
        ("name", definition.name.as_str()),
        ("backup.reference", definition.backup.reference.as_str()),
        ("backup.version", definition.backup.version.as_str()),
    ] {
        if value.trim().is_empty() {
            return Err(invalid(&format!("{field} must not be empty")));
        }
    }
    if definition.backup.version != "latest"
        && uuid::Uuid::parse_str(&definition.backup.version).is_err()
    {
        return Err(invalid("backup.version must be latest or an artifact UUID"));
    }
    if definition
        .docker
        .compose
        .to_string_lossy()
        .trim()
        .is_empty()
    {
        return Err(invalid("docker.compose must not be empty"));
    }
    Ok(())
}

fn invalid(message: &str) -> Error {
    Error::new(ErrorKind::InvalidInput, format!("backup health: {message}"))
}
