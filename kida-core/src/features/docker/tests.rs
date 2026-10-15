// Keep Docker tests here; no real Docker daemon is required.
use serde_json::{Value, json};

use super::{DockerService, service::map_compose_projects};

#[test]
fn validates_lifecycle_project_identifiers_without_normalizing() {
    for name in ["a", "0", "alpha", "backup-004", "1_restore", "a_-9"] {
        assert!(
            DockerService::validate_compose_project_name(name).is_ok(),
            "valid identifier rejected: {name:?}"
        );
    }

    for name in [
        "",
        " ",
        " alpha",
        "alpha ",
        "alpha beta",
        "Alpha",
        "ALPHA",
        "a/b",
        "-alpha",
        "_alpha",
        "a.b",
        "a\n",
        "a\0b",
        "á",
        "aβ",
    ] {
        assert_eq!(
            DockerService::validate_compose_project_name(name).unwrap_err(),
            "Invalid Compose project identifier: expected [a-z0-9][a-z0-9_-]*",
            "invalid identifier accepted: {name:?}"
        );
    }
}

fn inspected() -> Vec<Value> {
    vec![
        json!({
            "Id": "web-2", "Name": "/alpha-web-2",
            "Config": {"Image": "nginx", "Labels": {
                "com.docker.compose.project": "alpha",
                "com.docker.compose.service": "web"
            }},
            "State": {"Running": false, "Status": "exited", "ExitCode": 3,
                "StartedAt": "start", "FinishedAt": "finish"},
            "RestartCount": 2,
            "HostConfig": {"RestartPolicy": {"Name": "unless-stopped"}},
            "NetworkSettings": {
                "Ports": {"80/tcp": [{"HostIp": "127.0.0.1", "HostPort": "8080"}]},
                "Networks": {"alpha_default": {"IPAddress": "172.18.0.2"}}
            }
        }),
        json!({
            "Id": "web-1", "Name": "/alpha-web-1",
            "Config": {"Image": "nginx", "Labels": {
                "com.docker.compose.project": "alpha",
                "com.docker.compose.service": "web"
            }},
            "State": {"Running": true, "Status": "running", "Health": {"Status": "healthy"}}
        }),
        json!({"Id": "unknown-service", "Config": {"Labels": {
            "com.docker.compose.project": "alpha"
        }}}),
        json!({"Id": "beta-db", "Config": {"Labels": {
            "com.docker.compose.project": "beta", "com.docker.compose.service": "db"
        }}, "State": {"Running": false, "Status": "paused"}}),
        json!({"Id": "standalone", "Config": {"Labels": null}}),
    ]
}

#[test]
fn groups_projects_services_and_replicas_preserving_container_details() {
    let projects = map_compose_projects(&inspected());
    assert_eq!(projects.len(), 2);
    assert_eq!(projects[0].name, "alpha");
    assert_eq!(projects[1].name, "beta");
    assert_eq!(projects[0].services.len(), 2);
    assert_eq!(projects[0].services[0].name, None);
    assert_eq!(projects[0].services[0].containers[0].id, "unknown-service");
    let web = &projects[0].services[1];
    assert_eq!(web.name.as_deref(), Some("web"));
    assert_eq!(web.containers.len(), 2);
    assert_eq!(web.containers[0].id, "web-1");
    assert!(web.containers[0].online);
    assert_eq!(web.containers[0].health.as_deref(), Some("healthy"));
    assert_eq!(
        serde_json::to_value(&web.containers[1]).unwrap(),
        json!({
            "id": "web-2", "name": "alpha-web-2", "image": "nginx",
            "online": false, "status": "exited", "health": null,
            "started_at": "start", "finished_at": "finish", "exit_code": 3,
            "restart_count": 2, "restart_policy": "unless-stopped",
            "ports": [{"container_port": 80, "protocol": "tcp", "host_ip": "127.0.0.1", "host_port": "8080"}],
            "networks": [{"name": "alpha_default", "ip_address": "172.18.0.2", "gateway": null, "mac_address": null}]
        })
    );
    assert_eq!(projects[1].services[0].containers[0].status, "paused");
    let mut reversed = inspected();
    reversed.reverse();
    assert_eq!(
        serde_json::to_value(projects).unwrap(),
        serde_json::to_value(map_compose_projects(&reversed)).unwrap()
    );
}

#[test]
fn missing_or_empty_project_labels_do_not_create_projects() {
    assert!(map_compose_projects(&[]).is_empty());
    assert!(
        map_compose_projects(&[
            json!({}),
            json!({"Config": {"Labels": {"com.docker.compose.project": " "}}}),
            json!({"Config": {"Labels": {"com.docker.compose.project": 123}}}),
        ])
        .is_empty()
    );
    let projects = map_compose_projects(&[json!({"Config": {"Labels": {
        "com.docker.compose.project": "alpha", "com.docker.compose.service": ""
    }}})]);
    assert_eq!(projects[0].services[0].name, None);
}

