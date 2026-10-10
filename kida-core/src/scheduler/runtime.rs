use std::{path::PathBuf, sync::OnceLock};

use chrono::Utc;

use crate::exec::queue::CommandQueue;

use super::{manager::SchedulerManager, service::ScheduleService};

static MANAGER: OnceLock<SchedulerManager> = OnceLock::new();

pub fn init(path: impl Into<PathBuf>, queue: CommandQueue) -> Result<(), String> {
    if MANAGER.get().is_some() {
        return Err("Scheduler already initialized".to_string());
    }

    let service = ScheduleService::load(path, Utc::now())?;

    MANAGER
        .set(SchedulerManager::new(service, queue))
        .map_err(|_| "Scheduler already initialized".to_string())
}

pub fn manager() -> Result<&'static SchedulerManager, String> {
    MANAGER
        .get()
        .ok_or_else(|| "Scheduler not initialized".to_string())
}
