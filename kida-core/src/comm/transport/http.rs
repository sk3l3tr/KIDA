use axum::{Router, extract::Json, routing::post};

use tokio::net::TcpListener;

use crate::{
    comm::protocol::{CommandRequest, CommandResponse},
    exec::executor,
};

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
        let app = Router::new().route("/command", post(command));

        let address = format!("{}:{}", self.host, self.port);

        let listener = TcpListener::bind(address).await?;

        axum::serve(listener, app)
            .await
            .map_err(std::io::Error::other)
    }
}

async fn command(Json(request): Json<CommandRequest>) -> Json<CommandResponse> {
    Json(executor::execute(request).await)
}
