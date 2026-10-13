use std::{io, time::Duration};

use super::runtime;

pub async fn run() -> io::Result<()> {
    let manager = runtime::manager().map_err(io::Error::other)?;

    loop {
        manager.enqueue_due().map_err(io::Error::other)?;

        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}
