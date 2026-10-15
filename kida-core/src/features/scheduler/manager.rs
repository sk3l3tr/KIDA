use std::sync::{Mutex, MutexGuard};

use chrono::Utc;
use serde_json::Value;

use crate::exec::queue::CommandQueue;

use super::{
    model::{NewSchedule, ScheduleOriginFilter},
    service::ScheduleService,
};

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

    #[cfg_attr(
        not(test),
        allow(
            dead_code,
            reason = "Scheduler interface retained for production integration; covered by tests"
        )
    )]
    pub fn list(&self) -> Result<Value, String> {
        Ok(self.lock()?.list())
    }

    pub fn list_by_origin(&self, origin: ScheduleOriginFilter) -> Result<Value, String> {
        Ok(self.lock()?.list_by_origin(origin))
    }

    #[cfg_attr(
        not(test),
        allow(
            dead_code,
            reason = "Scheduler interface retained for production integration; covered by tests"
        )
    )]
    pub(crate) fn add_internal(&self, input: NewSchedule) -> Result<Value, String> {
        self.lock()?.add_internal(input, Utc::now())
    }

    #[cfg_attr(
        not(test),
        allow(
            dead_code,
            reason = "Scheduler interface retained for production integration; covered by tests"
        )
    )]
    pub(crate) fn replace_internal(&self, id: &str, input: NewSchedule) -> Result<Value, String> {
        self.lock()?.replace_internal(id, input, Utc::now())
    }

    #[cfg_attr(
        not(test),
        allow(
            dead_code,
            reason = "Scheduler interface retained for production integration; covered by tests"
        )
    )]
    pub(crate) fn delete_internal(&self, id: &str) -> Result<Value, String> {
        self.lock()?.delete_internal(id)
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
