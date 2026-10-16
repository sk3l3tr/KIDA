use super::*;
use crate::features::backup::model::BackupTarget;
use std::{process::Command, time::Duration};
use tokio::sync::oneshot;

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("kida-backup-cleanup-{}", Uuid::new_v4()));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

// The child alone changes its configuration, PATH and temporary directory.
#[cfg(unix)]
fn scenario(name: &str) {
    use std::os::unix::fs::PermissionsExt;
    let directory = TestDirectory::new();
    let root = &directory.0;
    fs::create_dir(root.join("artifacts")).unwrap();
    fs::write(root.join("docker"), include_str!("fake_backup_docker.py")).unwrap();
    fs::set_permissions(root.join("docker"), fs::Permissions::from_mode(0o755)).unwrap();
    let mut paths = vec![root.clone()];
    paths.extend(std::env::split_paths(
        &std::env::var_os("PATH").unwrap_or_default(),
    ));
    let output = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "features::backup::service::tests::backup_child",
            "--ignored",
            "--nocapture",
        ])
        .env("KIDA_BACKUP_TEST_ROOT", root)
        .env("KIDA_BACKUP_TEST_SCENARIO", name)
        .env("TMPDIR", root.join("artifacts"))
        .env("PATH", std::env::join_paths(paths).unwrap())
        .output()
        .unwrap();
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(output.status.success(), "{name}: {stdout}\n{stderr}");
    assert!(stdout.contains("1 passed"), "child did not run: {stdout}");
    if name == "cleanup_warning" {
        assert!(
            stderr.contains("WARN: Failed to remove backup temporary artifact"),
            "{stderr}"
        );
        assert_eq!(
            stderr
                .matches("WARN: Failed to remove backup temporary artifact")
                .count(),
            2,
            "{stderr}"
        );
        assert!(
            stderr.contains(root.join("cannot-unlink").to_str().unwrap()),
            "{stderr}"
        );
        assert!(
            stderr.contains(&std::io::Error::from_raw_os_error(libc::EISDIR).to_string()),
            "{stderr}"
        );
    } else {
        assert!(
            !stderr.contains("Failed to remove backup temporary artifact"),
            "{stderr}"
        );
    }
}

#[cfg(unix)]
#[test]
fn success_cleans_temporary_and_preserves_archive() {
    scenario("success");
}

#[cfg(unix)]
#[test]
fn partial_creation_cleans_temporary_after_post() {
    scenario("partial");
}

#[cfg(unix)]
#[test]
fn post_failure_cleans_temporary() {
    scenario("post_failure");
}

#[cfg(unix)]
#[test]
fn checksum_failure_cleans_temporary() {
    scenario("checksum_failure");
}

#[cfg(unix)]
#[test]
fn required_target_failure_cleans_temporary() {
    scenario("required_failure");
}

#[cfg(unix)]
#[test]
fn optional_targets_keep_failed_and_unavailable_results() {
    scenario("optional_failure");
}

#[cfg(unix)]
#[test]
fn cleanup_failure_warns_without_changing_the_primary_result() {
    scenario("cleanup_warning");
}

#[cfg(unix)]
#[test]
fn post_attempts_remaining_steps_after_failure() {
    scenario("post_continues");
}

#[cfg(unix)]
#[test]
fn post_reports_every_failure_in_order() {
    scenario("post_multiple");
}

#[cfg(unix)]
#[test]
fn pre_failure_stops_pre_and_preserves_both_post_failures() {
    scenario("pre_and_post");
}

#[cfg(unix)]
#[test]
fn pre_failure_with_successful_post_keeps_original_error() {
    scenario("pre_only");
}

#[cfg(unix)]
#[test]
fn creation_failure_with_successful_post_keeps_original_error() {
    scenario("partial_only");
}

#[cfg(unix)]
#[test]
fn handler_response_preserves_complete_recovery_diagnostic() {
    scenario("handler_errors");
}

