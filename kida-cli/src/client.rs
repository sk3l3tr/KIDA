use std::{
    io::{BufRead, BufReader, Write},
    os::unix::net::UnixStream,
    path::{Path, PathBuf},
    time::Duration,
};

use crate::protocol::{CommandRequest, CommandResponse};

pub const DEFAULT_SOCKET_PATH: &str = "/tmp/kida.sock";

#[derive(Debug)]
pub enum ClientError {
    AgentUnavailable,
    PermissionDenied,
    Connection(std::io::Error),
    Serialization(serde_json::Error),
    InvalidResponse(serde_json::Error),
    EmptyResponse,
}

pub struct KidaClient {
    socket_path: PathBuf,
}

impl KidaClient {
    pub fn new(socket_path: impl Into<PathBuf>) -> Self {
        Self {
            socket_path: socket_path.into(),
        }
    }

    pub fn default() -> Self {
        Self::new(DEFAULT_SOCKET_PATH)
    }

    pub fn send(&self, request: &CommandRequest) -> Result<CommandResponse, ClientError> {
        let mut stream = self.connect()?;

        stream
            .set_read_timeout(Some(Duration::from_secs(10)))
            .map_err(ClientError::Connection)?;

        stream
            .set_write_timeout(Some(Duration::from_secs(10)))
            .map_err(ClientError::Connection)?;

        let mut payload = serde_json::to_vec(request).map_err(ClientError::Serialization)?;

        // Delimitamos cada mensaje mediante \n.
        payload.push(b'\n');

        stream
            .write_all(&payload)
            .map_err(ClientError::Connection)?;

        stream.flush().map_err(ClientError::Connection)?;

        let mut reader = BufReader::new(stream);
        let mut response = String::new();

        reader
            .read_line(&mut response)
            .map_err(ClientError::Connection)?;

        if response.trim().is_empty() {
            return Err(ClientError::EmptyResponse);
        }

        serde_json::from_str(response.trim()).map_err(ClientError::InvalidResponse)
    }

    fn connect(&self) -> Result<UnixStream, ClientError> {
        UnixStream::connect(&self.socket_path).map_err(|err| match err.kind() {
            std::io::ErrorKind::NotFound | std::io::ErrorKind::ConnectionRefused => {
                ClientError::AgentUnavailable
            }

            std::io::ErrorKind::PermissionDenied => ClientError::PermissionDenied,

            _ => ClientError::Connection(err),
        })
    }

    pub fn socket_path(&self) -> &Path {
        &self.socket_path
    }
}
