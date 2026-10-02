use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::{UnixListener, UnixStream},
};

use crate::{comm::protocol::CommandRequest, executor};

pub struct UnixSocketServer {
    path: String,
}

impl UnixSocketServer {
    pub fn new(path: impl Into<String>) -> Self {
        Self { path: path.into() }
    }

    pub async fn start(&self) -> std::io::Result<()> {
        let _ = std::fs::remove_file(&self.path);

        let listener = UnixListener::bind(&self.path)?;

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
