use super::super::{model::*, restore::DirectoryIdentity};
use super::*;
use serde_json::json;

struct Fixture {
    root: PathBuf,
    repo: ExecutionRepository,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("kida-health-history-{}", Uuid::new_v4()));
        Self {
            repo: ExecutionRepository::with_evidence_policy(
                &root,
                vec!["secret-token".into()],
                true,
            ),
            root,
        }
    }
    fn execution(&self) -> BackupHealthExecution {
        serde_json::from_value(json!({
            "run_id": Uuid::new_v4().to_string(),
            "definition": {"id": "app-health", "name": "App Health", "backup": {"reference": "daily", "version": "latest"}, "docker": {"compose": "compose.yml"}},
            "definition_path": self.root.join("definition.toml"), "mode": "MANUAL", "state": "RUNNING",
            "diagnosis": {"result": "HEALTHY", "summary": "checked secret-token", "complete": true,
                "services": [{"service": "app", "result": "HEALTHY", "reasons": ["checked secret-token"]}],
                "anomalies": ["recovered secret-token"], "evidence": [{"observed_at": "2026-10-16T12:00:15Z", "service": "app", "container_id": "container-id", "description": "evidence secret-token", "logs": "message secret-token\n```\n<script>data</script>"}]},
            "created_at": "2026-10-16T12:00:00Z", "started_at": "2026-10-16T12:00:01Z", "finished_at": null,
            "artifact": {"artifact_id": Uuid::new_v4().to_string(), "job_id": Uuid::new_v4().to_string(), "artifact_name": "copy.tar.zst", "created_at": "2026-10-16T11:00:00Z", "path": self.root.join("copy.tar.zst"), "checksum": "a".repeat(64), "size": 100},
            "compose_path": self.root.join("compose.yml"), "compose_checksum": "b".repeat(64),
            "restore_dir": self.root.join("restored"), "project": {"owner": Uuid::new_v4().to_string(), "project": "kida-bh-test"},
            "services": [{"name": "app", "image": "example/app:1", "replicas": 1}], "resources": [{"kind": "container", "identity": "container-id"}],
            "cleanup": {"state": "PENDING", "errors": []}, "report_path": null
        })).unwrap()
    }
    fn closed(&self) -> BackupHealthExecution {
        let mut run = self.execution();
        run.state = BackupHealthState::Stopped;
        run.finished_at = Some("2026-10-16T12:00:21Z".into());
        run.cleanup.state = HealthCleanupState::Completed;
        run
    }
    fn provenance(&self) -> RestoredDirectory {
        RestoredDirectory {
            path: self.root.join("restored"),
            identity: Some(DirectoryIdentity {
                device: 1,
                inode: 2,
            }),
        }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        if self.root.exists() {
            fs::remove_dir_all(&self.root).unwrap();
        }
    }
}

#[test]
fn roundtrip_lists_and_queries_preserve_creation_provenance_without_creating_on_read() {
    let fixture = Fixture::new();
    assert!(fixture.repo.list().unwrap().is_empty());
    assert!(fixture.repo.report_list().unwrap().is_empty());
    assert!(fixture.repo.reconcile().unwrap().errors.is_empty());
    assert!(!fixture.root.exists());
    let run = fixture.execution();
    fixture
        .repo
        .save(&run, Some(&fixture.provenance()))
        .unwrap();
    fixture.repo.save(&run, None).unwrap();
    let record = fixture.repo.get(&run.run_id).unwrap();
    assert_eq!(record.report_status, ReportStatus::Pending);
    assert_eq!(
        record.restore_provenance.unwrap().identity.unwrap().inode,
        2
    );
    assert_eq!(fixture.repo.list().unwrap().len(), 1);
    assert!(!fixture.root.join("reports").exists());
    assert!(fixture.repo.report_get(&run.run_id).is_err());
    assert!(fixture.repo.report_delete(&run.run_id).is_err());
}

#[test]
fn final_report_contains_backup_diagnosis_resources_duration_and_cleanup() {
    let fixture = Fixture::new();
    let run = fixture.closed();
    fixture
        .repo
        .finish(&run, Some(&fixture.provenance()))
        .unwrap();
    let report = fixture.repo.report_get(&run.run_id).unwrap();
    for text in [
        "HEALTHY",
        "copy.tar.zst",
        &"a".repeat(64),
        &"b".repeat(64),
        "example/app:1",
        "replicas=1",
        "container-id",
        "Completed",
        "20",
        "administrator must validate",
        "````text",
        "<script>data</script>\n````",
    ] {
        assert!(report.contains(text), "{text}");
    }
    assert_eq!(
        fixture.repo.report_list().unwrap(),
        vec![run.run_id.clone()]
    );
    let json = fs::read_to_string(fixture.repo.execution_path(&run.run_id).unwrap()).unwrap();
    assert!(!json.contains("secret-token"));
    assert!(!report.contains("secret-token"));
    assert!(report.contains("[REDACTED]"));
    assert!(fixture.repo.save(&run, None).is_err());
    assert!(!fixture.root.join("restored").exists()); // No resource operations.
}

