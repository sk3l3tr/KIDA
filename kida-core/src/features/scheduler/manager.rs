use std::sync::{Mutex, MutexGuard};

use chrono::Utc;
use serde_json::Value;

use crate::exec::queue::CommandQueue;

use super::{model::NewSchedule, service::ScheduleService};

pub struct SchedulerManager {
    service: Mutex<ScheduleService>,
    queue: CommandQueue,
}

impl SchedulerManager {
    pub fn new(service: ScheduleService, queue: CommandQueue) -> Self {
        Self {
            service: Mutex::new(service),
            queue,
        }
    }

    pub fn add(&self, input: NewSchedule) -> Result<Value, String> {
        let mut service = self.lock()?;
        service.add(input, Utc::now())
    }

    pub fn list(&self) -> Result<Value, String> {
        Ok(self.lock()?.list())
    }

    pub fn delete(&self, id: &str) -> Result<Value, String> {
        self.lock()?.delete(id)
    }

    pub fn enqueue_due(&self) -> Result<(), String> {
        let mut service = self.lock()?;
        service.enqueue_due(Utc::now(), &self.queue)
    }

    fn lock(&self) -> Result<MutexGuard<'_, ScheduleService>, String> {
        self.service
            .lock()
            .map_err(|_| "Scheduler state lock is poisoned".to_string())
    }
}
