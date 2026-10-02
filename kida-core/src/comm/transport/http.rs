use axum::{Router, routing::get};
use tokio::net::TcpListener;

pub struct HttpServer {
    host: String,
    port: u16,
}

impl HttpServer {
    pub fn new(host: impl Into<String>, port: u16) -> Self {
        Self {
            host: host.into(),
            port,
        }
    }

    pub async fn start(&self) -> std::io::Result<()> {
        let app = Router::new().route("/health", get(health));

        let address = format!("{}:{}", self.host, self.port);

        let listener = TcpListener::bind(&address).await?;

        println!("HTTP server listening on http://{}", address);

        axum::serve(listener, app)
            .await
            .map_err(std::io::Error::other)
    }
}

async fn health() -> &'static str {
    "ok"
}