#[test]
fn only_closes_reports_after_a_cleanup_attempt_even_for_failures() {
    let fixture = Fixture::new();
    let mut run = fixture.execution();
    assert!(fixture.repo.finish(&run, None).is_err());
    run.finished_at = Some("2026-10-16T12:00:21Z".into());
    run.state = BackupHealthState::Stopped;
    assert!(fixture.repo.finish(&run, None).is_err());
    assert!(!fixture.root.exists());
    run.state = BackupHealthState::Error;
    run.artifact = None;
    run.diagnosis.result = BackupHealthResult::Failed;
    run.cleanup.state = HealthCleanupState::Error;
    run.cleanup
        .errors
        .push("Docker unavailable secret-token".into());
    fixture.repo.finish(&run, None).unwrap();
    let report = fixture.repo.report_get(&run.run_id).unwrap();
    assert!(report.contains("FAILED"));
    assert!(report.contains("Artifact could not be resolved"));
    assert!(report.contains("Docker unavailable \\[REDACTED\\]"));
    assert_eq!(
        fixture
            .repo
            .get(&run.run_id)
            .unwrap()
            .execution
            .cleanup
            .state,
        HealthCleanupState::Error
    );
}

#[test]
fn reconciles_partial_writes_missing_reports_and_stale_markdown_from_json() {
    let fixture = Fixture::new();
    let run = fixture.closed();
    fs::create_dir_all(&fixture.root).unwrap();
    fs::write(fixture.root.join("reports"), b"blocked reports directory").unwrap();
    assert!(
        fixture
            .repo
            .finish(&run, Some(&fixture.provenance()))
            .is_err()
    );
    assert_eq!(
        fixture.repo.get(&run.run_id).unwrap().report_status,
        ReportStatus::Ready
    );
    fs::remove_file(fixture.root.join("reports")).unwrap();
    let restarted = ExecutionRepository::new(&fixture.root);
    assert!(restarted.reconcile().unwrap().errors.is_empty());
    let expected = restarted.report_get(&run.run_id).unwrap();
    let path = restarted.report_path(&run.run_id).unwrap();
    fs::remove_file(&path).unwrap();
    assert!(restarted.report_list().unwrap().is_empty());
    restarted.reconcile().unwrap();
    assert_eq!(restarted.report_get(&run.run_id).unwrap(), expected);
    fs::write(&path, "stale report").unwrap();
    restarted.reconcile().unwrap();
    assert_eq!(restarted.report_get(&run.run_id).unwrap(), expected);
}

#[test]
fn deletion_preserves_history_and_tombstone_survives_unlink_failure_and_future_finish() {
    let fixture = Fixture::new();
    let run = fixture.closed();
    fixture
        .repo
        .finish(&run, Some(&fixture.provenance()))
        .unwrap();
    let path = fixture.repo.report_path(&run.run_id).unwrap();
    fs::remove_file(&path).unwrap();
    fs::create_dir(&path).unwrap();
    assert!(fixture.repo.report_delete(&run.run_id).is_err());
    let record = fixture.repo.get(&run.run_id).unwrap();
    assert_eq!(record.report_status, ReportStatus::Deleted);
    assert!(record.restore_provenance.is_some());
    assert!(fixture.repo.report_get(&run.run_id).is_err());
    assert!(fixture.repo.report_list().unwrap().is_empty());
    fs::remove_dir(&path).unwrap();
    fixture.repo.reconcile().unwrap();
    fixture.repo.report_delete(&run.run_id).unwrap();
    fixture.repo.finish(&run, None).unwrap();
    fixture.repo.reconcile().unwrap();
    assert!(!path.exists());
    assert_eq!(
        fixture.repo.get(&run.run_id).unwrap().execution.run_id,
        run.run_id
    );
}

#[test]
fn corrupt_history_is_never_overwritten_and_does_not_block_repair_of_other_runs() {
    let fixture = Fixture::new();
    let run = fixture.closed();
    fixture.repo.finish(&run, None).unwrap();
    let path = fixture.repo.execution_path(&run.run_id).unwrap();
    fs::write(&path, b"corrupt history").unwrap();
    assert!(fixture.repo.save(&run, None).is_err());
    assert!(fixture.repo.finish(&run, None).is_err());
    assert!(fixture.repo.list().is_err());
    assert!(fixture.repo.report_delete(&run.run_id).is_err());
    let other = fixture.closed();
    fixture.repo.finish(&other, None).unwrap();
    fs::remove_file(fixture.repo.report_path(&other.run_id).unwrap()).unwrap();
    let outcome = fixture.repo.reconcile().unwrap();
    assert_eq!(outcome.errors.len(), 1);
    assert!(outcome.repaired.contains(&other.run_id));
    assert!(fixture.repo.report_get(&other.run_id).is_ok());
    assert_eq!(fs::read(path).unwrap(), b"corrupt history");
}

