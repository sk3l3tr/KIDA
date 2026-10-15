use std::{io, time::Duration};

use super::runtime;

pub async fn run() -> io::Result<()> {
    let manager = runtime::manager().map_err(io::Error::other)?;

    loop {
        if let Err(error) = manager.enqueue_due() {
            eprintln!("ERROR: Scheduler timer failed: {error}");
            return Err(io::Error::other(error));
        }

        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}
