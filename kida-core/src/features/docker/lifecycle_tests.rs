//! The fake Docker runs only in a subprocess, never changing the suite's environment.
use super::{ComposeOptions, DockerService};
use serde_json::{Value, json};
use std::{collections::BTreeSet, fs, path::PathBuf, process::Command, time::Duration};

#[cfg(unix)]
#[test]
fn lifecycle_with_isolated_fake_docker() {
    run_isolated_fake_docker("lifecycle_child", false);
}

#[cfg(unix)]
#[test]
fn ownership_with_isolated_fake_docker() {
    run_isolated_fake_docker("ownership_child", false);
}

#[cfg(unix)]
#[test]
fn persistence_with_isolated_fake_docker() {
    run_isolated_fake_docker("persistence_child", false);
}

#[cfg(unix)]
#[test]
fn concurrency_with_isolated_fake_docker() {
    run_isolated_fake_docker("concurrency_child", false);
}

#[cfg(unix)]
#[test]
fn lifecycle_with_missing_docker() {
    run_isolated_fake_docker("lifecycle_child", true);
}

#[cfg(unix)]
fn run_isolated_fake_docker(child: &str, missing: bool) {
    use std::os::unix::fs::PermissionsExt;
    let dir = std::env::temp_dir().join(format!("kida-lifecycle-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(dir.join("ownership")).unwrap();
    fs::write(dir.join("docker"), include_str!("fake_docker.py")).unwrap();
    fs::set_permissions(dir.join("docker"), fs::Permissions::from_mode(0o755)).unwrap();
    fs::write(dir.join("compose with spaces.yaml"), "services: {}\n").unwrap();
    fs::write(dir.join("scenario"), "normal").unwrap();
    let mut paths = vec![dir.clone()];
    paths.extend(std::env::split_paths(
        &std::env::var_os("PATH").unwrap_or_default(),
    ));
    let mut cmd = Command::new(std::env::current_exe().unwrap());
    cmd.args([
        "--exact",
        &format!("features::docker::lifecycle_tests::{child}"),
        "--ignored",
        "--nocapture",
    ])
    .env("KIDA_LIFECYCLE_DIR", &dir)
    .env_remove("KIDA_OWNERSHIP_RELOAD")
    .env_remove("KIDA_LIFECYCLE_MISSING")
    .env("COMPOSE_PROFILES", "should-not-enable")
    .env("COMPOSE_REMOVE_ORPHANS", "true")
    .env(
        "PATH",
        if missing {
            dir.join("missing").into_os_string()
        } else {
            std::env::join_paths(paths).unwrap()
        },
    );
    if missing {
        cmd.env("KIDA_LIFECYCLE_MISSING", "1");
    }
    let output = cmd.output().unwrap();
    fs::remove_dir_all(dir).unwrap();
    assert!(
        output.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(String::from_utf8_lossy(&output.stdout).contains("1 passed"));
}

#[cfg(unix)]
async fn assert_descendant_dead(pid: i32) {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    loop {
        let state = match fs::read_to_string(format!("/proc/{pid}/stat")) {
            Ok(state) => state,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
            Err(error) => panic!("cannot inspect descendant {pid}: {error}"),
        };
        // A killed orphan may remain as a zombie until its system reaper runs.
        if state.split_whitespace().nth(2) == Some("Z") {
            return;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "descendant {pid} still running after 5 seconds: {state}"
        );
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

#[cfg(unix)]
fn isolated_options() -> (PathBuf, ComposeOptions) {
    let dir = PathBuf::from(std::env::var_os("KIDA_LIFECYCLE_DIR").unwrap());
    fs::write(
        dir.join("config.toml"),
        format!(
            "[docker]\nownership_dir = {:?}\n",
            dir.join("ownership").to_str().unwrap()
        ),
    )
    .unwrap();
    crate::infrastructure::conf::init(dir.join("config.toml")).unwrap();
    let mut options = ComposeOptions::new("alpha", dir.join("compose with spaces.yaml"));
    assert_eq!(options.timeout, Duration::from_secs(300));
    options.variables.insert(
        "KIDA_INTERPOLATION".into(),
        "literal $HOME; $(false) with spaces".into(),
    );
    (dir, options)
}

#[cfg(unix)]
#[tokio::test]
#[ignore = "subprocess with isolated fake Docker PATH"]
async fn ownership_child() {
    let (dir, options) = isolated_options();
    if let Ok(reference) = std::env::var("KIDA_OWNERSHIP_RELOAD") {
        let reference = serde_json::from_str(&reference).unwrap();
        let report = DockerService::compose_remove(&reference, Duration::from_secs(20))
            .await
            .unwrap();
        assert_eq!(report.removed.len(), 4);
        return;
    }
    DockerService::compose_create(&options).await.unwrap();
    Box::pin(ownership_checks(&dir, &options)).await;
}

#[cfg(unix)]
#[tokio::test]
#[ignore = "subprocess with isolated fake Docker PATH"]
async fn persistence_child() {
    let (dir, options) = isolated_options();
    Box::pin(persistence_checks(&dir, &options)).await;
}

#[cfg(unix)]
#[tokio::test]
#[ignore = "subprocess with isolated fake Docker PATH"]
async fn concurrency_child() {
    let (dir, _) = isolated_options();
    Box::pin(concurrency_checks(&dir)).await;
}

#[cfg(unix)]
#[tokio::test]
#[ignore = "subprocess with isolated fake Docker PATH"]
async fn lifecycle_child() {
    let (dir, mut options) = isolated_options();
    if std::env::var_os("KIDA_LIFECYCLE_MISSING").is_some() {
        assert!(
            DockerService::compose_create(&options)
                .await
                .unwrap_err()
                .contains("Docker executable missing")
        );
        return;
    }
    let scenario = |name| {
        let _ = fs::remove_dir_all(dir.join("ownership"));
        let _ = fs::remove_file(dir.join("state"));
        fs::write(dir.join("scenario"), name).unwrap();
    };
    let calls = || fs::read_to_string(dir.join("calls")).unwrap_or_default();
    let mutations = || {
        calls()
            .lines()
            .filter(|l| {
                let v: Value = serde_json::from_str(l).unwrap();
                v["args"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|a| ["create", "start", "stop"].contains(&a.as_str().unwrap()))
            })
            .count()
    };
    for name in ["", "Upper", "-bad", "a b", "a\0b"] {
        let mut invalid = options.clone();
        invalid.project = name.into();
        assert!(
            DockerService::compose_create(&invalid)
                .await
                .unwrap_err()
                .contains("input error")
        );
    }
    for file in [dir.clone(), dir.join("missing")] {
        let mut invalid = options.clone();
        invalid.file = file;
        assert!(
            DockerService::compose_start(&invalid)
                .await
                .unwrap_err()
                .contains("input error")
        );
    }
    for (key, value) in [
        ("PATH", "x"),
        ("HOME", "x"),
        ("XDG_CONFIG_HOME", "x"),
        ("DOCKER_HOST", "x"),
        ("COMPOSE_FILE", "x"),
        ("LD_PRELOAD", "x"),
        ("DYLD_LIBRARY_PATH", "x"),
        ("1bad", "x"),
        ("a=b", "x"),
        ("", "x"),
        ("OK", "a\0b"),
    ] {
        let mut invalid = options.clone();
        invalid.variables.insert(key.into(), value.into());
        assert!(
            DockerService::compose_stop(&invalid)
                .await
                .unwrap_err()
                .contains("input error")
        );
    }
    let mut invalid = options.clone();
    invalid.timeout = Duration::ZERO;
    assert!(DockerService::compose_create(&invalid).await.is_err());
    assert!(calls().is_empty(), "invalid input invoked Docker");
    DockerService::compose_create(&options).await.unwrap();
    assert_eq!(
        std::env::var("COMPOSE_PROFILES").unwrap(),
        "should-not-enable"
    );
    assert!(std::env::var_os("KIDA_INTERPOLATION").is_none());
    let records: Vec<Value> = calls()
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    for record in &records {
        assert_eq!(record["variable"], "literal $HOME; $(false) with spaces");
        assert_eq!(record["profiles"], "");
        assert_eq!(record["remove_orphans"], "false");
    }
    let path = fs::canonicalize(&options.file).unwrap();
    let prefix = json!([
        "compose",
        "--project-name",
        "alpha",
        "--file",
        path,
        "--project-directory",
        dir
    ]);
    let mut expected = prefix.as_array().unwrap().clone();
    let creation = records
        .iter()
        .find(|r| r["args"].as_array().unwrap().contains(&json!("create")))
        .unwrap();
    let overlay = creation["args"][8].clone();
    expected.extend([
        json!("--file"),
        overlay,
        json!("create"),
        json!("--no-recreate"),
    ]);
    assert_eq!(creation["args"], json!(expected));
    assert_eq!(
        &records[0]["args"].as_array().unwrap()[7..],
        &[json!("config"), json!("--format"), json!("json")]
    );
    scenario("normal");
    for (mode, expected) in [
        ("reserved-label", "reserved io.kida.*"),
        ("project-container", "conflict"),
        ("project-network", "conflict"),
        ("project-volume", "conflict"),
        ("container-name", "occupied"),
        ("network-name", "occupied"),
        ("volume-name", "occupied"),
        ("external-missing", "external but missing"),
        ("invalid-json", "invalid output"),
        ("config-error", "input error"),
        ("invalid-model", "invalid output"),
        ("plugin-missing", "plugin missing"),
        ("daemon-error", "daemon inaccessible"),
        ("list-error", "command failed"),
        ("inspect-invalid", "invalid output"),
    ] {
        scenario(mode);
        let before = mutations();
        let err = if mode == "inspect-invalid" {
            DockerService::compose_start(&options).await.unwrap_err()
        } else {
            DockerService::compose_create(&options).await.unwrap_err()
        };
        assert!(err.contains(expected), "{mode}: {err}");
        assert_eq!(mutations(), before, "{mode} mutated after a failed check");
    }
    for mode in ["missing-env-file", "external-missing"] {
        scenario(mode);
        let before = calls().lines().count();
        DockerService::compose_stop(&options).await.unwrap();
        let records: Vec<Value> = calls()
            .lines()
            .skip(before)
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        assert_eq!(records.len(), 3, "Stop must only list, inspect and stop");
        assert_eq!(records[0]["args"][0], "ps");
        assert_eq!(records[1]["args"][0], "inspect");
        assert_eq!(records[2]["args"][7], "stop");
        let before = mutations();
        let error = DockerService::compose_start(&options).await.unwrap_err();
        assert!(
            error.contains(if mode == "missing-env-file" {
                "input error"
            } else {
                "external but missing"
            }),
            "{mode}: {error}"
        );
        assert_eq!(mutations(), before);
    }
    scenario("config-overflow");
    let before = mutations();
    let began = std::time::Instant::now();
    let error = DockerService::compose_create(&options).await.unwrap_err();
    assert!(
        error.contains("stdout exceeds 8388608 byte limit"),
        "{error}"
    );
    assert!(began.elapsed() < Duration::from_secs(5));
    assert_eq!(mutations(), before);
    let pid = fs::read_to_string(dir.join("parent-pid")).unwrap();
    assert!(!PathBuf::from(format!("/proc/{}", pid.trim())).exists());
    fs::remove_file(dir.join("parent-pid")).unwrap();
    let pid = fs::read_to_string(dir.join("pid")).unwrap();
    assert_descendant_dead(pid.trim().parse().unwrap()).await;
    fs::remove_file(dir.join("pid")).unwrap();
    scenario("noisy-failure");
    let error = DockerService::compose_create(&options).await.unwrap_err();
    assert!(error.contains("[stderr truncated]"));
    assert!(error.contains("resources may be partial"));
    assert!(error.len() < 66 * 1024);
    for mode in [
        "normal",
        "external",
        "noisy",
        "config-limit",
        "noisy-mutation",
    ] {
        scenario(mode);
        DockerService::compose_create(&options).await.unwrap();
    }
    for mode in ["existing", "foreign-origin"] {
        // foreign-origin has valid native labels, without any KIDA metadata.
        scenario(mode);
        DockerService::compose_start(&options).await.unwrap();
        let observed = DockerService::compose_project("alpha").unwrap();
        assert_eq!(observed.services.len(), 2);
        assert_eq!(
            observed
                .services
                .iter()
                .map(|s| s.containers.len())
                .sum::<usize>(),
            3
        );
        DockerService::compose_stop(&options).await.unwrap();
    }
    for mode in [
        "no-containers",
        "missing-label",
        "wrong-project",
        "wrong-file",
        "wrong-directory",
        "multiple-files",
        "mixed-provenance",
        "inspect-invalid",
        "inspect-incomplete",
        "inspect-wrong-id",
    ] {
        scenario(mode);
        for action in ["start", "stop"] {
            let before = mutations();
            let err = if action == "start" {
                DockerService::compose_start(&options).await
            } else {
                DockerService::compose_stop(&options).await
            }
            .unwrap_err();
            assert!(
                err.contains("conflict") || err.contains("invalid output"),
                "{mode}: {err}"
            );
            assert_eq!(mutations(), before);
        }
    }
    scenario("command-error");
    assert!(
        DockerService::compose_create(&options)
            .await
            .unwrap_err()
            .contains("resources may be partial")
    );
    // The deadline applies to checks, the mutation, and waiting for another operation.
    for mode in [
        "timeout-check",
        "timeout-mutation",
        "timeout-grandchild",
        "timeout-total",
    ] {
        scenario(mode);
        options.timeout = Duration::from_millis(350);
        let began = std::time::Instant::now();
        let err = DockerService::compose_create(&options).await.unwrap_err();
        assert!(err.contains("timeout"), "{mode}: {err}");
        assert!(began.elapsed() < Duration::from_secs(3));
        if let Ok(pid) = fs::read_to_string(dir.join("parent-pid")) {
            assert!(
                !PathBuf::from(format!("/proc/{}", pid.trim())).exists(),
                "Docker child was not reaped"
            );
            fs::remove_file(dir.join("parent-pid")).unwrap();
        }
        if let Ok(pid) = fs::read_to_string(dir.join("pid")) {
            assert_descendant_dead(pid.trim().parse().unwrap()).await;
            fs::remove_file(dir.join("pid")).unwrap();
        }
    }
    scenario("normal");
    options.timeout = Duration::from_secs(5);
    // Fake create leaves a marker: a concurrent second create must see the conflict.
    scenario("serialize");
    let (first, second) = tokio::join!(
        DockerService::compose_create(&options),
        DockerService::compose_create(&options)
    );
    assert_eq!(
        usize::from(first.is_ok()) + usize::from(second.is_ok()),
        1,
        "exactly one serialized create must succeed: {first:?}, {second:?}"
    );
    assert!(first.err().or(second.err()).unwrap().contains("conflict"));
    fs::remove_file(dir.join("created")).unwrap();
    scenario("timeout-check");
    let mut short = options.clone();
    short.timeout = Duration::from_millis(50);
    options.timeout = Duration::from_millis(400);
    let (first, second) = tokio::join!(
        DockerService::compose_create(&options),
        DockerService::compose_create(&short)
    );
    assert!(first.unwrap_err().contains("timeout"));
    assert!(second.unwrap_err().contains("timeout"));
}

/// Explicit opt-in: leaves two unique projects stopped, with their files and resources.
#[tokio::test]
#[ignore = "real daemon acceptance: KIDA_COMPOSE_REAL=1 cargo test -p kida-core compose_lifecycle_real -- --ignored --nocapture"]
async fn compose_lifecycle_real() {
    assert_eq!(
        std::env::var("KIDA_COMPOSE_REAL").as_deref(),
        Ok("1"),
        "set KIDA_COMPOSE_REAL=1 to authorize creating retained Docker resources"
    );
    let project = format!("kida-accept-{}", uuid::Uuid::new_v4().simple());
    let control = format!("{project}-control");
    let dir = std::env::temp_dir().join(&project);
    fs::create_dir_all(&dir).unwrap();
    let file = dir.join("compose.yaml");
    fs::write(&file, "services:\n  first:\n    image: busybox:1.37\n    command: ['sleep', '86400']\n    deploy:\n      replicas: 2\n    volumes: ['data:/data']\n  second:\n    image: busybox:1.37\n    command: ['sleep', '86400']\nvolumes:\n  data: {}\n").unwrap();
    eprintln!(
        "Retained acceptance projects: {project}, {control}; file: {}",
        file.display()
    );
    fs::write(
        dir.join("config.toml"),
        format!(
            "[docker]\nownership_dir = {:?}\n",
            dir.join("ownership").to_str().unwrap()
        ),
    )
    .unwrap();
    crate::infrastructure::conf::init(dir.join("config.toml")).unwrap();
    let options = ComposeOptions::new(&project, &file);
    let other = ComposeOptions::new(&control, &file);
    let test_options = options.clone();
    let test_other = other.clone();
    let result = tokio::spawn(async move {
        let options = test_options;
        let other = test_other;
        DockerService::compose_create(&other).await?;
        DockerService::compose_start(&other).await?;
        let control_before = real_snapshot(&control, true);
        DockerService::compose_create(&options).await?;
        let created = DockerService::compose_project(&project)?;
        assert_eq!(created.services.len(), 2);
        assert_eq!(
            created
                .services
                .iter()
                .map(|s| s.containers.len())
                .sum::<usize>(),
            3
        );
        assert!(
            created
                .services
                .iter()
                .flat_map(|s| &s.containers)
                .all(|c| !c.online)
        );
        let before = real_snapshot(&project, false);
        assert_eq!(before["networks"].as_array().unwrap().len(), 1);
        assert_eq!(before["volumes"].as_array().unwrap().len(), 1);
        eprintln!("Retained resources: {before}; control: {control_before}");
        DockerService::compose_start(&options).await?;
        let started = DockerService::compose_project(&project)?;
        assert!(
            started
                .services
                .iter()
                .flat_map(|s| &s.containers)
                .all(|c| c.online)
        );
        DockerService::compose_stop(&options).await?;
        let stopped = DockerService::compose_project(&project)?;
        assert!(
            stopped
                .services
                .iter()
                .flat_map(|s| &s.containers)
                .all(|c| !c.online)
        );
        assert_eq!(before, real_snapshot(&project, false));
        assert_eq!(control_before, real_snapshot(&control, true));
        Ok::<(), String>(())
    })
    .await;
    // The task boundary allows both projects to be stopped even if an assertion panics.
    let stopped_primary = DockerService::compose_stop(&options).await;
    let stopped_control = DockerService::compose_stop(&other).await;
    assert!(
        matches!(result, Ok(Ok(()))),
        "{result:?}; stop primary: {stopped_primary:?}; stop control: {stopped_control:?}"
    );
    stopped_primary.unwrap();
    stopped_control.unwrap();
}

fn real_snapshot(project: &str, include_state: bool) -> Value {
    let run = |args: &[&str]| {
        let out = Command::new("docker").args(args).output().unwrap();
        assert!(
            out.status.success(),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8(out.stdout).unwrap()
    };
    let filter = format!("label=com.docker.compose.project={project}");
    let containers: BTreeSet<_> = run(&["ps", "-aq", "--no-trunc", "--filter", &filter])
        .lines()
        .map(str::to_owned)
        .collect();
    let networks: BTreeSet<_> = run(&["network", "ls", "-q", "--filter", &filter])
        .lines()
        .map(str::to_owned)
        .collect();
    let volumes: BTreeSet<_> = run(&["volume", "ls", "-q", "--filter", &filter])
        .lines()
        .map(str::to_owned)
        .collect();
    // Control state is observed separately from stable resource identities.
    let states: Vec<Value> = containers
        .iter()
        .map(|id| {
            let raw: Vec<Value> = serde_json::from_str(&run(&["inspect", id])).unwrap();
            json!({"id": id, "labels": raw[0]["Config"]["Labels"], "state": if include_state { raw[0]["State"].clone() } else { Value::Null }})
        })
        .collect();
    json!({"containers": containers, "networks": networks, "volumes": volumes, "labels": states})
}

async fn ownership_checks(dir: &std::path::Path, options: &ComposeOptions) {
    let state_path = dir.join("state");
    let initial: Value = serde_json::from_slice(&fs::read(&state_path).unwrap()).unwrap();
    let reference = DockerService::compose_managed_project("alpha")
        .await
        .unwrap();
    let registry = dir
        .join("ownership")
        .join(format!("{}.json", reference.owner));
    let record_bytes = fs::read(&registry).unwrap();
    let mutate =
        |value: &Value| fs::write(&state_path, serde_json::to_vec(value).unwrap()).unwrap();
    let scenario = |mode| fs::write(dir.join("scenario"), mode).unwrap();
    let removals = || {
        fs::read_to_string(dir.join("calls"))
            .unwrap()
            .lines()
            .filter(|l| {
                let v: Value = serde_json::from_str(l).unwrap();
                v["args"][1] == "rm"
            })
            .count()
    };
    // Start and stop reuse both persisted files and refuse changed provenance.
    let source = fs::read(&options.file).unwrap();
    fs::write(&options.file, "changed").unwrap();
    assert!(
        DockerService::compose_start(options)
            .await
            .unwrap_err()
            .contains("provenance changed")
    );
    fs::write(&options.file, source).unwrap();
    DockerService::compose_start(options).await.unwrap();
    let before = removals();
    assert!(
        DockerService::compose_remove(&reference, Duration::from_secs(10))
            .await
            .unwrap_err()
            .contains("running")
    );
    assert_eq!(removals(), before);
    DockerService::compose_stop(options).await.unwrap();
    assert!(
        DockerService::compose_create(options)
            .await
            .unwrap_err()
            .contains("conflict")
    );
    for mode in ["different-daemon", "inventory-error"] {
        scenario(mode);
        assert!(
            DockerService::compose_remove(&reference, Duration::from_secs(10))
                .await
                .is_err()
        );
        assert_eq!(removals(), before);
    }
    scenario("normal");
    fs::write(&registry, "corrupt").unwrap();
    assert!(
        DockerService::compose_remove(&reference, Duration::from_secs(10))
            .await
            .is_err()
    );
    fs::write(&registry, &record_bytes).unwrap();
    // Every operation validates unrelated records and contradictory active references too.
    let unrelated = dir.join("ownership").join("unrelated.json");
    fs::write(&unrelated, "corrupt").unwrap();
    assert!(
        DockerService::compose_managed_project("unknown")
            .await
            .is_err()
    );
    assert!(DockerService::compose_start(options).await.is_err());
    fs::remove_file(&unrelated).unwrap();
    let mut duplicate: Value = serde_json::from_slice(&record_bytes).unwrap();
    let owner = uuid::Uuid::new_v4().to_string();
    duplicate["reference"]["owner"] = json!(owner);
    let duplicate_path = dir.join("ownership").join(format!("{owner}.json"));
    fs::write(&duplicate_path, serde_json::to_vec(&duplicate).unwrap()).unwrap();
    assert!(
        DockerService::compose_managed_project("alpha")
            .await
            .unwrap_err()
            .contains("conflicting")
    );
    assert!(
        DockerService::compose_remove(&reference, Duration::from_secs(10))
            .await
            .is_err()
    );
    assert_eq!(removals(), before);
    fs::remove_file(duplicate_path).unwrap();
    for change in ["copied", "volume-replaced", "labels", "incomplete"] {
        let mut state = initial.clone();
        match change {
            "copied" => {
                let mut copy = state["container"][0].clone();
                copy["Id"] = json!("b".repeat(64));
                state["container"].as_array_mut().unwrap().push(copy);
            }
            "volume-replaced" => state["volume"][0]["CreatedAt"] = json!("later"),
            "labels" => {
                state["container"][0]["Config"]["Labels"]["io.kida.owner"] = json!("foreign")
            }
            _ => {
                state["container"][0]
                    .as_object_mut()
                    .unwrap()
                    .remove("Mounts");
            }
        }
        mutate(&state);
        assert!(
            DockerService::compose_remove(&reference, Duration::from_secs(10))
                .await
                .is_err(),
            "{change}"
        );
        assert_eq!(removals(), before);
    }
    mutate(&initial);
    // A persisted pending creation never adopts an extra resource with copied labels.
    let mut pending: Value = serde_json::from_slice(&record_bytes).unwrap();
    pending["pending"] = json!(true);
    pending["resources"].as_array_mut().unwrap().remove(0);
    fs::write(&registry, serde_json::to_vec(&pending).unwrap()).unwrap();
    assert!(
        DockerService::compose_remove(&reference, Duration::from_secs(10))
            .await
            .unwrap_err()
            .contains("ambiguous")
    );
    assert_eq!(removals(), before);
    fs::write(&registry, &record_bytes).unwrap();
    // Foreign stopped containers retain both shared resources; bind/anonymous mounts remain untouched.
    let mut shared = initial.clone();
    shared["container"][0]["Mounts"]
        .as_array_mut()
        .unwrap()
        .extend([
            json!({"Type": "volume", "Name": "anonymous-unowned"}),
            json!({"Type": "bind", "Source": "/host/bind", "Destination": "/bind"}),
        ]);
    shared["volume"].as_array_mut().unwrap().push(json!({"Name": "anonymous-unowned", "Labels": {}, "CreatedAt": "today", "Driver": "local", "Scope": "local", "Options": null, "Mountpoint": "/var/lib/docker/volumes/anonymous-unowned/_data"}));
    let foreign = json!({"Id": "f".repeat(64), "Name": "foreign", "Config": {"Labels": {}}, "State": {"Running": false}, "Mounts": [{"Type": "volume", "Name": "alpha_data"}, {"Type": "bind", "Source": "/data", "Destination": "/bind"}], "NetworkSettings": {"Networks": {"alpha_default": {"NetworkID": ""}}}});
    shared["container"]
        .as_array_mut()
        .unwrap()
        .push(foreign.clone());
    mutate(&shared);
    let report = DockerService::compose_remove(&reference, Duration::from_secs(10))
        .await
        .unwrap();
    assert_eq!(report.removed.len(), 2);
    assert_eq!(report.preserved.len(), 5); // shared network/volume, external volume, anonymous and bind mounts
    let retained: Value = serde_json::from_slice(&fs::read(&state_path).unwrap()).unwrap();
    assert_eq!(retained["container"], json!([foreign]));
    let mut exclusive = retained.clone();
    exclusive["container"] = json!([]);
    mutate(&exclusive);
    // Failure after containers were removed persists progress, then a retry finishes.
    scenario("remove-error");
    let report = DockerService::compose_remove(&reference, Duration::from_secs(10))
        .await
        .unwrap();
    assert_eq!(report.failed.len(), 1);
    scenario("normal");
    let report = DockerService::compose_remove(&reference, Duration::from_secs(10))
        .await
        .unwrap();
    assert_eq!(report.removed.len(), 2);
    let before = removals();
    let report = DockerService::compose_remove(&reference, Duration::from_secs(10))
        .await
        .unwrap();
    assert!(report.removed.is_empty());
    assert_eq!(removals(), before);
    // A new creation under the same name does not grant an old reference any authority.
    fs::remove_file(&state_path).unwrap();
    DockerService::compose_create(options).await.unwrap();
    let newer = DockerService::compose_managed_project("alpha")
        .await
        .unwrap();
    assert_ne!(reference, newer);
    DockerService::compose_remove(&reference, Duration::from_secs(10))
        .await
        .unwrap();
    assert_eq!(removals(), before);
    // Unsupported storage is explicitly retained.
    let fresh: Value = serde_json::from_slice(&fs::read(&state_path).unwrap()).unwrap();
    let new_registry = dir.join("ownership").join(format!("{}.json", newer.owner));
    for (field, value) in [
        ("Driver", json!("remote")),
        ("Scope", json!("global")),
        ("Options", json!({"device": "/dev/sda"})),
    ] {
        let bytes = fs::read(&new_registry).unwrap();
        let mut record: Value = serde_json::from_slice(&bytes).unwrap();
        let mut state = fresh.clone();
        state["volume"][0][field] = value.clone();
        for resource in record["resources"].as_array_mut().unwrap() {
            if resource["kind"] == "volume" {
                resource["fingerprint"][field] = value.clone();
            }
        }
        fs::write(&new_registry, serde_json::to_vec(&record).unwrap()).unwrap();
        mutate(&state);
        let report = DockerService::compose_remove(&newer, Duration::from_secs(10))
            .await
            .unwrap();
        assert!(
            report
                .preserved
                .iter()
                .any(|r| r.reason.contains("unsupported")),
            "{field}: {report:?}"
        );
        fs::write(&new_registry, bytes).unwrap();
    }
    // Removal needs neither the source file nor a functioning Compose plugin.
    mutate(&fresh);
    let source = fs::read(&options.file).unwrap();
    fs::remove_file(&options.file).unwrap();
    scenario("plugin-missing");
    let output = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "features::docker::lifecycle_tests::ownership_child",
            "--ignored",
            "--nocapture",
        ])
        .env(
            "KIDA_OWNERSHIP_RELOAD",
            serde_json::to_string(&newer).unwrap(),
        )
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{} {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(String::from_utf8_lossy(&output.stdout).contains("1 passed"));
    fs::write(&options.file, source).unwrap();
    scenario("normal");
    fs::remove_file(&state_path).unwrap();
    scenario("partial-create");
    assert!(
        DockerService::compose_create(options)
            .await
            .unwrap_err()
            .contains("resources may be partial")
    );
    let partial = DockerService::compose_managed_project("alpha")
        .await
        .unwrap();
    let partial_path = dir
        .join("ownership")
        .join(format!("{}.json", partial.owner));
    let record: Value = serde_json::from_slice(&fs::read(&partial_path).unwrap()).unwrap();
    assert_eq!(record["pending"], true);
    assert_eq!(record["resources"].as_array().unwrap().len(), 4);
    scenario("normal");
    let report = DockerService::compose_remove(&partial, Duration::from_secs(10))
        .await
        .unwrap();
    assert_eq!(report.removed.len(), 4);
    fs::remove_file(&state_path).unwrap();
    scenario("capture-interrupted");
    assert!(DockerService::compose_create(options).await.is_err());
    let partial = DockerService::compose_managed_project("alpha")
        .await
        .unwrap();
    let partial_path = dir
        .join("ownership")
        .join(format!("{}.json", partial.owner));
    let record: Value = serde_json::from_slice(&fs::read(&partial_path).unwrap()).unwrap();
    assert_eq!(record["resources"].as_array().unwrap().len(), 1);
    scenario("normal");
    let before = removals();
    assert!(
        DockerService::compose_remove(&partial, Duration::from_secs(10))
            .await
            .unwrap_err()
            .contains("ambiguous")
    );
    assert_eq!(removals(), before);
    let calls = fs::read_to_string(dir.join("calls")).unwrap();
    for line in calls.lines() {
        let value: Value = serde_json::from_str(line).unwrap();
        let args = value["args"].as_array().unwrap();
        assert!(!args.iter().any(|a| {
            ["down", "prune", "--force", "-f", "-v", "disconnect"].contains(&a.as_str().unwrap())
        }));
    }
}

/// Independently authorized removal acceptance. Control resources are retained, stopped.
#[tokio::test]
#[ignore = "real removal acceptance: requires KIDA_DOCKER_REMOVE_REAL=1 and its exact test filter"]
async fn compose_remove_real() {
    assert_eq!(std::env::var("KIDA_DOCKER_REMOVE_REAL").as_deref(), Ok("1"));
    let project = format!("kida-remove-{}", uuid::Uuid::new_v4().simple());
    let control = format!("{project}-control");
    let dir = std::env::temp_dir().join(&project);
    fs::create_dir_all(&dir).unwrap();
    let file = dir.join("compose.yaml");
    fs::write(&file, "services:\n  app:\n    image: busybox:1.37\n    command: ['sleep', '86400']\n    volumes: ['data:/data']\nvolumes:\n  data: {}\n").unwrap();
    fs::write(
        dir.join("config.toml"),
        format!(
            "[docker]\nownership_dir = {:?}\n",
            dir.join("ownership").to_str().unwrap()
        ),
    )
    .unwrap();
    crate::infrastructure::conf::init(dir.join("config.toml")).unwrap();
    let options = ComposeOptions::new(&project, &file);
    let other = ComposeOptions::new(&control, &file);
    eprintln!(
        "Removal acceptance: {project}; retained stopped control: {control}; registry: {}",
        dir.display()
    );
    DockerService::compose_create(&other).await.unwrap();
    let control_before = real_snapshot(&control, true);
    DockerService::compose_create(&options).await.unwrap();
    let reference = DockerService::compose_managed_project(&project)
        .await
        .unwrap();
    let created = real_snapshot(&project, false);
    assert_eq!(created["containers"].as_array().unwrap().len(), 1);
    assert_eq!(created["networks"].as_array().unwrap().len(), 1);
    assert_eq!(created["volumes"].as_array().unwrap().len(), 1);
    fs::remove_file(&file).unwrap();
    let report = DockerService::compose_remove(&reference, Duration::from_secs(60))
        .await
        .unwrap();
    assert!(report.failed.is_empty(), "{report:?}");
    assert_eq!(report.removed.len(), 3, "{report:?}");
    let remaining = real_snapshot(&project, false);
    for kind in ["containers", "networks", "volumes"] {
        assert!(remaining[kind].as_array().unwrap().is_empty());
    }
    assert_eq!(control_before, real_snapshot(&control, true));
    let repeat = DockerService::compose_remove(&reference, Duration::from_secs(60))
        .await
        .unwrap();
    assert!(repeat.removed.is_empty());
    assert_eq!(repeat.absent.len(), 3);
}

#[test]
fn ownership_uuid_collisions_are_rejected() {
    let dir = std::env::temp_dir().join(format!("kida-collision-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&dir).unwrap();
    let owner = uuid::Uuid::new_v4().to_string();
    let (record, overlay) = super::repository::creation_paths(&dir, &owner).unwrap();
    fs::write(&record, "{}").unwrap();
    assert!(
        super::repository::creation_paths(&dir, &owner)
            .unwrap_err()
            .contains("UUID collision")
    );
    fs::remove_file(&record).unwrap();
    fs::write(&overlay, "{}").unwrap();
    assert!(
        super::repository::creation_paths(&dir, &owner)
            .unwrap_err()
            .contains("UUID collision")
    );
    fs::remove_dir_all(&dir).unwrap();
}

// Current-thread runtime deliberately proves that blocked disk work leaves Tokio responsive.
async fn concurrency_checks(dir: &std::path::Path) {
    use super::repository::test_io;
    fs::remove_dir_all(dir.join("ownership")).unwrap();
    fs::write(dir.join("scenario"), "concurrent").unwrap();
    let make = |project: &str| {
        let root = dir.join(project);
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("compose with spaces.yaml"), "services: {}\n").unwrap();
        let mut options = ComposeOptions::new(project, root.join("compose with spaces.yaml"));
        options
            .variables
            .insert("KIDA_TEST_PROJECT".into(), project.into());
        options
    };
    let a = make("alpha");
    let b = make("beta");
    let (started, release) = test_io::install("alpha", 0, false);
    let first_options = a.clone();
    let first = tokio::spawn(async move { DockerService::compose_create(&first_options).await });
    tokio::time::timeout(Duration::from_secs(10), started)
        .await
        .unwrap()
        .unwrap();
    // B completes even while A holds its lock in a blocked reservation save.
    tokio::time::timeout(Duration::from_secs(10), DockerService::compose_create(&b))
        .await
        .unwrap()
        .unwrap();
    let mut second = tokio::spawn(async move { DockerService::compose_create(&a).await });
    let mut query = tokio::spawn(DockerService::compose_managed_project("alpha"));
    tokio::task::yield_now().await;
    assert!(!first.is_finished());
    assert!(!second.is_finished());
    assert!(!query.is_finished());
    assert!(
        tokio::time::timeout(Duration::from_millis(20), &mut second)
            .await
            .is_err()
    );
    assert!(
        tokio::time::timeout(Duration::from_millis(20), &mut query)
            .await
            .is_err()
    );
    release.send(()).unwrap();
    first.await.unwrap().unwrap();
    assert!(second.await.unwrap().unwrap_err().contains("conflict"));
    query.await.unwrap().unwrap();

    // Cancellation drops the consumer, but not the guard owned by pending disk work.
    let (started, release) = test_io::install("alpha", 0, false);
    let reference = DockerService::compose_managed_project("alpha")
        .await
        .unwrap();
    let copy = reference.clone();
    let removal =
        tokio::spawn(
            async move { DockerService::compose_remove(&copy, Duration::from_secs(20)).await },
        );
    tokio::time::timeout(Duration::from_secs(10), started)
        .await
        .unwrap()
        .unwrap();
    removal.abort();
    assert!(removal.await.unwrap_err().is_cancelled());
    let retry = tokio::spawn(async move {
        DockerService::compose_remove(&reference, Duration::from_secs(20)).await
    });
    tokio::task::yield_now().await;
    assert!(!retry.is_finished());
    // A short-budget query must time out acquiring precisely this same project lock.
    let lock = super::lifecycle::project_lock("alpha");
    assert!(
        tokio::time::timeout(Duration::from_millis(20), lock.lock())
            .await
            .is_err()
    );
    release.send(()).unwrap();
    let report = retry.await.unwrap().unwrap();
    assert!(report.errors.is_empty(), "{report:?}");
    assert_eq!(report.absent.len(), 1);
    assert_eq!(report.removed.len(), 3);
}

async fn persistence_checks(dir: &std::path::Path, options: &ComposeOptions) {
    use super::repository::test_io;
    for mode in ["progress-failure", "final-failure", "timeout"] {
        fs::remove_dir_all(dir.join("ownership")).unwrap();
        let _ = fs::remove_file(dir.join("state"));
        fs::write(dir.join("scenario"), "normal").unwrap();
        DockerService::compose_create(options).await.unwrap();
        let reference = DockerService::compose_managed_project("alpha")
            .await
            .unwrap();
        let skip = if mode == "final-failure" { 4 } else { 0 };
        let (started, release) = test_io::install("alpha", skip, mode != "timeout");
        let copy = reference.clone();
        let budget = if mode == "timeout" {
            Duration::from_secs(3)
        } else {
            Duration::from_secs(20)
        };
        let entered = tokio::time::Instant::now();
        let removal =
            tokio::spawn(async move { DockerService::compose_remove(&copy, budget).await });
        tokio::time::timeout(Duration::from_secs(10), started)
            .await
            .unwrap()
            .unwrap();
        if mode == "timeout" {
            tokio::time::sleep_until(entered + budget + Duration::from_millis(20)).await;
            assert!(
                !removal.is_finished(),
                "must await the started save after expiry"
            );
        }
        let calls_before_release = fs::read(dir.join("calls")).unwrap();
        release.send(()).unwrap();
        let report = removal.await.unwrap().unwrap();
        assert_eq!(
            fs::read(dir.join("calls")).unwrap(),
            calls_before_release,
            "new Docker work after interrupted save"
        );
        assert_eq!(report.errors.len(), 1, "{mode}: {report:?}");
        assert!(report.failed.is_empty());
        assert_eq!(
            report.removed.len(),
            if mode == "final-failure" { 4 } else { 1 }
        );
        let state: Value = serde_json::from_slice(&fs::read(dir.join("state")).unwrap()).unwrap();
        assert_eq!(
            state["container"].as_array().unwrap().len(),
            if mode == "final-failure" { 0 } else { 1 }
        );
        if mode == "timeout" {
            assert!(report.errors[0].contains("timeout"));
        } else {
            assert!(report.errors[0].contains("injected save failure"));
        }
        if mode != "final-failure" {
            assert_eq!(
                report
                    .preserved
                    .iter()
                    .filter(|r| r.reason.contains("interruption"))
                    .count(),
                3
            );
        }
        let retry = DockerService::compose_remove(&reference, Duration::from_secs(20))
            .await
            .unwrap();
        assert!(retry.errors.is_empty(), "{retry:?}");
        assert!(retry.failed.is_empty());
        assert_eq!(
            retry.removed.len(),
            if mode == "final-failure" { 0 } else { 3 }
        );
        let path = dir
            .join("ownership")
            .join(format!("{}.json", reference.owner));
        let record: Value = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
        assert_eq!(record["completed"], true);
    }
    let old = json!({"removed": [], "absent": [], "preserved": [], "failed": []});
    let report: super::RemovalReport = serde_json::from_value(old).unwrap();
    assert!(report.errors.is_empty());
}