#[test]
fn rejects_invalid_ids_versions_timestamp_order_and_mismatched_provenance() {
    let fixture = Fixture::new();
    let mut run = fixture.closed();
    for id in ["../outside", "", "NOT-UUID"] {
        assert!(fixture.repo.get(id).is_err());
        assert!(fixture.repo.report_get(id).is_err());
    }
    let mut wrong = fixture.provenance();
    wrong.path = fixture.root.join("other");
    assert!(fixture.repo.finish(&run, Some(&wrong)).is_err());
    run.finished_at = Some("2020-01-01T00:00:00Z".into());
    assert!(fixture.repo.finish(&run, None).is_err());
    assert!(!fixture.root.exists());
    run = fixture.closed();
    fixture.repo.finish(&run, None).unwrap();
    let path = fixture.repo.execution_path(&run.run_id).unwrap();
    let bytes = fs::read(&path).unwrap();
    let mut value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    value["record_version"] = json!(2);
    fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();
    assert!(fixture.repo.get(&run.run_id).is_err());
    value["record_version"] = json!(1);
    value["run_id"] = json!(Uuid::new_v4().to_string());
    fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();
    assert!(fixture.repo.get(&run.run_id).is_err());
}

#[test]
fn default_policy_omits_logs_and_bounds_explicitly_authorized_logs_on_disk() {
    let fixture = Fixture::new();
    let mut run = fixture.closed();
    run.diagnosis.evidence[0].description = "long description ".repeat(300);
    let default = ExecutionRepository::new(&fixture.root);
    default.finish(&run, None).unwrap();
    let record = default.get(&run.run_id).unwrap();
    assert!(record.execution.diagnosis.evidence[0].logs.is_none());
    assert!(record.execution.diagnosis.evidence[0].description.len() <= 2048);
    assert!(
        record.execution.diagnosis.evidence[0]
            .description
            .starts_with("logs omitted")
    );
    let mut run = fixture.closed();
    let evidence = run.diagnosis.evidence[0].clone();
    run.diagnosis.evidence = vec![evidence; 20];
    for evidence in &mut run.diagnosis.evidence {
        evidence.logs = Some("secret-token é".repeat(10000));
    }
    fixture.repo.finish(&run, None).unwrap();
    let record = fixture.repo.get(&run.run_id).unwrap();
    let bytes: usize = record
        .execution
        .diagnosis
        .evidence
        .iter()
        .filter_map(|evidence| evidence.logs.as_ref())
        .map(String::len)
        .sum();
    assert!(bytes <= super::super::evidence::TOTAL_LOG_BYTES);
    assert!(
        !fixture
            .repo
            .report_get(&run.run_id)
            .unwrap()
            .contains("secret-token")
    );
}

#[test]
fn lists_by_utc_instant_with_stable_uuid_ties() {
    let fixture = Fixture::new();
    let mut earlier = fixture.execution();
    earlier.run_id = "00000000-0000-4000-8000-000000000001".into();
    let mut later = earlier.clone();
    later.run_id = "00000000-0000-4000-8000-000000000002".into();
    later.created_at = "2026-10-16T12:00:00.500Z".into();
    let mut tied = later.clone();
    tied.run_id = "00000000-0000-4000-8000-000000000003".into();
    tied.created_at = "2026-10-16T12:00:00.5+00:00".into();
    for run in [&earlier, &later, &tied] {
        fixture.repo.save(run, None).unwrap();
    }
    assert_eq!(
        fixture
            .repo
            .list()
            .unwrap()
            .into_iter()
            .map(|record| record.execution.run_id)
            .collect::<Vec<_>>(),
        vec![tied.run_id, later.run_id, earlier.run_id]
    );
}

#[test]
fn cannot_replace_creation_identity_or_follow_history_symlinks() {
    let fixture = Fixture::new();
    let run = fixture.execution();
    fixture
        .repo
        .save(&run, Some(&fixture.provenance()))
        .unwrap();
    let original = fs::read(fixture.repo.execution_path(&run.run_id).unwrap()).unwrap();
    let mut substituted = fixture.provenance();
    substituted.identity.as_mut().unwrap().inode += 1;
    assert!(fixture.repo.save(&run, Some(&substituted)).is_err());
    assert_eq!(
        fs::read(fixture.repo.execution_path(&run.run_id).unwrap()).unwrap(),
        original
    );

    let external = fixture.root.join("sentinel.json");
    fs::write(&external, &original).unwrap();
    let path = fixture.repo.execution_path(&run.run_id).unwrap();
    fs::remove_file(&path).unwrap();
    std::os::unix::fs::symlink(&external, &path).unwrap();
    assert!(fixture.repo.get(&run.run_id).is_err());
    assert!(fixture.repo.save(&run, None).is_err());
    assert_eq!(fs::read(&external).unwrap(), original);
}
