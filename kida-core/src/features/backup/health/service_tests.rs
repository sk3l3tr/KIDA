use super::super::restore::DirectoryIdentity;
use super::*;
use serde_json::json;
use std::{
    fs,
    os::unix::fs::{MetadataExt, PermissionsExt},
    path::PathBuf,
};

struct Fixture {
    root: PathBuf,
    service: HealthService,
}
impl Fixture {
    async fn new(limit: usize) -> Self {
        let root = std::env::temp_dir().join(format!("kida-health-service-{}", Uuid::new_v4()));
        let config = BackupHealthConfig {
            data_root: root.join("data"),
            restore_root: root.join("restore"),
            max_active_runs: limit,
            ..Default::default()
        };
        let service = HealthService::new(config).await.unwrap();
        Self { root, service }
    }
    async fn create(&self, definition: &str) -> BackupHealthExecution {
        let resolved = ResolvedHealthDefinition {
            definition: serde_json::from_value(json!({"id":definition,"name":definition,"backup":{"reference":"daily","version":"latest"},"docker":{"compose":"compose.yml"}})).unwrap(),
            definition_path: self.root.join("definition.toml"), compose_path: self.root.join("compose.yml"),
            backup_job: serde_json::from_value(json!({"id":Uuid::new_v4().to_string(),"name":"daily","sources":[],"targets":[],"compression":"tar_zstd"})).unwrap(),
        };
        self.service
            .create_resolved(resolved, BackupHealthMode::Manual)
            .await
            .unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}
fn enqueue(_: &str) -> Result<String, String> {
    Ok("queue-id".into())
}

#[tokio::test]
async fn admissions_exclude_definition_and_enforce_manual_capacity_until_stop() {
    let f = Fixture::new(2).await;
    let a = f.create("a").await;
    let same = f.create("a").await;
    let b = f.create("b").await;
    let c = f.create("c").await;
    let (first, second) = tokio::join!(
        f.service.start(&a.run_id, enqueue),
        f.service.start(&same.run_id, enqueue)
    );
    assert!(first.is_ok() ^ second.is_ok());
    let active = if first.is_ok() { a } else { same.clone() };
    assert!(f.service.start(&b.run_id, enqueue).await.is_ok());
    assert!(
        f.service
            .start(&c.run_id, enqueue)
            .await
            .unwrap_err()
            .contains("limit")
    );
    f.service.stop(&active.run_id).await.unwrap();
    assert!(f.service.start(&active.run_id, enqueue).await.is_err());
    assert!(f.service.start(&c.run_id, enqueue).await.is_ok());
    // Pending work must not resurrect a stopped run or touch Docker.
    f.service.execute(&active.run_id).await.unwrap();
    assert_eq!(
        f.service.get(&active.run_id).await.unwrap().state,
        BackupHealthState::Stopped
    );
}

#[tokio::test]
async fn same_run_starts_once_and_queue_errors_leave_retryable_creation() {
    let f = Fixture::new(2).await;
    let a = f.create("a").await;
    for error in ["queue full", "queue closed"] {
        assert!(
            f.service
                .start(&a.run_id, |_| Err(error.into()))
                .await
                .is_err()
        );
        let run = f.service.get(&a.run_id).await.unwrap();
        assert_eq!(run.state, BackupHealthState::Created);
        assert!(run.started_at.is_none());
        assert!(f.service.registry.lock().unwrap().reservations.is_empty());
    }
    let (a1, a2) = tokio::join!(
        f.service.start(&a.run_id, enqueue),
        f.service.start(&a.run_id, enqueue)
    );
    assert!(a1.is_ok() ^ a2.is_ok());
    let before = f.service.get(&a.run_id).await.unwrap().started_at;
    assert_eq!(f.service.get(&a.run_id).await.unwrap().started_at, before);
    assert!(f.service.get("missing").await.is_err());
}

#[tokio::test]
async fn failed_persistence_releases_admission_and_preserves_other_runs() {
    let f = Fixture::new(1).await;
    let a = f.create("a").await;
    let path = f
        .root
        .join("data/executions")
        .join(format!("{}.json", a.run_id));
    fs::remove_file(&path).unwrap();
    fs::create_dir(&path).unwrap();
    assert!(f.service.start(&a.run_id, enqueue).await.is_err());
    assert!(f.service.registry.lock().unwrap().reservations.is_empty());
    assert_eq!(
        f.service.get(&a.run_id).await.unwrap().state,
        BackupHealthState::Created
    );
    fs::remove_dir(path).unwrap();
    f.service.start(&a.run_id, enqueue).await.unwrap();
}

#[tokio::test]
async fn stop_and_delete_cancel_starting_work_and_repeated_delete_is_safe() {
    let f = Fixture::new(1).await;
    let a = f.create("a").await;
    f.service.start(&a.run_id, enqueue).await.unwrap();
    let run = f.service.find(&a.run_id).unwrap();
    let lock = run.data.lock().await;
    let stop = f.service.stop(&a.run_id);
    tokio::pin!(stop);
    tokio::select! { biased; result = &mut stop => panic!("unexpected {result:?}"), _ = tokio::task::yield_now() => () }
    assert!(run.cancelled.load(Ordering::SeqCst));
    drop(lock);
    stop.await.unwrap();
    f.service.execute(&a.run_id).await.unwrap();
    f.service.delete(&a.run_id).await.unwrap();
    f.service.delete(&a.run_id).await.unwrap();
    assert!(f.service.report_get(&a.run_id).await.is_ok());
    f.service.report_delete(&a.run_id).await.unwrap();
    assert!(f.service.report_get(&a.run_id).await.is_err());
    assert_eq!(f.service.list().await.unwrap().len(), 1);
}

#[test]
fn directory_cleanup_checks_identity_and_never_follows_links() {
    let root = std::env::temp_dir().join(format!("kida-health-cleanup-{}", Uuid::new_v4()));
    let id = Uuid::new_v4().to_string();
    let destination = root.join(&id);
    let foreign = root.join("foreign");
    fs::create_dir_all(destination.join("locked")).unwrap();
    fs::create_dir_all(&foreign).unwrap();
    fs::write(foreign.join("keep"), "keep").unwrap();
    std::os::unix::fs::symlink(&foreign, destination.join("link")).unwrap();
    fs::set_permissions(
        destination.join("locked"),
        fs::Permissions::from_mode(0o000),
    )
    .unwrap();
    let meta = fs::metadata(&destination).unwrap();
    let mut provenance = RestoredDirectory {
        path: destination.clone(),
        identity: Some(DirectoryIdentity {
            device: meta.dev(),
            inode: meta.ino() + 1,
        }),
    };
    assert!(restore::remove_owned(&root, &id, &provenance).is_err());
    assert!(destination.exists());
    provenance.identity.as_mut().unwrap().inode = meta.ino();
    restore::remove_owned(&root, &id, &provenance).unwrap();
    restore::remove_owned(&root, &id, &provenance).unwrap();
    assert!(foreign.join("keep").exists());
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn queries_return_partial_state_while_work_is_locked_and_unknown_data_is_preserved() {
    let f = Fixture::new(1).await;
    let execution = f.create("a").await;
    f.service.start(&execution.run_id, enqueue).await.unwrap();
    let run = f.service.find(&execution.run_id).unwrap();
    let lock = run.data.lock().await;
    let snapshot =
        tokio::time::timeout(Duration::from_millis(100), f.service.get(&execution.run_id))
            .await
            .unwrap()
            .unwrap();
    assert_eq!(snapshot.state, BackupHealthState::Starting);
    assert_eq!(snapshot.started_at, lock.execution.started_at);
    drop(lock);
    fs::create_dir_all(&execution.restore_dir).unwrap();
    fs::write(execution.restore_dir.join("foreign"), "keep").unwrap();
    let closed = f.service.delete(&execution.run_id).await.unwrap();
    assert_eq!(closed.cleanup.state, HealthCleanupState::Error);
    assert!(execution.restore_dir.join("foreign").exists());
    assert!(f.service.repository().get(&execution.run_id).is_ok());
}
