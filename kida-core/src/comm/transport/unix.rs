use tokio::net::UnixListener;

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

        println!("Listening on {}", self.path);

        loop {
            match listener.accept().await {
                Ok((stream, addr)) => {
                    println!("New client connected from {:?}", addr);

                    tokio::spawn(async move {
                        // handle stream
                        drop(stream);
                    });
                }

                Err(e) => {
                    eprintln!("Failed to accept connection: {}", e);
                }
            }
        }
    }
}
