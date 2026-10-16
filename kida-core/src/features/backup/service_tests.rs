use super::*;
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
            "[backup]\nbackup_dir = {:?}\n",
            root.join("jobs").to_str().unwrap()
        ),
    )
    .unwrap();
    conf::init(root.join("config.toml")).unwrap();
    let source = root.join("source.txt");
    let second = root.join("second.txt");
    fs::write(&source, "backup payload").unwrap();
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
    let job = BackupService::create(NewBackupJob {
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
    })
    .unwrap();
    let result = BackupService::run(&job.id).await;
    assert_eq!(
        fs::read_to_string(root.join("calls")).unwrap(),
        "pre\npost\n"
    );
    assert_eq!(fs::read_dir(root.join("artifacts")).unwrap().count(), 0);
    match name.as_str() {
        "partial" => {
            let error = result.unwrap_err().to_string();
            assert!(error.contains("second.txt"), "{error}");
            // The post error injected too must not replace the creation error (Q03 unchanged).
            assert!(!error.contains("post failure"), "{error}");
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
