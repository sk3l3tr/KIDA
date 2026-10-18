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
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RestoredDirectory {
    pub path: PathBuf,
    /// Missing only if inspection failed immediately after creating the directory.
    pub identity: Option<DirectoryIdentity>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
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

/// Remove only the directory created by this run. Walk via descriptors so a
/// replaced child or symlink cannot redirect cleanup outside the owned tree.
pub fn remove_owned(
    root: &Path,
    run_id: &str,
    provenance: &RestoredDirectory,
) -> Result<(), String> {
    use std::ffi::CString;
    use std::os::fd::{AsRawFd, FromRawFd};
    let root = fs::canonicalize(root).map_err(|e| e.to_string())?;
    let expected = root.join(run_id);
    if provenance.path != expected || uuid::Uuid::parse_str(run_id).is_err() {
        return Err("restore cleanup path does not match run".into());
    }
    let identity = provenance
        .identity
        .as_ref()
        .ok_or("restore creation identity missing")?;
    let parent = File::open(&root).map_err(|e| e.to_string())?;
    let name = CString::new(run_id).map_err(|e| e.to_string())?;
    let fd = unsafe {
        libc::openat(
            parent.as_raw_fd(),
            name.as_ptr(),
            libc::O_PATH | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    if fd < 0 {
        let error = io::Error::last_os_error();
        return if error.kind() == io::ErrorKind::NotFound {
            Ok(())
        } else {
            Err(error.to_string())
        };
    }
    let directory = unsafe { File::from_raw_fd(fd) };
    let metadata = directory.metadata().map_err(|e| e.to_string())?;
    if metadata.dev() != identity.device || metadata.ino() != identity.inode {
        return Err("restore creation identity changed".into());
    }
    remove_children(&directory).map_err(|e| e.to_string())?;
    // Check the directory name still refers to the opened object before unlink.
    let current = fs::symlink_metadata(&expected).map_err(|e| e.to_string())?;
    if current.dev() != identity.device || current.ino() != identity.inode {
        return Err("restore directory changed during cleanup".into());
    }
    if unsafe { libc::unlinkat(parent.as_raw_fd(), name.as_ptr(), libc::AT_REMOVEDIR) } != 0 {
        return Err(io::Error::last_os_error().to_string());
    }
    Ok(())
}

fn remove_children(directory: &File) -> io::Result<()> {
    use std::{
        ffi::CString,
        os::{
            fd::{AsRawFd, FromRawFd},
            unix::ffi::OsStrExt,
        },
    };
    let descriptor = PathBuf::from(format!("/proc/self/fd/{}", directory.as_raw_fd()));
    fs::set_permissions(&descriptor, Permissions::from_mode(0o700))?;
    for entry in fs::read_dir(&descriptor)? {
        let entry = entry?;
        let name = CString::new(entry.file_name().as_bytes())?;
        let fd = unsafe {
            libc::openat(
                directory.as_raw_fd(),
                name.as_ptr(),
                libc::O_PATH | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        let flags = if fd >= 0 {
            let child = unsafe { File::from_raw_fd(fd) };
            remove_children(&child)?;
            libc::AT_REMOVEDIR
        } else {
            let error = io::Error::last_os_error();
            if !matches!(error.raw_os_error(), Some(libc::ENOTDIR | libc::ELOOP)) {
                return Err(error);
            }
            0
        };
        if unsafe { libc::unlinkat(directory.as_raw_fd(), name.as_ptr(), flags) } != 0 {
            return Err(io::Error::last_os_error());
        }
    }
    Ok(())
}
