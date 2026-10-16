use std::{
    fs::{File, OpenOptions, TryLockError},
    io::{Error, ErrorKind},
    os::unix::fs::{FileTypeExt, MetadataExt, OpenOptionsExt},
    path::Path,
    time::Duration,
};

use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::{UnixListener, UnixStream},
};

use crate::{exec::executor, infrastructure::comm::protocol::CommandRequest};

pub struct UnixSocketServer {
    path: String,
}

impl UnixSocketServer {
    pub fn new(path: impl Into<String>) -> Self {
        Self { path: path.into() }
    }

    pub async fn start(&self) -> std::io::Result<()> {
        let (listener, _reservation) = bind(Path::new(&self.path)).await?;

        loop {
            let (stream, _) = listener.accept().await?;

            tokio::spawn(async move {
                if let Err(error) = handle_connection(stream).await {
                    eprintln!("Unix connection error: {error}");
                }
            });
        }
    }
}

// Keep this file (and its lock) alive for the entire listener lifetime. Never unlink
// the lock file: another starter may already have opened the same inode.
async fn bind(path: &Path) -> std::io::Result<(UnixListener, File)> {
    let mut lock_path = path.as_os_str().to_owned();
    lock_path.push(".lock");
    let reservation = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(lock_path)?;
    if !reservation.metadata()?.is_file() {
        return Err(Error::new(
            ErrorKind::InvalidInput,
            "Socket lock must be a regular file",
        ));
    }
    reservation.try_lock().map_err(|error| match error {
        TryLockError::WouldBlock => Error::new(
            ErrorKind::AddrInUse,
            "Unix socket instance is already running",
        ),
        TryLockError::Error(error) => error,
    })?;

    match std::fs::symlink_metadata(path) {
        Ok(metadata) => {
            if !metadata.file_type().is_socket() {
                return Err(Error::new(
                    ErrorKind::AlreadyExists,
                    "Unix socket path is not a socket",
                ));
            }
            match tokio::time::timeout(Duration::from_secs(1), UnixStream::connect(path)).await {
                Ok(Err(error)) if error.kind() == ErrorKind::ConnectionRefused => {}
                Ok(Err(error)) => return Err(error),
                Ok(Ok(_)) => return Err(Error::new(ErrorKind::AddrInUse, "Unix socket is active")),
                Err(_) => {
                    return Err(Error::new(
                        ErrorKind::TimedOut,
                        "Unix socket activity check timed out",
                    ));
                }
            }
            let current = std::fs::symlink_metadata(path)?;
            if current.dev() != metadata.dev() || current.ino() != metadata.ino() {
                return Err(Error::new(
                    ErrorKind::AlreadyExists,
                    "Unix socket path changed during startup",
                ));
            }
            std::fs::remove_file(path)?;
        }
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }

    Ok((UnixListener::bind(path)?, reservation))
}

async fn handle_connection(stream: UnixStream) -> Result<(), Box<dyn std::error::Error>> {
    let (reader, mut writer) = stream.into_split();

    let mut reader = BufReader::new(reader);
    let mut line = String::new();

    while reader.read_line(&mut line).await? > 0 {
        let request: CommandRequest = serde_json::from_str(line.trim())?;

        let response = executor::execute(request).await;

        let response = serde_json::to_string(&response)?;

        writer.write_all(response.as_bytes()).await?;
        writer.write_all(b"\n").await?;

        line.clear();
    }

    Ok(())
}

#[cfg(test)]
#[path = "unix_tests.rs"]
mod tests;
