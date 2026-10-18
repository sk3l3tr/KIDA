use super::*;
use crate::features::backup::{
    artifacts::{self, ArtifactRepository, StoredArtifact},
    repository::BackupRepository,
};
use serde_json::{Value, json};
use std::{fs, os::unix::fs::PermissionsExt, process::Command};

#[test]
fn lifecycle_with_isolated_fake_docker() {
    let root = std::env::temp_dir().join(format!("kida-health-lifecycle-{}", Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let fake = include_str!("../../docker/fake_docker.py")
        .replace("project = os.environ.get('KIDA_TEST_PROJECT', 'alpha')", "project = (root / 'current-project').read_text()")
        .replace("if mode == 'start-error' and 'start' in a:", "if (mode == 'start-error' and 'start' in a) or (mode == 'stop-error' and 'stop' in a):")
        .replace("'State': {'Running': False}", "'State': {'Running': False, 'Status': 'running', 'ExitCode': 0, 'StartedAt': '2026-10-18T10:00:00Z', 'FinishedAt': '0001-01-01T00:00:00Z', 'Health': {'Status': 'healthy'}}")
        .replace("'NetworkSettings': {'Networks':", "'HostConfig': {'RestartPolicy': {'Name': 'no'}}, 'RestartCount': 0, 'NetworkSettings': {'Ports': {}, 'Networks':")
        .replace("'Mounts': [{'Type': 'volume', 'Name': project + '_data'}]", "'Mounts': [{'Type': 'volume', 'Name': project + '_data'}, {'Type': 'bind', 'Source': os.environ['KIDA_RESTORE_DIR'], 'Destination': '/restore'}]")
        .replace("'Config': {'Labels': dict(tags", "'Config': {'Image': 'example/web:1', 'Labels': dict(tags")
        .replace("# Output-limit scenarios", "state['volume'].append({'Name': 'shared', 'Labels': {'production': 'true'}, 'Driver': 'local', 'Scope': 'local', 'Options': None})\n            # Output-limit scenarios");
    fs::write(root.join("docker"), fake).unwrap();
    fs::set_permissions(root.join("docker"), fs::Permissions::from_mode(0o755)).unwrap();
    let mut config = crate::conf::KidaConfig::default();
    config.backup.backup_dir = root.join("backups").to_str().unwrap().into();
    config.backup_health.data_root = root.join("data");
    config.backup_health.restore_root = root.join("restore");
    // Cleanup starts many Python subprocesses under a shared deadline. Allow
    // contention on CI runners; this fixture tests lifecycle, not timeouts.
    config.backup_health.health_timeout_seconds = 30;
    config.backup_health.max_active_runs = 1;
    config.docker.ownership_dir = root.join("ownership").to_str().unwrap().into();
    fs::write(root.join("config.toml"), toml::to_string(&config).unwrap()).unwrap();
    let mut paths = vec![root.clone()];
    paths.extend(std::env::split_paths(
        &std::env::var_os("PATH").unwrap_or_default(),
    ));
    let output = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "features::backup::health::service::lifecycle_tests::lifecycle_child",
            "--ignored",
            "--nocapture",
        ])
        .env("KIDA_LIFECYCLE_DIR", &root)
        .env("PATH", std::env::join_paths(paths).unwrap())
        .output()
        .unwrap();
    fs::remove_dir_all(root).unwrap();
    assert!(
        output.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(String::from_utf8_lossy(&output.stdout).contains("1 passed"));
}

fn catalog(root: &Path, job: &crate::features::backup::model::BackupJob, valid_tar: bool) {
    let path = root.join("copy.tar.zst");
    let tar = if valid_tar {
        let mut builder = tar::Builder::new(Vec::new());
        let mut header = tar::Header::new_gnu();
        header.set_size(4);
        header.set_mode(0o644);
        header.set_cksum();
        builder
            .append_data(&mut header, "data.txt", &b"data"[..])
            .unwrap();
        builder.into_inner().unwrap()
    } else {
        b"invalid tar".to_vec()
    };
    fs::write(&path, zstd::stream::encode_all(&tar[..], 0).unwrap()).unwrap();
    ArtifactRepository::new(root.join("data"))
        .create(&StoredArtifact {
            artifact_id: Uuid::new_v4().to_string(),
            job_id: job.id.clone(),
            artifact_name: "copy.tar.zst".into(),
            created_at: Utc::now().to_rfc3339(),
            checksum: artifacts::sha256(&path).unwrap(),
            size: fs::metadata(&path).unwrap().len(),
            destinations: vec![path],
        })
        .unwrap();
}

async fn admitted(
    service: &HealthService,
    root: &Path,
    mode: BackupHealthMode,
) -> BackupHealthExecution {
    let run = service
        .create(&root.join("health.toml"), mode)
        .await
        .unwrap();
    fs::write(
        root.join("current-project"),
        format!("kida-bh-{}", run.run_id),
    )
    .unwrap();
    fs::write(root.join("health-model.json"), serde_json::to_vec(&json!({
        "services": {"web": {"image": "example/web:1", "restart": "no", "volumes": [{"type":"bind", "source":run.restore_dir,"target":"/restore"}]}},
        "networks": {"default": {"name":format!("kida-bh-{}_default",run.run_id)}},
        "volumes": {"data": {"name":format!("kida-bh-{}_data",run.run_id)}, "external":{"name":"shared","external":true}}
    })).unwrap()).unwrap();
    service
        .start(&run.run_id, |_| Ok("queue-id".into()))
        .await
        .unwrap();
    run
}
fn state(root: &Path) -> Value {
    serde_json::from_slice(&fs::read(root.join("state")).unwrap()).unwrap()
}
fn reset(root: &Path, scenario: &str) {
    let _ = fs::remove_file(root.join("state"));
    fs::write(root.join("scenario"), scenario).unwrap();
}

#[tokio::test]
#[ignore = "isolated fixture child invoked by lifecycle_with_isolated_fake_docker"]
async fn lifecycle_child() {
    let root = std::path::PathBuf::from(std::env::var_os("KIDA_LIFECYCLE_DIR").unwrap());
    crate::conf::init(root.join("config.toml")).unwrap();
    let config = crate::conf::get().unwrap();
    let job = serde_json::from_value(json!({"id":Uuid::new_v4().to_string(),"name":"daily","sources":[],"targets":[],"compression":"tar_zstd"})).unwrap();
    BackupRepository::new(&config.backup.backup_dir)
        .create(&job)
        .unwrap();
    fs::write(root.join("compose with spaces.yaml"), "services: {}\n").unwrap();
    fs::write(root.join("health.toml"), "id='app'\nname='App'\n[backup]\nreference='daily'\nversion='latest'\n[docker]\ncompose='compose with spaces.yaml'\n").unwrap();
    catalog(&root, &job, true);
    let service = HealthService::new(config.backup_health.clone())
        .await
        .unwrap();

    reset(&root, "normal");
    let automatic = admitted(&service, &root, BackupHealthMode::Automatic).await;
    service.execute(&automatic.run_id).await.unwrap();
    let done = service.get(&automatic.run_id).await.unwrap();
    assert_eq!(done.diagnosis.result, BackupHealthResult::Healthy);
    assert_eq!(
        done.cleanup.state,
        HealthCleanupState::Completed,
        "{:?}",
        done.cleanup.errors
    );
    assert!(!done.restore_dir.exists());
    assert_eq!(state(&root)["container"], json!([]));
    assert_eq!(state(&root)["volume"][0]["Name"], "shared");
    assert!(
        service
            .report_get(&automatic.run_id)
            .await
            .unwrap()
            .contains("HEALTHY")
    );

    reset(&root, "normal");
    let manual = admitted(&service, &root, BackupHealthMode::Manual).await;
    service.execute(&manual.run_id).await.unwrap();
    assert_eq!(
        fs::read(manual.restore_dir.join("data.txt")).unwrap(),
        b"data"
    );
    service.stop(&manual.run_id).await.unwrap();
    assert!(manual.restore_dir.exists());
    let deleted = service.delete(&manual.run_id).await.unwrap();
    assert_eq!(
        deleted.cleanup.state,
        HealthCleanupState::Completed,
        "{:?}",
        deleted.cleanup.errors
    );
    assert!(!manual.restore_dir.exists());

    for scenario in ["start-error", "partial-create", "config-error"] {
        reset(&root, scenario);
        let run = admitted(&service, &root, BackupHealthMode::Automatic).await;
        service.execute(&run.run_id).await.unwrap();
        let failed = service.get(&run.run_id).await.unwrap();
        assert_eq!(failed.state, BackupHealthState::Error, "{scenario}");
        assert_eq!(
            failed.diagnosis.result,
            BackupHealthResult::Failed,
            "{scenario}"
        );
        assert_eq!(
            failed.cleanup.state,
            HealthCleanupState::Completed,
            "{scenario}: {:?}",
            failed.cleanup.errors
        );
        assert!(!failed.restore_dir.exists(), "{scenario}");
    }

    reset(&root, "normal");
    let run = admitted(&service, &root, BackupHealthMode::Manual).await;
    service.execute(&run.run_id).await.unwrap();
    fs::write(root.join("scenario"), "stop-error").unwrap();
    let stopped = service.stop(&run.run_id).await.unwrap();
    assert_eq!(stopped.cleanup.state, HealthCleanupState::Error);
    assert!(
        service
            .registry
            .lock()
            .unwrap()
            .reservations
            .contains_key(&run.run_id)
    );
    fs::write(root.join("scenario"), "normal").unwrap();
    service.delete(&run.run_id).await.unwrap();
    assert!(
        !service
            .registry
            .lock()
            .unwrap()
            .reservations
            .contains_key(&run.run_id)
    );

    reset(&root, "normal");
    let run = admitted(&service, &root, BackupHealthMode::Manual).await;
    service.execute(&run.run_id).await.unwrap();
    let original = root.join("original-restoration");
    fs::rename(&run.restore_dir, &original).unwrap();
    fs::create_dir(&run.restore_dir).unwrap();
    fs::write(run.restore_dir.join("foreign.txt"), "preserve").unwrap();
    let incomplete = service.delete(&run.run_id).await.unwrap();
    assert_eq!(incomplete.cleanup.state, HealthCleanupState::Error);
    assert_eq!(
        fs::read(run.restore_dir.join("foreign.txt")).unwrap(),
        b"preserve"
    );
    assert_eq!(state(&root)["container"], json!([]));
    fs::rename(&run.restore_dir, root.join("foreign-restoration")).unwrap();
    fs::rename(original, &run.restore_dir).unwrap();
    let retried = service.delete(&run.run_id).await.unwrap();
    assert_eq!(
        retried.cleanup.state,
        HealthCleanupState::Completed,
        "{:?}",
        retried.cleanup.errors
    );
    assert!(!run.restore_dir.exists());

    for valid_tar in [false, true] {
        reset(&root, "normal");
        catalog(&root, &job, valid_tar);
        if valid_tar {
            fs::write(root.join("copy.tar.zst"), "tampered").unwrap();
        }
        let run = admitted(&service, &root, BackupHealthMode::Automatic).await;
        service.execute(&run.run_id).await.unwrap();
        let failed = service.get(&run.run_id).await.unwrap();
        assert_eq!(failed.diagnosis.result, BackupHealthResult::Failed);
        assert_eq!(failed.cleanup.state, HealthCleanupState::Completed);
    }
}