// Run command tests in a subprocess: PATH remains untouched in the parent test suite.
#[cfg(unix)]
#[test]
fn compose_commands_with_isolated_fake_docker() {
    use std::{fs, os::unix::fs::PermissionsExt, process::Command};
    let dir = std::env::temp_dir().join(format!("kida-compose-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&dir).unwrap();
    let containers = inspected();
    // The fixture contains three alpha containers, then beta, then standalone.
    for (file, subset) in [
        ("inspect.json", containers.as_slice()),
        ("inspect-compose.json", &containers[..4]),
        ("inspect-alpha.json", &containers[..3]),
    ] {
        fs::write(dir.join(file), serde_json::to_vec(subset).unwrap()).unwrap();
    }
    fs::write(dir.join("mode"), "normal").unwrap();
    let docker = dir.join("docker");
    fs::write(&docker, r#"#!/bin/sh
printf '%s\n' "$*" >> "$KIDA_COMPOSE_TEST_DIR/calls"
mode=$(cat "$KIDA_COMPOSE_TEST_DIR/mode")
case "$mode:$1" in
  version-error:compose) echo 'compose plugin unavailable' >&2; exit 1 ;;
  empty-version:compose) exit 0 ;;
  invalid-version:compose) printf '\377'; exit 0 ;;
  ps-error:ps) echo 'daemon unavailable' >&2; exit 1 ;;
  inspect-error:inspect) echo 'container disappeared' >&2; exit 1 ;;
  invalid-json:inspect) echo 'invalid'; exit 0 ;;
esac
case "$*" in
  'compose version --short') echo '2.40.0' ;;
  'ps -aq'|'ps -aq --filter label=com.docker.compose.project'|'ps -aq --filter label=com.docker.compose.project=alpha')
    if [ "$mode" = empty ]; then exit 0; fi
    case "$*" in
      'ps -aq') printf 'web-2\nweb-1\nunknown-service\nbeta-db\nstandalone\n' ;;
      'ps -aq --filter label=com.docker.compose.project') printf 'web-2\nweb-1\nunknown-service\nbeta-db\n' ;;
      'ps -aq --filter label=com.docker.compose.project=alpha') printf 'web-2\nweb-1\nunknown-service\n' ;;
    esac
    ;;
  'ps -aq --filter label=com.docker.compose.project=missing') exit 0 ;;
  'inspect web-2 web-1 unknown-service beta-db standalone') cat "$KIDA_COMPOSE_TEST_DIR/inspect.json" ;;
  'inspect web-2 web-1 unknown-service beta-db') cat "$KIDA_COMPOSE_TEST_DIR/inspect-compose.json" ;;
  'inspect web-2 web-1 unknown-service') cat "$KIDA_COMPOSE_TEST_DIR/inspect-alpha.json" ;;
  'start old-container'|'stop old-container'|'restart old-container'|'rm old-container') exit 0 ;;
  *) echo "Unexpected docker arguments: $*" >&2; exit 1 ;;
esac
"#).unwrap();
    fs::set_permissions(&docker, fs::Permissions::from_mode(0o755)).unwrap();
    let mut paths = vec![dir.clone()];
    paths.extend(std::env::split_paths(
        &std::env::var_os("PATH").unwrap_or_default(),
    ));
    let output = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "features::docker::tests::compose_commands_child",
            "--ignored",
            "--nocapture",
        ])
        .env("PATH", std::env::join_paths(paths).unwrap())
        .env("KIDA_COMPOSE_TEST_DIR", &dir)
        .output()
        .unwrap();
    let missing = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "features::docker::tests::compose_commands_child",
            "--ignored",
            "--nocapture",
        ])
        .env("PATH", dir.join("no-docker"))
        .env("KIDA_COMPOSE_TEST_DIR", &dir)
        .env("KIDA_COMPOSE_TEST_MISSING", "1")
        .output()
        .unwrap();
    fs::remove_dir_all(&dir).unwrap();
    assert!(
        missing.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&missing.stdout),
        String::from_utf8_lossy(&missing.stderr)
    );
    assert!(String::from_utf8_lossy(&missing.stdout).contains("1 passed"));
    assert!(
        output.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(String::from_utf8_lossy(&output.stdout).contains("1 passed"));
}

