use super::*;
use crate::{
    exec::commands::scheduler::{scheduler_add, scheduler_delete, scheduler_list},
    features::scheduler::{model::ScheduleRule, timer},
    infrastructure::comm::protocol::{CommandRequest, CommandStatus},
};
use serde_json::json;
use std::time::Duration;

fn manager() -> (SchedulerManager, std::path::PathBuf) {
    crate::conf::tests::init_test_config();
    let path = std::env::temp_dir().join(format!(
        "kida-blocking-scheduler-{}.toml",
        uuid::Uuid::new_v4()
    ));
    let service = ScheduleService::load(&path, Utc::now()).unwrap();
    let (queue, _receiver) = CommandQueue::new();
    (SchedulerManager::new(service, queue), path)
}

fn input() -> NewSchedule {
    NewSchedule {
        command: "scheduler.list".into(),
        params: serde_json::Value::Null,
        schedule: ScheduleRule::Interval { seconds: 60 },
    }
}

#[test]
fn clones_share_scheduler_state() {
    let (manager, path) = manager();
    let cloned = manager.clone();
    let added = cloned.add(input()).unwrap();
    assert_eq!(manager.list().unwrap(), cloned.list().unwrap());
    manager.delete(added["id"].as_str().unwrap()).unwrap();
    assert_eq!(cloned.list().unwrap(), json!([]));
    std::fs::remove_file(path).unwrap();
}

#[tokio::test(flavor = "current_thread")]
async fn handlers_and_timer_yield_while_waiting_for_scheduler_lock() {
    for operation in ["add", "list", "delete", "timer"] {
        let (manager, path) = manager();
        let seed = manager.add(input()).unwrap();
        let locked_manager = manager.clone();
        let (locked, acquired) = tokio::sync::oneshot::channel();
        let (release, gate) = std::sync::mpsc::channel();
        let holder = std::thread::spawn(move || {
            let guard = locked_manager.service.lock().unwrap();
            locked.send(()).unwrap();
            // The external deadline releases the lock even if the runtime blocks.
            let progress = gate.recv_timeout(Duration::from_secs(5));
            drop(guard);
            assert!(
                progress.is_ok(),
                "runtime blocked while acquiring the scheduler lock"
            );
        });
        acquired.await.unwrap();
        let (started, running) = tokio::sync::oneshot::channel();
        let task = tokio::spawn(async move {
            started.send(()).unwrap();
            let request = CommandRequest {
                id: "scheduler-blocking".into(),
                command: format!("scheduler.{operation}"),
                params: match operation {
                    "add" => serde_json::to_value(input()).unwrap(),
                    "delete" => json!({"id":seed["id"]}),
                    _ => json!({}),
                },
            };
            let response = match operation {
                "add" => scheduler_add::exec(request, &manager).await,
                "list" => scheduler_list::exec(request, &manager).await,
                "delete" => scheduler_delete::exec(request, &manager).await,
                "timer" => {
                    timer::tick(&manager).await.unwrap();
                    return;
                }
                _ => unreachable!(),
            };
            assert_eq!(response.id, "scheduler-blocking");
            assert!(
                matches!(response.status, CommandStatus::Ok),
                "{:?}",
                response.error
            );
        });
        running.await.unwrap();
        assert!(
            !task.is_finished(),
            "{operation} blocked the runtime until the lock was released"
        );
        release.send(()).unwrap();
        tokio::time::timeout(Duration::from_secs(5), task)
            .await
            .unwrap()
            .unwrap();
        holder.join().unwrap();
        std::fs::remove_file(path).unwrap();
    }
}

#[tokio::test]
async fn poisoned_lock_errors_reach_handler_and_timer() {
    let (manager, path) = manager();
    let cloned = manager.clone();
    assert!(
        std::thread::spawn(move || {
            let _guard = cloned.service.lock().unwrap();
            panic!("inject poisoned scheduler lock");
        })
        .join()
        .is_err()
    );
    let response = scheduler_list::exec(
        CommandRequest {
            id: "poisoned".into(),
            command: "scheduler.list".into(),
            params: json!({}),
        },
        &manager,
    )
    .await;
    assert_eq!(response.id, "poisoned");
    assert!(matches!(response.status, CommandStatus::Error));
    assert_eq!(
        response.error.as_deref(),
        Some("Scheduler state lock is poisoned")
    );
    assert_eq!(
        timer::tick(&manager).await.unwrap_err(),
        "Scheduler state lock is poisoned"
    );
    assert!(!path.exists());
}
