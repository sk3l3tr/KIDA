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

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Barrier};

    use serde_json::json;
    use uuid::Uuid;

    use super::*;
    use crate::scheduler::{model::ScheduleRule, time::parse_once};

    #[test]
    fn concurrent_delete_and_due_allow_only_pre_delete_enqueue() {
        let path =
            std::env::temp_dir().join(format!("kida-scheduler-manager-{}.toml", Uuid::new_v4()));
        let anchor = parse_once("2000-01-01T00:00:00Z").unwrap();
        let mut service = ScheduleService::load(&path, anchor).unwrap();

        let definition = service
            .add(
                NewSchedule {
                    command: "health".to_string(),
                    params: json!({"marker": null}),
                    schedule: ScheduleRule::Interval { seconds: 60 },
                },
                anchor,
            )
            .unwrap();

        let id = definition["id"].as_str().unwrap().to_string();
        crate::conf::tests::init_test_config();
        let (queue, mut receiver) = CommandQueue::new();
        let manager = Arc::new(SchedulerManager::new(service, queue));
        let barrier = Arc::new(Barrier::new(3));

        let due_thread = {
            let manager = Arc::clone(&manager);
            let barrier = Arc::clone(&barrier);

            std::thread::spawn(move || {
                barrier.wait();
                manager.enqueue_due().unwrap();
            })
        };

        let delete_thread = {
            let manager = Arc::clone(&manager);
            let barrier = Arc::clone(&barrier);

            std::thread::spawn(move || {
                barrier.wait();
                manager.delete(&id).unwrap()
            })
        };

        barrier.wait();
        due_thread.join().unwrap();
        assert_eq!(delete_thread.join().unwrap(), definition);
        assert_eq!(manager.list().unwrap(), json!([]));

        if let Ok(queued) = receiver.try_recv() {
            assert_eq!(queued.request.command, "health");
            assert_eq!(queued.request.params, json!({"marker": null}));
        }
        assert!(receiver.try_recv().is_err());

        manager.enqueue_due().unwrap();
        manager.enqueue_due().unwrap();
        assert!(receiver.try_recv().is_err());

        let reloaded = ScheduleService::load(&path, Utc::now()).unwrap();
        assert_eq!(reloaded.list(), json!([]));

        std::fs::remove_file(&path).unwrap();
    }
}
