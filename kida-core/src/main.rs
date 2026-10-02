mod comm;

use comm::transport::{http::HttpServer, unix::UnixSocketServer};

const UNIX_SOCKET_PATH: &str = "/tmp/kida.sock";

const HTTP_HOST: &str = "127.0.0.1";
const HTTP_PORT: u16 = 8080;

#[tokio::main]
async fn main() -> std::io::Result<()> {
    print_banner();

    let unix_server = UnixSocketServer::new(UNIX_SOCKET_PATH);
    let http_server = HttpServer::new(HTTP_HOST, HTTP_PORT);

    tokio::try_join!(unix_server.start(), http_server.start(),)?;

    Ok(())
}

fn print_banner() {
    const KIDA_BANNER: &str = "
>< >< >< >< >< >< >< >< >< >< >< >< >< >< >< >< >< >< >< ><
>< >< >< >< >< >< >< >< >< >< >< >< >< >< >< >< >< >< >< ><

    888    d8P  8888888 8888888b.        d8888  v0.0.1
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
