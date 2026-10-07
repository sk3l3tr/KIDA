mod backup;
mod comm;
mod conf;
mod docker;
mod exec;
mod system;

use comm::transport::{http::HttpServer, unix::UnixSocketServer};
use conf::{ConfigManager, DEFAULT_CONFIG_PATH};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    print_banner();

    let config_manager = ConfigManager::load_or_create(DEFAULT_CONFIG_PATH)?;
    let config = config_manager.get();

    let unix_server = UnixSocketServer::new(&config.unix.socket_path);
    let http_server = HttpServer::new(&config.http.host, config.http.port);

    tokio::try_join!(unix_server.start(), http_server.start(),)?;

    Ok(())
}

fn print_banner() {
    const KIDA_BANNER: &str = "
>< >< >< >< >< >< >< >< >< >< >< >< >< >< >< >< >< >< >< ><
>< >< >< >< >< >< >< >< >< >< >< >< >< >< >< >< >< >< >< ><

    888    d8P  8888888 8888888b.        d8888  v0.0.3
    888   d8P     888   888  \"Y88b      d88888  AGENT
    888  d8P      888   888    888     d88P888
    888d88K       888   888    888    d88P 888
    8888888b      888   888    888   d88P  888
    888  Y88b     888   888    888  d88P   888
    888   Y88b    888   888  .d88P d8888888888
    888    Y88b 8888888 8888888P\" d88P     888

>< >< >< >< >< >< >< >< >< >< >< >< >< >< >< >< >< >< >< ><
>< >< >< >< >< >< >< >< >< >< >< >< >< >< >< >< >< >< >< ><
    ";

    println!("{}", KIDA_BANNER);
}