#[cfg(unix)]
#[tokio::test]
#[ignore = "child with isolated configuration, fake Docker and TMPDIR"]
async fn backup_child() {
    use crate::features::backup::model::{BackupTarget, Compression, Lifecycle};
    let root = PathBuf::from(std::env::var_os("KIDA_BACKUP_TEST_ROOT").unwrap());
    let name = std::env::var("KIDA_BACKUP_TEST_SCENARIO").unwrap();
    if name == "cleanup_warning" {
        let path = root.join("cannot-unlink");
        fs::create_dir(&path).unwrap();
        // Drop cannot replace either a successful result or its original error.
        let finish = |result: Result<(), BackupError>| {
            let _artifact = TemporaryArtifact { path: path.clone() };
            result
        };
        finish(Ok(())).unwrap();
        let error = finish(Err(std::io::Error::other("primary failure").into())).unwrap_err();
        assert_eq!(error.to_string(), "backup I/O error: primary failure");
        // Absence is normal when creation failed before opening the temporary.
        drop(TemporaryArtifact {
            path: root.join("absent"),
        });
        return;
    }
    fs::write(
        root.join("config.toml"),
        format!(
            "[backup]\nbackup_dir = {:?}\n[backup_health]\ndata_root = {:?}\n",
            root.join("jobs").to_str().unwrap(),
            root.join("health-data").to_str().unwrap()
        ),
    )
    .unwrap();
    conf::init(root.join("config.toml")).unwrap();
    let source = root.join("source.txt");
    let second = root.join("second.txt");
    // Force zstd to write blocks before the missing second source fails creation.
    if matches!(name.as_str(), "partial" | "partial_only") {
        fs::write(&source, "backup payload".repeat(100_000)).unwrap();
    } else {
        fs::write(&source, "backup payload").unwrap();
    }
    fs::write(&second, "second payload").unwrap();
    let target = root.join("target");
    fs::create_dir(&target).unwrap();
    let mut targets = vec![BackupTarget {
        path: target.clone(),
        required: true,
        filesystem_uuid: None,
    }];
    if name == "optional_failure" {
        fs::create_dir(root.join("failed-target")).unwrap();
        targets.extend([
            BackupTarget {
                path: root.join("failed-target"),
                required: false,
                filesystem_uuid: None,
            },
            BackupTarget {
                path: root.join("missing-target"),
                required: false,
                filesystem_uuid: None,
            },
        ]);
    }
    let mut input = NewBackupJob {
        name: "cleanup-test".into(),
        sources: vec![source.clone(), second],
        targets,
        compression: Compression::TarZstd,
        lifecycle: Lifecycle {
            pre_backup: vec![LifecycleCommand {
                command: "docker.container.stop".into(),
                params: serde_json::json!({"container":"test"}),
            }],
            post_backup: vec![LifecycleCommand {
                command: "docker.container.start".into(),
                params: serde_json::json!({"container":"test"}),
            }],
        },
        schedule: None,
        retention: None,
    };
    let pre_failed = matches!(
        name.as_str(),
        "pre_only" | "pre_and_post" | "handler_errors"
    );
    let two_posts = matches!(
        name.as_str(),
        "post_continues" | "post_multiple" | "pre_only" | "pre_and_post" | "handler_errors"
    );
    if pre_failed {
        input.lifecycle.pre_backup.push(LifecycleCommand {
            command: "docker.container.stop".into(),
            params: serde_json::json!({"container":"second"}),
        });
    }
    if two_posts {
        input.lifecycle.post_backup.push(LifecycleCommand {
            command: "docker.container.start".into(),
            params: serde_json::json!({"container":"second"}),
        });
    }
    let job = BackupService::create(input).unwrap();
    if name == "handler_errors" {
        let response = crate::exec::commands::backup::backup_run::exec(CommandRequest {
            id: "recovery-response".into(),
            command: "backup.run".into(),
            params: serde_json::json!({"id":job.id}),
        })
        .await;
        assert_eq!(response.id, "recovery-response");
        assert!(matches!(response.status, CommandStatus::Error));
        assert!(response.data.is_none());
        let error = response.error.unwrap();
        assert!(
            error.starts_with("backup I/O error: docker stop failed"),
            "{error}"
        );
        assert!(error.contains("injected pre failure"), "{error}");
        assert!(error.contains("step 1 (docker.container.start)"), "{error}");
        assert!(error.contains("injected post failure"), "{error}");
        assert!(error.contains("step 2 (docker.container.start)"), "{error}");
        assert!(error.contains("injected second post failure"), "{error}");
        assert_eq!(
            fs::read_to_string(root.join("calls")).unwrap(),
            "pre\npost\npost2\n"
        );
        assert_eq!(fs::read_dir(root.join("artifacts")).unwrap().count(), 0);
        assert_eq!(fs::read_dir(&target).unwrap().count(), 0);
        return;
    }
    let result = BackupService::run(&job.id).await;
    assert_eq!(
        fs::read_to_string(root.join("calls")).unwrap(),
        if two_posts {
            "pre\npost\npost2\n"
        } else {
            "pre\npost\n"
        }
    );
    assert_eq!(fs::read_dir(root.join("artifacts")).unwrap().count(), 0);
    if matches!(
        name.as_str(),
        "partial"
            | "partial_only"
            | "post_failure"
            | "post_continues"
            | "post_multiple"
            | "pre_only"
            | "pre_and_post"
    ) {
        assert_eq!(fs::read_dir(&target).unwrap().count(), 0);
    }
    match name.as_str() {
        "partial" => {
            let error = result.unwrap_err();
            let primary = std::error::Error::source(&error).unwrap();
            assert!(primary.to_string().contains("second.txt"), "{error}");
            assert!(!primary.to_string().contains("post failure"), "{error}");
            let diagnostic = error.to_string();
            assert!(diagnostic.starts_with(&primary.to_string()), "{diagnostic}");
            assert!(
                diagnostic.contains("step 1 (docker.container.start)"),
                "{diagnostic}"
            );
            assert!(diagnostic.contains("injected post failure"), "{diagnostic}");
        }
        "partial_only" => assert!(
            matches!(result.unwrap_err(), BackupError::Io(error) if error.kind() == std::io::ErrorKind::NotFound && error.to_string().contains("second.txt"))
        ),
        "pre_only" => {
            assert!(
                matches!(result.unwrap_err(), BackupError::Io(error) if error.to_string() == "docker stop failed for 'test': injected pre failure")
            );
        }
        "pre_and_post" | "post_multiple" | "post_continues" => {
            let error = result.unwrap_err();
            if pre_failed {
                let primary = std::error::Error::source(&error).unwrap();
                assert_eq!(
                    primary.to_string(),
                    "backup I/O error: docker stop failed for 'test': injected pre failure"
                );
                assert!(error.to_string().starts_with(&primary.to_string()));
                assert!(matches!(error, BackupError::Recovery { .. }));
            } else {
                assert!(matches!(error, BackupError::PostBackup(_)));
            }
            let diagnostic = error.to_string();
            assert!(
                diagnostic.contains("step 1 (docker.container.start)"),
                "{diagnostic}"
            );
            assert!(diagnostic.contains("injected post failure"), "{diagnostic}");
            if name != "post_continues" {
                assert!(
                    diagnostic.contains("injected second post failure"),
                    "{diagnostic}"
                );
                assert!(diagnostic.find("step 1").unwrap() < diagnostic.find("step 2").unwrap());
            } else {
                assert!(!diagnostic.contains("step 2"), "{diagnostic}");
            }
        }
        "post_failure" => assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("injected post failure")
        ),
        "checksum_failure" => assert!(
            matches!(result.unwrap_err(), BackupError::Io(error) if error.kind() == std::io::ErrorKind::NotFound)
        ),
        "required_failure" => assert_eq!(
            result.unwrap_err().to_string(),
            "backup I/O error: one or more required backup targets failed"
        ),
        "success" | "optional_failure" => {
            let result = result.unwrap();
            assert!(matches!(result.targets[0].status, BackupTargetStatus::Ok));
            let destination = target.join(&result.artifact_name);
            assert_eq!(sha256(&destination).unwrap(), result.checksum);
            assert_eq!(fs::metadata(&destination).unwrap().len(), result.size);
            for reference in [&job.id, &job.name] {
                let selected = BackupService::resolve_artifact(reference, "latest").unwrap();
                assert_eq!(selected.path, fs::canonicalize(&destination).unwrap());
                assert_eq!(selected.checksum, result.checksum);
                assert!(result.artifact_name.contains(&selected.artifact_id));
                assert_eq!(
                    BackupService::resolve_artifact(reference, &selected.artifact_id)
                        .unwrap()
                        .artifact_id,
                    selected.artifact_id
                );
            }
            let decoder = zstd::Decoder::new(File::open(destination).unwrap()).unwrap();
            let mut archive = tar::Archive::new(decoder);
            let restored = root.join("restored");
            archive.unpack(&restored).unwrap();
            assert_eq!(
                fs::read_to_string(restored.join(source.strip_prefix("/").unwrap())).unwrap(),
                "backup payload"
            );
            if name == "optional_failure" {
                assert!(matches!(
                    result.targets[1].status,
                    BackupTargetStatus::Failed
                ));
                assert!(result.targets[1].error.is_some());
                assert!(matches!(
                    result.targets[2].status,
                    BackupTargetStatus::Unavailable
                ));
                assert_eq!(
                    result.targets[2].error.as_deref(),
                    Some("target unavailable")
                );
            }
        }
        _ => panic!("unknown scenario {name}"),
    }
}

