use std::{
    fs::{self, DirBuilder, File, OpenOptions, Permissions},
    io::{self, Read, Seek},
    os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt},
    path::{Component, Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use super::model::ResolvedBackupArtifact;
use crate::features::backup::{artifacts::sha256_file, error::BackupError};

/// Persist this evidence before later cleanup; a path alone does not prove ownership.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RestoredDirectory {
    pub path: PathBuf,
    /// Missing only if inspection failed immediately after creating the directory.
    pub identity: Option<DirectoryIdentity>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirectoryIdentity {
    pub device: u64,
    pub inode: u64,
}

#[derive(Debug, Error)]
#[error("backup health restore failed: {source}")]
pub struct RestoreError {
    #[source]
    pub source: Box<BackupError>,
    /// Never identifies a pre-existing destination. Preserve on uncertain ownership.
    pub partial: Option<RestoredDirectory>,
}

/// Blocking I/O. The caller supplies an existing, trusted restore root and a new
/// run directory. Errors retain partial data for coordinated recovery, never delete it.
pub fn restore(
    artifact: &ResolvedBackupArtifact,
    destination: &Path,
) -> Result<RestoredDirectory, RestoreError> {
    let mut partial = None;
    let result = (|| -> Result<(), BackupError> {
        let input = open_verified(artifact)?;

        if !destination.is_absolute()
            || destination
                .components()
                .any(|part| matches!(part, Component::ParentDir))
        {
            return Err(invalid("destination must be absolute and contain no '..'").into());
        }
        let name = destination
            .file_name()
            .ok_or_else(|| invalid("destination must name a new run directory"))?;
        let parent = destination
            .parent()
            .ok_or_else(|| invalid("destination must have a restore root"))?;
        let path = fs::canonicalize(parent)?.join(name);
        // Atomic reservation, including rejection of existing/dangling symlinks.
        // Keep others out while entries and permissions are being validated.
        DirBuilder::new().mode(0o700).create(&path)?;
        partial = Some(RestoredDirectory {
            path: path.clone(),
            identity: None,
        });
        let metadata = fs::symlink_metadata(&path)?;
        partial.as_mut().unwrap().identity = Some(DirectoryIdentity {
            device: metadata.dev(),
            inode: metadata.ino(),
        });
        extract(input, &path)?;
        fs::set_permissions(&path, Permissions::from_mode(0o755))?;
        Ok(())
    })();
    match result {
        Ok(()) => Ok(partial.unwrap()),
        Err(source) => Err(RestoreError {
            source: Box::new(source),
            partial,
        }),
    }
}

fn open_verified(artifact: &ResolvedBackupArtifact) -> Result<File, BackupError> {
    let mut input = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(&artifact.path)?;
    let metadata = input.metadata()?;
    if !metadata.is_file() || metadata.len() != artifact.size {
        return Err(invalid("artifact size or file type mismatch").into());
    }
    if sha256_file(&mut input)? != artifact.checksum {
        return Err(invalid("artifact checksum mismatch").into());
    }
    input.rewind()?;
    Ok(input)
}

fn extract(input: File, destination: &Path) -> Result<(), BackupError> {
    let mut archive = tar::Archive::new(zstd::Decoder::new(input)?);
    let mut directories = Vec::new();
    for entry in archive.entries()? {
        let mut entry = entry?;
        let relative = entry.path()?.into_owned();
        if relative.is_absolute()
            || relative
                .components()
                .any(|part| !matches!(part, Component::Normal(_) | Component::CurDir))
        {
            return Err(invalid("archive entry has an unsafe path").into());
        }
        let kind = entry.header().entry_type();
        // The current backup producer dereferences links. Supporting links here
        // would add unnecessary aliasing and extraction-order hazards.
        if !kind.is_file() && !kind.is_dir() {
            return Err(invalid("archive entry is not a regular file or directory").into());
        }
        let path = destination.join(relative);
        let mode = entry.header().mode()? & 0o777; // Never restore setuid/setgid/sticky.
        if kind.is_dir() {
            fs::create_dir_all(&path)?;
            directories.push((path, mode));
        } else {
            fs::create_dir_all(
                path.parent()
                    .ok_or_else(|| invalid("missing entry parent"))?,
            )?;
            let mut output = OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(&path)?;
            io::copy(&mut entry, &mut output)?;
            output.set_permissions(Permissions::from_mode(mode))?;
        }
    }
    // tar stops at its terminator, before zstd necessarily checks frame integrity.
    // Consume padding through EOF so truncated frames cannot report success.
    let mut decoder = archive.into_inner();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = decoder.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        if buffer[..read].iter().any(|byte| *byte != 0) {
            return Err(invalid("non-padding data after archive terminator").into());
        }
    }
    // Apply restrictive directory modes only after writing their children.
    directories.sort_by_key(|(path, _)| std::cmp::Reverse(path.components().count()));
    for (path, mode) in directories {
        fs::set_permissions(path, Permissions::from_mode(mode))?;
    }
    Ok(())
}

fn invalid(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

#[cfg(test)]
#[path = "restore_tests.rs"]
mod tests;