#[cfg(unix)]
#[test]
#[ignore = "executed by compose_commands_with_isolated_fake_docker with an isolated PATH"]
fn compose_commands_child() {
    use crate::{
        exec::executor,
        infrastructure::comm::protocol::{CommandRequest, CommandStatus},
    };
    use std::fs;
    let dir = std::path::PathBuf::from(std::env::var_os("KIDA_COMPOSE_TEST_DIR").unwrap());
    if std::env::var_os("KIDA_COMPOSE_TEST_MISSING").is_some() {
        assert!(
            DockerService::compose_version()
                .unwrap_err()
                .contains("Cannot execute docker compose version")
        );
        assert!(
            DockerService::compose_projects()
                .unwrap_err()
                .contains("Cannot execute docker ps")
        );
        return;
    }
    let mode = |name| fs::write(dir.join("mode"), name).unwrap();
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let request = |command: &str, params| {
        runtime.block_on(executor::execute(CommandRequest {
            id: "compose-request".into(),
            command: command.into(),
            params,
        }))
    };
    for command in [
        "docker.compose.version",
        "docker.compose.projects.list",
        "docker.compose.project.inspect",
    ] {
        assert!(executor::is_registered(command));
    }
    let response = request("docker.compose.version", json!({}));
    assert!(matches!(response.status, CommandStatus::Ok));
    assert_eq!(response.id, "compose-request");
    assert!(response.error.is_none());
    assert_eq!(response.data.unwrap(), json!({"version": "2.40.0"}));
    let response = request("docker.compose.projects.list", json!({}));
    assert!(matches!(response.status, CommandStatus::Ok));
    assert_eq!(response.data.unwrap().as_array().unwrap().len(), 2);
    let response = request(
        "docker.compose.project.inspect",
        json!({"project": " alpha "}),
    );
    assert!(matches!(response.status, CommandStatus::Ok));
    let project = response.data.unwrap();
    assert_eq!(project["name"], "alpha");
    let container_ids: Vec<_> = project["services"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|service| service["containers"].as_array().unwrap())
        .map(|container| container["id"].as_str().unwrap())
        .collect();
    assert_eq!(container_ids, ["unknown-service", "web-1", "web-2"]);
    assert_eq!(
        fs::read_to_string(dir.join("calls"))
            .unwrap()
            .lines()
            .collect::<Vec<_>>(),
        [
            "compose version --short",
            "ps -aq --filter label=com.docker.compose.project",
            "inspect web-2 web-1 unknown-service beta-db",
            "ps -aq --filter label=com.docker.compose.project=alpha",
            "inspect web-2 web-1 unknown-service",
        ]
    );
    let response = request("docker.containers.list", json!({}));
    assert!(matches!(response.status, CommandStatus::Ok));
    let listed = response.data.unwrap();
    assert_eq!(listed["total"], 5);
    assert_eq!(listed["running"], 1);
    assert_eq!(listed["containers"][0]["id"], "web-2");
    assert!(listed["containers"][0].get("compose").is_none());
    for (command, status) in [
        ("start", "running"),
        ("stop", "stopped"),
        ("restart", "restarted"),
        ("delete", "deleted"),
    ] {
        let response = request(
            &format!("docker.container.{command}"),
            json!({"container": "old-container"}),
        );
        assert!(matches!(response.status, CommandStatus::Ok));
        assert_eq!(
            response.data.as_ref().unwrap()["container"],
            "old-container"
        );
        assert_eq!(response.data.unwrap()["status"], status);
    }
    let calls_before = fs::read_to_string(dir.join("calls")).unwrap();
    for params in [
        json!(null),
        json!({}),
        json!({"project": " "}),
        json!({"project": 3}),
    ] {
        let response = request("docker.compose.project.inspect", params);
        assert!(matches!(response.status, CommandStatus::Error));
        assert!(response.data.is_none());
        assert_eq!(
            response.error.as_deref(),
            Some("Missing required parameter: project")
        );
    }
    assert!(DockerService::compose_project(" ").is_err());
    assert_eq!(fs::read_to_string(dir.join("calls")).unwrap(), calls_before);
    let response = request(
        "docker.compose.project.inspect",
        json!({"project": "missing"}),
    );
    assert!(matches!(response.status, CommandStatus::Error));
    assert_eq!(
        response.error.as_deref(),
        Some("Compose project 'missing' not found")
    );
    for (scenario, expected) in [
        ("version-error", "compose plugin unavailable"),
        ("empty-version", "empty version"),
        ("invalid-version", "Invalid docker compose version output"),
    ] {
        mode(scenario);
        let response = request("docker.compose.version", json!({}));
        assert!(matches!(response.status, CommandStatus::Error));
        assert!(response.data.is_none());
        assert!(response.error.unwrap().contains(expected));
        // Inventory queries only need Docker, even if the Compose plugin is absent.
        assert_eq!(DockerService::compose_projects().unwrap().len(), 2);
    }
    for (scenario, expected) in [
        ("ps-error", "daemon unavailable"),
        ("inspect-error", "container disappeared"),
        ("invalid-json", "Cannot parse docker inspect output"),
    ] {
        mode(scenario);
        for (command, params) in [
            ("docker.compose.projects.list", json!({})),
            (
                "docker.compose.project.inspect",
                json!({"project": "alpha"}),
            ),
            ("docker.containers.list", json!({})),
        ] {
            let response = request(command, params);
            assert!(matches!(response.status, CommandStatus::Error));
            assert!(response.data.is_none());
            assert!(response.error.unwrap().contains(expected));
        }
    }
    mode("empty");
    fs::write(dir.join("calls"), "").unwrap();
    assert!(DockerService::compose_projects().unwrap().is_empty());
    assert!(DockerService::list().unwrap().containers.is_empty());
    assert!(
        DockerService::compose_project("alpha")
            .unwrap_err()
            .contains("not found")
    );
    let calls = fs::read_to_string(dir.join("calls")).unwrap();
    assert_eq!(
        calls.lines().collect::<Vec<_>>(),
        [
            "ps -aq --filter label=com.docker.compose.project",
            "ps -aq",
            "ps -aq --filter label=com.docker.compose.project=alpha",
        ]
    );
}