#[tokio::test]
async fn cancellation_keeps_artifact_alive_until_blocking_work_finishes() {
    for finalize in [false, true] {
        let directory = TestDirectory::new();
        let path = directory.0.join("artifact.tar.zst");
        fs::write(&path, "still in use").unwrap();
        let artifact = TemporaryArtifact { path: path.clone() };
        let (started, running) = oneshot::channel();
        let (release, gate) = std::sync::mpsc::channel();
        let (finished, done) = oneshot::channel();
        let waiter = tokio::spawn(async move {
            let creation = tokio::task::spawn_blocking(move || {
                started.send(()).unwrap();
                gate.recv().unwrap();
                assert_eq!(fs::read_to_string(&artifact.path).unwrap(), "still in use");
                if finalize {
                    // Finalization destroys its owner inside the blocking task.
                    drop(artifact);
                    finished.send(()).unwrap();
                    None
                } else {
                    // Creation returns its owner; the cancelled waiter drops the output.
                    finished.send(()).unwrap();
                    Some(artifact)
                }
            })
            .await;
            drop(creation);
        });
        tokio::time::timeout(Duration::from_secs(5), running)
            .await
            .unwrap()
            .unwrap();
        waiter.abort();
        assert!(waiter.await.unwrap_err().is_cancelled());
        assert!(
            path.exists(),
            "cancellation removed a temporary still in use"
        );
        release.send(()).unwrap();
        tokio::time::timeout(Duration::from_secs(5), done)
            .await
            .unwrap()
            .unwrap();
        tokio::time::timeout(Duration::from_secs(5), async {
            while path.exists() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
    }
}

#[tokio::test]
async fn post_preserves_lifecycle_restrictions_and_reports_each_rejected_step() {
    let commands = ["system.shutdown", "backup.run"].map(|command| LifecycleCommand {
        command: command.into(),
        params: serde_json::json!({"secret":"must-not-be-logged"}),
    });
    let error = run_post_backup(&commands).await.unwrap_err().to_string();
    assert!(error.contains("step 1 (system.shutdown): backup I/O error: Command not allowed in backup lifecycle: system.shutdown"));
    assert!(error.contains(
        "step 2 (backup.run): backup I/O error: Command not allowed in backup lifecycle: backup.run"
    ));
    assert!(!error.contains("must-not-be-logged"));
}

#[tokio::test]
async fn blocking_task_failure_remains_the_source_when_post_fails() {
    let task = tokio::task::spawn_blocking(|| -> Result<(), BackupError> {
        panic!("injected artifact task failure");
    })
    .await;
    assert!(task.as_ref().unwrap_err().is_panic());
    let primary = task
        .map_err(|error| {
            BackupError::from(std::io::Error::other(format!(
                "Backup artifact task failed: {error}"
            )))
        })
        .and_then(|result| result);
    let post = run_post_backup(&[LifecycleCommand {
        command: "backup.run".into(),
        params: serde_json::Value::Null,
    }])
    .await;
    let error = complete_with_post(primary, post).unwrap_err();
    let source = std::error::Error::source(&error).unwrap().to_string();
    assert!(source.contains("Backup artifact task failed:"));
    assert!(source.contains("injected artifact task failure"));
    let diagnostic = error.to_string();
    assert!(diagnostic.starts_with(&source));
    assert!(diagnostic.contains("post_backup failed: step 1 (backup.run)"));
}

fn catalog_job(targets: Vec<BackupTarget>) -> BackupJob {
    serde_json::from_value(serde_json::json!({
        "id": Uuid::new_v4().to_string(), "name": "catalog-test",
        "sources": [], "targets": targets, "compression": "tar_zstd"
    }))
    .unwrap()
}

fn finalize_case(
    root: &Path,
    job: &BackupJob,
    id: &str,
    date: DateTime<Utc>,
    payload: &str,
    data_root: &Path,
) -> Result<BackupRunResult, BackupError> {
    let source = root.join("source.txt");
    fs::write(&source, payload).unwrap();
    let path = root.join(format!("temporary-{id}.tar.zst"));
    create_artifact(&[source], &path).unwrap();
    finalize_backup(
        job.clone(),
        id.into(),
        date,
        artifact_name(&job.name, &date, id),
        TemporaryArtifact { path },
        ArtifactRepository::new(data_root),
    )
}

#[test]
fn same_timestamp_backups_keep_both_versions_and_resolve_real_registered_copies() {
    let directory = TestDirectory::new();
    let target = directory.0.join("target");
    fs::create_dir(&target).unwrap();
    let job = catalog_job(vec![BackupTarget {
        path: target,
        required: true,
        filesystem_uuid: None,
    }]);
    let date = DateTime::parse_from_rfc3339("2026-10-16T10:00:00Z")
        .unwrap()
        .with_timezone(&Utc);
    let first_id = Uuid::new_v4().to_string();
    let second_id = Uuid::new_v4().to_string();
    let first = finalize_case(&directory.0, &job, &first_id, date, "first", &directory.0).unwrap();
    let second =
        finalize_case(&directory.0, &job, &second_id, date, "second", &directory.0).unwrap();
    assert_ne!(first.artifact_name, second.artifact_name);
    let repository = ArtifactRepository::new(&directory.0);
    for (id, result) in [(&first_id, &first), (&second_id, &second)] {
        let selected = repository.resolve(&job.id, id).unwrap();
        assert_eq!(selected.checksum, result.checksum);
        assert_eq!(sha256(&selected.path).unwrap(), result.checksum);
        assert_eq!(selected.artifact_name, result.artifact_name);
    }
    assert_eq!(
        repository.resolve(&job.id, "latest").unwrap().artifact_id,
        first_id.max(second_id)
    );
    assert_eq!(fs::read_dir(&directory.0).unwrap().count(), 3); // source, targets, catalog
}

#[test]
fn registers_partial_success_without_hiding_required_failure_or_catalog_failure() {
    for catalog_failure in [false, true] {
        let directory = TestDirectory::new();
        let target = directory.0.join("target");
        let blocked_target = directory.0.join("blocked-target");
        fs::create_dir(&target).unwrap();
        fs::create_dir(&blocked_target).unwrap();
        let job = catalog_job(vec![
            BackupTarget {
                path: target,
                required: true,
                filesystem_uuid: None,
            },
            BackupTarget {
                path: blocked_target.clone(),
                required: true,
                filesystem_uuid: None,
            },
        ]);
        let id = Uuid::new_v4().to_string();
        let date = Utc::now();
        fs::write(
            blocked_target.join(artifact_name(&job.name, &date, &id)),
            "untouched",
        )
        .unwrap();
        let data_root = directory.0.join("data");
        if catalog_failure {
            fs::write(&data_root, "blocked catalog").unwrap();
        }
        let error =
            finalize_case(&directory.0, &job, &id, date, "payload", &data_root).unwrap_err();
        assert!(
            error
                .to_string()
                .starts_with("backup I/O error: one or more required backup targets failed")
        );
        if catalog_failure {
            assert!(matches!(error, BackupError::ArtifactRegistration { .. }));
            assert!(
                error
                    .to_string()
                    .contains("artifact catalog registration failed")
            );
            assert_eq!(
                std::error::Error::source(&error).unwrap().to_string(),
                "backup I/O error: one or more required backup targets failed"
            );
            assert!(
                ArtifactRepository::new(&data_root)
                    .resolve(&job.id, "latest")
                    .is_err()
            );
        } else {
            assert!(
                ArtifactRepository::new(&data_root)
                    .resolve(&job.id, &id)
                    .is_ok()
            );
        }
        assert_eq!(
            fs::read_to_string(blocked_target.join(artifact_name(&job.name, &date, &id))).unwrap(),
            "untouched"
        );
        assert!(!directory.0.join(format!("temporary-{id}.tar.zst")).exists());
    }
}

#[test]
fn metadata_failure_is_not_success_and_no_valid_replica_is_not_registered() {
    let directory = TestDirectory::new();
    let target = directory.0.join("target");
    fs::create_dir(&target).unwrap();
    let job = catalog_job(vec![BackupTarget {
        path: target.clone(),
        required: true,
        filesystem_uuid: None,
    }]);
    let blocked_data = directory.0.join("blocked-data");
    fs::write(&blocked_data, "untouched").unwrap();
    assert!(
        finalize_case(
            &directory.0,
            &job,
            &Uuid::new_v4().to_string(),
            Utc::now(),
            "payload",
            &blocked_data
        )
        .is_err()
    );
    assert_eq!(fs::read_dir(&target).unwrap().count(), 1);
    assert_eq!(fs::read_to_string(&blocked_data).unwrap(), "untouched");
    assert!(
        ArtifactRepository::new(&blocked_data)
            .resolve(&job.id, "latest")
            .is_err()
    );

    let id = Uuid::new_v4().to_string();
    let date = Utc::now();
    fs::write(
        target.join(artifact_name(&job.name, &date, &id)),
        "existing",
    )
    .unwrap();
    assert!(finalize_case(&directory.0, &job, &id, date, "payload", &directory.0).is_err());
    assert!(!directory.0.join("artifacts").exists());
}

#[test]
fn replica_collision_or_failed_verification_preserves_existing_files_and_cleans_staging() {
    let directory = TestDirectory::new();
    let source = directory.0.join("source");
    fs::write(&source, "payload").unwrap();
    let checksum = sha256(&source).unwrap();
    let target = directory.0.join("target");
    fs::create_dir(&target).unwrap();
    let destination = target.join("copy.tar.zst");
    fs::write(&destination, "existing").unwrap();
    assert!(copy_replica(&source, &destination, &checksum, 7).is_err());
    assert_eq!(fs::read_to_string(&destination).unwrap(), "existing");
    fs::remove_file(&destination).unwrap();
    fs::create_dir(&destination).unwrap();
    assert!(copy_replica(&source, &destination, &checksum, 7).is_err());
    assert!(destination.is_dir());
    fs::remove_dir(&destination).unwrap();
    assert!(copy_replica(&source, &destination, &"a".repeat(64), 7).is_err());
    assert_eq!(fs::read_dir(&target).unwrap().count(), 0);
}

#[cfg(unix)]
#[test]
fn replica_publication_never_follows_or_replaces_destination_symlinks() {
    let directory = TestDirectory::new();
    let source = directory.0.join("source");
    fs::write(&source, "payload").unwrap();
    let sentinel = directory.0.join("sentinel");
    fs::write(&sentinel, "untouched").unwrap();
    for link_target in [&sentinel, &directory.0.join("absent")] {
        let destination = directory.0.join("copy.tar.zst");
        std::os::unix::fs::symlink(link_target, &destination).unwrap();
        assert!(copy_replica(&source, &destination, &sha256(&source).unwrap(), 7).is_err());
        assert_eq!(fs::read_link(&destination).unwrap(), *link_target);
        assert_eq!(fs::read_to_string(&sentinel).unwrap(), "untouched");
        fs::remove_file(destination).unwrap();
    }
}
