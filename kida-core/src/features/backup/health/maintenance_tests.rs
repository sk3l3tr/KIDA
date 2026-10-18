use super::*;
use crate::exec::queue::CommandQueue;
use crate::features::scheduler::manager::SchedulerManager;
use uuid::Uuid;

#[test]
fn internal_jobs_are_idempotent_repaired_and_administratively_protected() {
    let root = std::env::temp_dir().join(format!("kida-health-maintenance-{}", Uuid::new_v4()));
    let now = DateTime::parse_from_rfc3339("2026-10-18T12:00:00Z")
        .unwrap()
        .with_timezone(&Utc);
    let path = root.join("scheduler.toml");
    let mut scheduler = ScheduleService::load(&path, now).unwrap();
    register_jobs(&mut scheduler, now).unwrap();
    let first = scheduler.list_by_origin(ScheduleOriginFilter::Internal);
    assert_eq!(first.as_array().unwrap().len(), 2);
    register_jobs(&mut scheduler, now).unwrap();
    assert_eq!(
        first,
        scheduler.list_by_origin(ScheduleOriginFilter::Internal)
    );
    scheduler
        .add_internal(
            NewSchedule {
                command: EXPIRE.into(),
                params: json!({"wrong": true}),
                schedule: ScheduleRule::Interval { seconds: 2 },
            },
            now,
        )
        .unwrap();
    register_jobs(&mut scheduler, now).unwrap();
    assert_eq!(
        first,
        scheduler.list_by_origin(ScheduleOriginFilter::Internal)
    );
    drop(scheduler);
    let mut scheduler = ScheduleService::load(&path, now).unwrap();
    register_jobs(&mut scheduler, now).unwrap();
    assert_eq!(
        first,
        scheduler.list_by_origin(ScheduleOriginFilter::Internal)
    );
    for job in first.as_array().unwrap() {
        assert!(scheduler.delete(job["id"].as_str().unwrap()).is_err());
        assert_eq!(job["params"], json!({}));
    }
    crate::conf::tests::init_test_config();
    let (queue, _receiver) = CommandQueue::new();
    let manager = SchedulerManager::new(scheduler, queue);
    for job in first.as_array().unwrap() {
        assert!(manager.delete(job["id"].as_str().unwrap()).is_err());
    }
    std::fs::remove_dir_all(root).unwrap();
}

fn execution() -> BackupHealthExecution {
    serde_json::from_value(json!({
        "run_id": Uuid::new_v4().to_string(),
        "definition": {"id": "test", "name": "test", "backup": {"reference": "daily", "version": "latest"}, "docker": {"compose": "compose.yml"}},
        "definition_path": "/tmp/definition.toml", "mode": "MANUAL", "state": "RUNNING",
        "diagnosis": {"result": "UNKNOWN", "summary": "pending", "complete": false, "services": [], "anomalies": [], "evidence": []},
        "created_at": "2026-10-17T12:00:00Z", "started_at": "2026-10-18T12:00:00Z", "finished_at": null,
        "artifact": null, "compose_path": "/tmp/compose.yml", "compose_checksum": null,
        "restore_dir": "/tmp/restore", "project": null, "services": [], "resources": [],
        "cleanup": {"state": "PENDING", "errors": []}, "report_path": null
    })).unwrap()
}

#[test]
fn ttl_starts_at_admission_and_queries_do_not_renew_it() {
    let mut run = execution();
    let started = DateTime::parse_from_rfc3339(run.started_at.as_ref().unwrap())
        .unwrap()
        .with_timezone(&Utc);
    assert!(!expired(&run, started + TimeDelta::seconds(3599), 1));
    assert!(expired(&run, started + TimeDelta::seconds(3600), 1));
    let read: BackupHealthExecution =
        serde_json::from_str(&serde_json::to_string(&run).unwrap()).unwrap();
    assert_eq!(read.started_at, run.started_at);
    assert!(expired(&read, started + TimeDelta::seconds(3601), 1));
    run.state = BackupHealthState::Created;
    assert!(!expired(&run, started + TimeDelta::days(1), 1));
    run.state = BackupHealthState::Running;
    run.mode = BackupHealthMode::Automatic;
    assert!(!expired(&run, started + TimeDelta::days(1), 1));
}

