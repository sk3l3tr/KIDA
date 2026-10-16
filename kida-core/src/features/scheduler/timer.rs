use std::{io, time::Duration};

use super::{manager::SchedulerManager, runtime};

pub async fn run() -> io::Result<()> {
    let manager = runtime::manager().map_err(io::Error::other)?;

    loop {
        if let Err(error) = tick(manager).await {
            eprintln!("ERROR: Scheduler timer failed: {error}");
            return Err(io::Error::other(error));
        }

        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

pub(super) async fn tick(manager: &SchedulerManager) -> Result<(), String> {
    let manager = manager.clone();
    tokio::task::spawn_blocking(move || manager.enqueue_due())
        .await
        .map_err(|error| format!("Scheduler timer task failed: {error}"))?
}
