use std::{fs, path::PathBuf, process::Command};

use serde_json::{Value, json};

use crate::{exec::executor, infrastructure::comm::protocol::CommandRequest};

const ACTIONS: [(&str, &str, &str); 4] = [
    ("start", "start", "running"),
    ("stop", "stop", "stopped"),
    ("restart", "restart", "restarted"),
    ("delete", "rm", "deleted"),
];

#[test]
fn container_actions_with_isolated_docker() {
    use std::os::unix::fs::PermissionsExt;

    let directory = std::env::temp_dir().join(format!("kida-actions-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&directory).unwrap();
    let docker = directory.join("docker");
    fs::write(
        &docker,
        r#"#!/bin/sh
printf '%s\n' "$@" >> "$KIDA_ACTION_TEST_DIR/calls"
if [ "$#" -ne 2 ]; then
    echo 'Unexpected argument count' >&2
    exit 1
fi
case "$1" in
    start|stop|restart|rm) ;;
    *) echo 'Unexpected action' >&2; exit 1 ;;
esac
case "$2" in
    'container with spaces') exit 0 ;;
    fail) echo '  injected Docker failure  ' >&2; exit 1 ;;
    *) echo 'Unexpected container' >&2; exit 1 ;;
esac
"#,
    )
    .unwrap();
    fs::set_permissions(docker, fs::Permissions::from_mode(0o755)).unwrap();
    let output = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "exec::commands::docker::tests::container_actions_child",
            "--ignored",
            "--nocapture",
        ])
        .env("PATH", &directory)
        .env("KIDA_ACTION_TEST_DIR", &directory)
        .output()
        .unwrap();
    fs::remove_dir_all(directory).unwrap();
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(output.status.success(), "{stdout}\n{stderr}");
    assert!(stdout.contains("1 passed"), "child did not run: {stdout}");
}

async fn response(action: &str, params: Value) -> Value {
    serde_json::to_value(
        executor::execute(CommandRequest {
            id: format!("request-{action}"),
            command: format!("docker.container.{action}"),
            params,
        })
        .await,
    )
    .unwrap()
}

#[tokio::test(flavor = "current_thread")]
#[ignore = "executed by container_actions_with_isolated_docker with a closed PATH"]
async fn container_actions_child() {
    let directory = PathBuf::from(std::env::var_os("KIDA_ACTION_TEST_DIR").unwrap());
    let calls = directory.join("calls");
    for (action, operation, status) in ACTIONS {
        for params in [
            json!({}),
            Value::Null,
            json!({"container": null}),
            json!({"container": 42}),
            json!({"container": false}),
            json!({"container": []}),
            json!({"container": {}}),
            json!({"container": ""}),
            json!({"container": " \t\n "}),
        ] {
            assert_eq!(
                response(action, params).await,
                json!({
                    "id": format!("request-{action}"),
                    "status": "ERROR",
                    "error": "Missing required parameter: container",
                })
            );
            assert!(!calls.exists(), "validation invoked Docker");
        }
        assert_eq!(
            response(action, json!({"container": " \tcontainer with spaces\n "})).await,
            json!({
                "id": format!("request-{action}"),
                "status": "OK",
                "data": {"container": "container with spaces", "status": status},
            })
        );
        assert_eq!(
            fs::read_to_string(&calls).unwrap(),
            format!("{operation}\ncontainer with spaces\n")
        );
        fs::remove_file(&calls).unwrap();

        assert_eq!(
            response(action, json!({"container": " fail "})).await,
            json!({
                "id": format!("request-{action}"),
                "status": "ERROR",
                "error": format!("docker {operation} failed for 'fail': injected Docker failure"),
            })
        );
        assert_eq!(
            fs::read_to_string(&calls).unwrap(),
            format!("{operation}\nfail\n")
        );
        fs::remove_file(&calls).unwrap();
    }
}