#[tokio::test]
async fn restart_closes_previous_manual_without_resuming_and_second_start_is_idempotent() {
    let root = std::env::temp_dir().join(format!("kida-health-restart-{}", Uuid::new_v4()));
    let config = crate::infrastructure::conf::BackupHealthConfig {
        data_root: root.join("data"),
        restore_root: root.join("restore"),
        ..Default::default()
    };
    let repository = super::super::history::ExecutionRepository::new(&config.data_root);
    let run = execution();
    let now = DateTime::parse_from_rfc3339("2026-10-18T12:01:00Z")
        .unwrap()
        .with_timezone(&Utc);
    repository.save(&run, None).unwrap();
    let service = HealthService::new(config.clone()).await.unwrap();
    let first = startup(&service, now).await.unwrap();
    assert_eq!(
        first.processed.as_slice(),
        std::slice::from_ref(&run.run_id)
    );
    assert!(first.errors.is_empty());
    let closed = service.get(&run.run_id).await.unwrap();
    assert_eq!(closed.state, BackupHealthState::Error);
    assert_eq!(closed.cleanup.state, HealthCleanupState::Completed);
    assert_eq!(closed.finished_at, Some(now.to_rfc3339()));
    drop(service);
    let service = HealthService::new(config).await.unwrap();
    assert!(startup(&service, now).await.unwrap().processed.is_empty());
    assert_eq!(
        service.get(&run.run_id).await.unwrap().finished_at,
        closed.finished_at
    );
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn expiration_and_retention_use_exact_boundaries() {
    let root = std::env::temp_dir().join(format!("kida-health-expiration-{}", Uuid::new_v4()));
    let config = crate::infrastructure::conf::BackupHealthConfig {
        data_root: root.join("data"),
        restore_root: root.join("restore"),
        manual_ttl_hours: 1,
        report_retention_days: 1,
        ..Default::default()
    };
    let repository = super::super::history::ExecutionRepository::new(&config.data_root);
    let run = execution();
    repository.save(&run, None).unwrap();
    let service = HealthService::new(config).await.unwrap();
    let started = DateTime::parse_from_rfc3339(run.started_at.as_ref().unwrap())
        .unwrap()
        .with_timezone(&Utc);
    assert!(
        expire(&service, started + TimeDelta::seconds(3599))
            .await
            .unwrap()
            .processed
            .is_empty()
    );
    assert_eq!(
        expire(&service, started + TimeDelta::seconds(3600))
            .await
            .unwrap()
            .processed
            .as_slice(),
        std::slice::from_ref(&run.run_id)
    );
    let closed = service.get(&run.run_id).await.unwrap();
    assert_eq!(closed.cleanup.state, HealthCleanupState::Completed);
    let finished = DateTime::parse_from_rfc3339(closed.finished_at.as_ref().unwrap())
        .unwrap()
        .with_timezone(&Utc);
    service.repository().report_delete(&run.run_id).unwrap();
    assert!(
        retain(&service, finished + TimeDelta::seconds(86399))
            .await
            .unwrap()
            .processed
            .is_empty()
    );
    assert_eq!(
        retain(&service, finished + TimeDelta::days(1))
            .await
            .unwrap()
            .processed,
        [run.run_id]
    );
    assert!(service.list().await.unwrap().is_empty());
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn stopped_manual_keeps_its_restore_until_ttl() {
    let root = std::env::temp_dir().join(format!("kida-health-stop-ttl-{}", Uuid::new_v4()));
    let config = crate::infrastructure::conf::BackupHealthConfig {
        data_root: root.join("data"),
        restore_root: root.join("restore"),
        manual_ttl_hours: 1,
        ..Default::default()
    };
    let repository = super::super::history::ExecutionRepository::new(&config.data_root);
    let mut run = execution();
    run.restore_dir = config.restore_root.join(&run.run_id);
    std::fs::create_dir_all(&run.restore_dir).unwrap();
    std::fs::write(run.restore_dir.join("preserved.txt"), "data").unwrap();
    use std::os::unix::fs::MetadataExt;
    let metadata = std::fs::metadata(&run.restore_dir).unwrap();
    let provenance = super::super::restore::RestoredDirectory {
        path: run.restore_dir.clone(),
        identity: Some(super::super::restore::DirectoryIdentity {
            device: metadata.dev(),
            inode: metadata.ino(),
        }),
    };
    repository.save(&run, Some(&provenance)).unwrap();
    let service = HealthService::new(config).await.unwrap();
    service.stop(&run.run_id).await.unwrap();
    let started = DateTime::parse_from_rfc3339(run.started_at.as_ref().unwrap())
        .unwrap()
        .with_timezone(&Utc);
    assert!(
        expire(&service, started + TimeDelta::seconds(3599))
            .await
            .unwrap()
            .processed
            .is_empty()
    );
    assert!(run.restore_dir.join("preserved.txt").exists());
    expire(&service, started + TimeDelta::seconds(3600))
        .await
        .unwrap();
    assert!(!run.restore_dir.exists());
    assert_eq!(
        service.get(&run.run_id).await.unwrap().cleanup.state,
        HealthCleanupState::Completed
    );
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn corrupt_sibling_does_not_prevent_valid_startup_cleanup() {
    let root = std::env::temp_dir().join(format!("kida-health-corrupt-start-{}", Uuid::new_v4()));
    let config = crate::infrastructure::conf::BackupHealthConfig {
        data_root: root.join("data"),
        restore_root: root.join("restore"),
        ..Default::default()
    };
    let repository = super::super::history::ExecutionRepository::new(&config.data_root);
    let run = execution();
    repository.save(&run, None).unwrap();
    let mut created = execution();
    created.state = BackupHealthState::Created;
    created.started_at = None;
    repository.save(&created, None).unwrap();
    std::fs::write(
        config
            .data_root
            .join("executions")
            .join(format!("{}.json", Uuid::new_v4())),
        "corrupt",
    )
    .unwrap();
    let (available, errors) = repository.list_available().unwrap();
    assert_eq!(available.len(), 2);
    assert_eq!(errors.len(), 1);
    let service = HealthService::new(config).await.unwrap();
    assert!(
        service
            .start(&created.run_id, |_| panic!(
                "corrupt history must block admission"
            ))
            .await
            .unwrap_err()
            .contains("unreadable execution history")
    );
    let now = DateTime::parse_from_rfc3339("2026-10-18T12:01:00Z")
        .unwrap()
        .with_timezone(&Utc);
    let result = startup(&service, now).await.unwrap();
    assert_eq!(result.processed.len(), 2);
    assert!(result.processed.contains(&run.run_id));
    assert_eq!(result.errors.len(), 1);
    assert_eq!(
        service.get(&run.run_id).await.unwrap().cleanup.state,
        HealthCleanupState::Completed
    );
    std::fs::remove_dir_all(root).unwrap();
}
