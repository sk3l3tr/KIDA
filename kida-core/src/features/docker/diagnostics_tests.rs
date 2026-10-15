//! All PATH changes are confined to a child test process.
use super::DockerService;
use serde_json::{Value, json};
use std::{fs, path::PathBuf, time::Duration};

const TIMEOUT: Duration = Duration::from_secs(5);
fn row(id: &str) -> Value {
    json!({"Id": id, "Name": "/test", "Config": {"Image": "example:tag", "Labels": {
        "com.docker.compose.project": "alpha", "com.docker.compose.service": "web"}},
        "State": {"Running": true, "Status": "running", "StartedAt": "2026-start",
            "FinishedAt": "0001-01-01T00:00:00Z", "ExitCode": 0}, "RestartCount": 0,
        "HostConfig": {"RestartPolicy": {"Name": "no"}},
        "NetworkSettings": {"Ports": {}, "Networks": {}}})
}

#[cfg(unix)]
#[test]
fn diagnostics_with_isolated_fake_docker() {
    use std::{os::unix::fs::PermissionsExt, process::Command};
    let dir = std::env::temp_dir().join(format!("kida-diagnostics-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("docker"), include_str!("diagnostics_fake.py")).unwrap();
    fs::set_permissions(dir.join("docker"), fs::Permissions::from_mode(0o755)).unwrap();
    let outputs = [
        "features::docker::diagnostics_tests::diagnostics_child",
        "features::docker::diagnostics_tests::diagnostics_drop_outside_runtime_child",
    ]
    .map(|test| {
        Command::new(std::env::current_exe().unwrap())
            .args(["--exact", test, "--ignored", "--nocapture"])
            .env("KIDA_DIAGNOSTICS_DIR", &dir)
            .env("PATH", &dir)
            .output()
            .unwrap()
    });
    fs::remove_dir_all(dir).unwrap();
    for output in outputs {
        assert!(
            output.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(String::from_utf8_lossy(&output.stdout).contains("1 passed"));
    }
}

#[cfg(unix)]
#[test]
#[ignore = "child process with isolated Docker PATH"]
fn diagnostics_drop_outside_runtime_child() {
    let dir = PathBuf::from(std::env::var_os("KIDA_DIAGNOSTICS_DIR").unwrap());
    if dir.join("pid").exists() {
        fs::remove_file(dir.join("pid")).unwrap();
    }
    fs::write(dir.join("case"), r#"{"sleep":true}"#).unwrap();
    fs::write(dir.join("calls"), "").unwrap();
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let mut query = Box::pin(DockerService::container_logs("test", 25, TIMEOUT));
    let pid = runtime.block_on(async {
        tokio::select! {
            result = &mut query => panic!("query completed before cancellation: {result:?}"),
            pid = tokio::time::timeout(TIMEOUT, async {
                loop {
                    if let Ok(pid) = fs::read_to_string(dir.join("pid")) {
                        if let Ok(pid) = pid.parse::<i32>() {
                            break pid;
                        }
                    }
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
            }) => pid.unwrap(),
        }
    });
    drop(query);
    runtime.block_on(async {
        tokio::time::timeout(TIMEOUT, async {
            // SAFETY: signal 0 only checks existence of the fixture process.
            while unsafe { libc::kill(pid, 0) } == 0 {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
    });
    assert_dead(&dir);
    assert_eq!(
        fs::read_to_string(dir.join("calls"))
            .unwrap()
            .lines()
            .count(),
        1
    );
}

#[cfg(unix)]
#[tokio::test]
#[ignore = "child process with isolated Docker PATH"]
async fn diagnostics_child() {
    let dir = PathBuf::from(std::env::var_os("KIDA_DIAGNOSTICS_DIR").unwrap());
    let case = |value: Value| fs::write(dir.join("case"), value.to_string()).unwrap();
    let a = "a".repeat(64);
    let b = "b".repeat(64);
    let c = "c".repeat(64);
    let d = "d".repeat(64);
    let inspect = || DockerService::inspect_container("test", TIMEOUT);
    for health in [None, Some("healthy"), Some("unhealthy"), Some("starting")] {
        let mut value = row(&a);
        if let Some(health) = health {
            value["State"]["Health"] = json!({"Status": health});
        }
        case(json!({"rows": {"test": [value]}}));
        let got = inspect().await.unwrap();
        assert_eq!(got.container.health.as_deref(), health);
        assert_eq!(got.container.started_at.as_deref(), Some("2026-start"));
        assert_eq!(
            got.container.finished_at.as_deref(),
            Some("0001-01-01T00:00:00Z")
        );
        assert_eq!(got.oom_killed, None);
        assert_eq!(got.docker_error, None);
    }
    let mut stopped = row(&a);
    stopped["State"]["Running"] = json!(false);
    stopped["State"]["Status"] = json!("exited");
    stopped["State"]["ExitCode"] = json!(137);
    stopped["RestartCount"] = json!(4);
    case(json!({"rows": {"test": [stopped]}}));
    assert_eq!(inspect().await.unwrap().oom_killed, None);
    stopped["State"]["OOMKilled"] = json!(true);
    stopped["State"]["Error"] = json!("runtime error");
    case(json!({"rows": {"test": [stopped]}}));
    let got = inspect().await.unwrap();
    assert!(!got.container.online);
    assert_eq!(got.container.exit_code, Some(137));
    assert_eq!(got.container.restart_count, 4);
    assert_eq!(got.oom_killed, Some(true));
    assert_eq!(got.docker_error.as_deref(), Some("runtime error"));
    for path in [
        "/Id",
        "/Name",
        "/Config/Image",
        "/State/Running",
        "/State/Status",
        "/State/StartedAt",
        "/State/FinishedAt",
        "/State/ExitCode",
        "/RestartCount",
        "/HostConfig/RestartPolicy/Name",
        "/NetworkSettings",
        "/NetworkSettings/Ports",
    ] {
        let mut value = row(&a);
        *value.pointer_mut(path).unwrap() = json!([]);
        case(json!({"rows": {"test": [value]}}));
        assert!(inspect().await.is_err(), "{path}");
    }
    for key in [
        "Id",
        "Name",
        "Config",
        "State",
        "RestartCount",
        "HostConfig",
        "NetworkSettings",
    ] {
        let mut value = row(&a);
        value.as_object_mut().unwrap().remove(key);
        case(json!({"rows": {"test": [value]}}));
        assert!(inspect().await.is_err(), "missing {key}");
    }
    for (key, field) in [
        ("Ports", json!({"80/tcp": "bad"})),
        ("Ports", json!({"bad": null})),
        (
            "Ports",
            json!({"80/tcp": [{"HostIp": 1, "HostPort": "80"}]}),
        ),
        ("Networks", json!({"default": false})),
        ("Networks", json!({"default": {"IPAddress": 1}})),
    ] {
        let mut value = row(&a);
        value["NetworkSettings"][key] = field;
        case(json!({"rows": {"test": [value]}}));
        assert!(inspect().await.is_err());
    }
    for (key, value) in [
        ("Health", json!({"Status": "bad"})),
        ("Health", Value::Null),
        ("OOMKilled", json!(0)),
        ("Error", json!(false)),
    ] {
        let mut item = row(&a);
        item["State"][key] = value;
        case(json!({"rows": {"test": [item]}}));
        assert!(inspect().await.is_err());
    }
    for value in [json!({}), json!({"Id": a}), json!([])] {
        case(json!({"rows": {"test": [value]}}));
        assert!(inspect().await.is_err());
    }
    case(json!({"invalid_json": true}));
    assert!(inspect().await.unwrap_err().contains("invalid output"));
    case(json!({"rows": {"test": [], "aaaa": [row(&a)], (a.clone()): [row(&a)]}}));
    assert!(inspect().await.is_err());
    assert!(
        DockerService::inspect_container("aaaa", TIMEOUT)
            .await
            .is_ok()
    );
    assert!(DockerService::inspect_container(&a, TIMEOUT).await.is_ok());
    let mut wrong = row(&a);
    wrong["Name"] = json!("/other");
    case(json!({"rows": {"test": [wrong]}}));
    assert!(inspect().await.unwrap_err().contains("identity mismatch"));

    // Multiple replicas, multiple services, and one container with no service label.
    let mut second = row(&b);
    second["Config"]["Labels"]["com.docker.compose.service"] = json!("db");
    let mut third = row(&c);
    third["Config"]["Labels"]
        .as_object_mut()
        .unwrap()
        .remove("com.docker.compose.service");
    case(
        json!({"ids": [a,b,c,d], "rows": {(a.clone()): [row(&a)], (b.clone()): [second],
        (c.clone()): [third], (d.clone()): [row(&d)]}}),
    );
    let got = DockerService::diagnose_compose_project("alpha", TIMEOUT)
        .await
        .unwrap();
    assert_eq!(got.containers.len(), 4);
    assert!(got.errors.is_empty());
    assert_eq!(got.containers[1].service.as_deref(), Some("db"));
    assert_eq!(got.containers[2].service, None);
    assert_eq!(got.containers[3].service.as_deref(), Some("web"));
    let mut wrong_project = row(&c);
    wrong_project["Config"]["Labels"]["com.docker.compose.project"] = json!("beta");
    for bad in [
        json!([]),
        json!([row(&a)]),
        json!([wrong_project]),
        json!([{}]),
    ] {
        case(
            json!({"ids": [a,b,c], "rows": {(a.clone()): [row(&a)], (b.clone()): [row(&b)], (c.clone()): bad}}),
        );
        let got = DockerService::diagnose_compose_project("alpha", TIMEOUT)
            .await
            .unwrap();
        assert_eq!(got.containers.len(), 2);
        assert_eq!(got.errors[0].id, c);
    }
    case(json!({"ids": [a,b], "rows": {(a.clone()): [row(&a)]}, "fail_ids": [b]}));
    let got = DockerService::diagnose_compose_project("alpha", TIMEOUT)
        .await
        .unwrap();
    assert_eq!(got.containers.len(), 1);
    assert_eq!(got.errors[0].id, b);
    case(json!({}));
    let got = DockerService::diagnose_compose_project("alpha", TIMEOUT)
        .await
        .unwrap();
    assert!(got.containers.is_empty() && got.errors.is_empty());
    case(json!({"fail": true}));
    assert!(
        DockerService::diagnose_compose_project("alpha", TIMEOUT)
            .await
            .is_err()
    );
    case(json!({"ids": ["short"]}));
    assert!(
        DockerService::diagnose_compose_project("alpha", TIMEOUT)
            .await
            .is_err()
    );

    // The second inspect exhausts the shared budget; the third must never start.
    case(json!({"ids": [a,b,c], "rows": {(a.clone()): [row(&a)]}, "slow_id": b}));
    fs::write(dir.join("calls"), "").unwrap();
    let got = DockerService::diagnose_compose_project("alpha", Duration::from_millis(400))
        .await
        .unwrap();
    assert_eq!(got.containers.len(), 1);
    assert_eq!(got.errors.len(), 2);
    assert_eq!(got.errors[1].id, c);
    let calls = fs::read_to_string(dir.join("calls")).unwrap();
    assert!(!calls.contains(&c));

    for (out, err) in [(0, 0), (10, 20), (1024 * 1024, 1024 * 1024)] {
        case(json!({"stdout": out, "stderr": err}));
        let got = DockerService::container_logs("test", 25, TIMEOUT)
            .await
            .unwrap();
        assert_eq!(got.stdout, vec![255; out]);
        assert_eq!(got.stderr, vec![254; err]);
        assert_eq!(got.container, "test");
        assert_eq!(got.tail, 25);
        assert!(got.warning.contains("sensitive"));
    }
    for channel in ["stdout", "stderr"] {
        case(json!({(channel): 1024*1024+1}));
        let error = DockerService::container_logs("test", 25, TIMEOUT)
            .await
            .unwrap_err();
        assert!(error.contains(&format!("{channel} exceeds 1048576 byte limit")));
    }
    case(json!({"fail": true}));
    let error = DockerService::container_logs("test", 25, TIMEOUT)
        .await
        .unwrap_err();
    assert!(error.contains("command failed") && !error.contains("SECRET"));
    // Input validation must not invoke Docker.
    fs::write(dir.join("calls"), "").unwrap();
    for name in ["", "--help", " test", "test\0"] {
        assert!(
            DockerService::inspect_container(name, TIMEOUT)
                .await
                .is_err()
        );
        assert!(
            DockerService::container_logs(name, 25, TIMEOUT)
                .await
                .is_err()
        );
    }
    for tail in [0, 10001] {
        assert!(
            DockerService::container_logs("test", tail, TIMEOUT)
                .await
                .is_err()
        );
    }
    assert!(
        DockerService::container_logs("test", 25, Duration::ZERO)
            .await
            .is_err()
    );
    assert!(
        DockerService::inspect_container("test", Duration::ZERO)
            .await
            .is_err()
    );
    assert!(
        DockerService::diagnose_compose_project("Alpha", TIMEOUT)
            .await
            .is_err()
    );
    assert_eq!(fs::read_to_string(dir.join("calls")).unwrap(), "");
    case(json!({"sleep": true}));
    assert!(
        DockerService::container_logs("test", 25, Duration::from_millis(200))
            .await
            .unwrap_err()
            .contains("timeout")
    );
    assert_dead(&dir);
    fs::remove_file(dir.join("pid")).unwrap();
    let task = tokio::spawn(DockerService::container_logs("test", 25, TIMEOUT));
    for _ in 0..100 {
        if dir.join("pid").exists() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert!(dir.join("pid").exists());
    task.abort();
    let _ = task.await;
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_dead(&dir);
}

#[cfg(unix)]
fn assert_dead(dir: &std::path::Path) {
    let pid: i32 = fs::read_to_string(dir.join("pid"))
        .unwrap()
        .parse()
        .unwrap();
    // SAFETY: signal 0 only checks existence of the fixture process.
    assert_eq!(unsafe { libc::kill(pid, 0) }, -1);
}

#[tokio::test]
#[ignore = "real daemon acceptance: KIDA_DOCKER_DIAGNOSTICS_REAL=1 and exact test filter required"]
async fn diagnostics_real() {
    use std::process::Command;
    assert_eq!(
        std::env::var("KIDA_DOCKER_DIAGNOSTICS_REAL").as_deref(),
        Ok("1")
    );
    struct TestContainers(Vec<String>);
    impl Drop for TestContainers {
        fn drop(&mut self) {
            for id in &self.0 {
                let output = Command::new("docker")
                    .args(["container", "rm", "--force", id])
                    .output()
                    .unwrap();
                assert!(output.status.success(), "test container cleanup failed");
            }
        }
    }
    fn docker(args: &[&str]) -> String {
        let output = Command::new("docker").args(args).output().unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout).unwrap().trim().into()
    }
    let project = format!("kida-diagnostics-{}", uuid::Uuid::new_v4());
    let label = format!("com.docker.compose.project={project}");
    let mut containers = TestContainers(vec![]);
    let id = docker(&[
        "container",
        "create",
        "--pull",
        "never",
        "--name",
        &project,
        "--network",
        "none",
        "--label",
        &label,
        "--label",
        "com.docker.compose.service=probe",
        "busybox:1.37",
        "sh",
        "-c",
        "printf diagnostics-out; printf diagnostics-err >&2; exit 7",
    ]);
    containers.0.push(id.clone());
    let got = DockerService::inspect_container(&id, TIMEOUT)
        .await
        .unwrap();
    assert_eq!(got.container.status, "created");
    assert_eq!(got.container.health, None);
    docker(&["container", "start", &id]);
    assert_eq!(docker(&["container", "wait", &id]), "7");
    let got = DockerService::inspect_container(&project, TIMEOUT)
        .await
        .unwrap();
    assert!(!got.container.online);
    assert_eq!(got.container.exit_code, Some(7));
    assert_eq!(got.oom_killed, Some(false));
    assert_eq!(got.docker_error.as_deref(), Some(""));
    let logs = DockerService::container_logs(&id, 25, TIMEOUT)
        .await
        .unwrap();
    assert_eq!(logs.stdout, b"diagnostics-out");
    assert_eq!(logs.stderr, b"diagnostics-err");
    let got = DockerService::diagnose_compose_project(&project, TIMEOUT)
        .await
        .unwrap();
    assert!(got.errors.is_empty());
    assert_eq!(got.containers.len(), 1);
    assert_eq!(got.containers[0].service.as_deref(), Some("probe"));
    assert_eq!(got.containers[0].diagnostics.container.id, id);
    drop(containers);
    let got = DockerService::diagnose_compose_project(&project, TIMEOUT)
        .await
        .unwrap();
    assert!(got.containers.is_empty() && got.errors.is_empty());
}
