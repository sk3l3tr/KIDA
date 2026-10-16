use super::*;
use serde_json::json;
use std::{fs, path::PathBuf, process::Command, time::Duration};

fn request(command: &str) -> CommandRequest {
    CommandRequest {
        id: "blocking-test".into(),
        command: command.into(),
        params: json!({"when":"+1"}),
    }
}

#[tokio::test]
async fn blocking_task_panics_return_protocol_errors() {
    let response = run_blocking(request("test.panic"), |_| panic!("injected failure")).await;
    assert_eq!(response.id, "blocking-test");
    assert!(matches!(response.status, CommandStatus::Error));
    assert!(response.data.is_none());
    let error = response.error.unwrap();
    assert!(
        error.starts_with("Command task failed for test.panic:"),
        "{error}"
    );
    assert!(error.contains("injected failure"), "{error}");
}

#[tokio::test]
async fn cancelling_waiter_does_not_stop_started_blocking_work() {
    let (started, running) = tokio::sync::oneshot::channel();
    let (release, gate) = std::sync::mpsc::channel();
    let (finished, done) = tokio::sync::oneshot::channel();
    let waiter = tokio::spawn(run_blocking(request("test.wait"), move |request| {
        started.send(()).unwrap();
        gate.recv_timeout(Duration::from_secs(5)).unwrap();
        finished.send(()).unwrap();
        CommandResponse {
            id: request.id,
            status: CommandStatus::Ok,
            data: None,
            error: None,
        }
    }));
    tokio::time::timeout(Duration::from_secs(5), running)
        .await
        .unwrap()
        .unwrap();
    waiter.abort();
    assert!(waiter.await.unwrap_err().is_cancelled());
    release.send(()).unwrap();
    tokio::time::timeout(Duration::from_secs(5), done)
        .await
        .unwrap()
        .unwrap();
}

#[cfg(unix)]
fn isolated_command(command: &str) {
    use std::os::unix::fs::PermissionsExt;
    let directory = std::env::temp_dir().join(format!("kida-blocking-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&directory).unwrap();
    for executable in ["docker", "shutdown"] {
        let path = directory.join(executable);
        fs::write(&path, include_str!("fake_blocking_command.py")).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
    }
    // A closed PATH ensures a broken fixture can never fall through to real power tools.
    let output = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "exec::commands::tests::slow_command_child",
            "--ignored",
            "--nocapture",
        ])
        .env("PATH", &directory)
        .env("KIDA_BLOCKING_DIR", &directory)
        .env("KIDA_BLOCKING_COMMAND", command)
        .output()
        .unwrap();
    fs::remove_dir_all(&directory).unwrap();
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(output.status.success(), "{command}: {stdout}\n{stderr}");
    assert!(stdout.contains("1 passed"), "child did not run: {stdout}");
}

#[cfg(unix)]
#[test]
fn slow_docker_command_yields_runtime() {
    isolated_command("docker.compose.version");
}

#[cfg(unix)]
#[test]
fn slow_shutdown_command_yields_runtime() {
    isolated_command("system.shutdown");
}

#[cfg(unix)]
#[test]
fn slow_reboot_command_yields_runtime() {
    isolated_command("system.reboot");
}

#[cfg(unix)]
#[tokio::test(flavor = "current_thread")]
#[ignore = "child with closed PATH containing only fake commands"]
async fn slow_command_child() {
    let directory = PathBuf::from(std::env::var_os("KIDA_BLOCKING_DIR").unwrap());
    let command = std::env::var("KIDA_BLOCKING_COMMAND").unwrap();
    let mut input = request(&command);
    input.params = if command.starts_with("docker.") {
        json!({})
    } else {
        json!({"when":"invalid"})
    };
    if !command.starts_with("docker.") {
        let invalid = crate::exec::executor::execute(input).await;
        assert!(matches!(invalid.status, CommandStatus::Error));
        assert!(
            !directory.join("started").exists(),
            "invalid power request ran a process"
        );
    }
    let input = request(&command);
    let task = tokio::spawn(crate::exec::executor::execute(input));
    // The fake process waits for this async task; its own deadline prevents deadlock
    // when a regression blocks this single runtime thread.
    tokio::time::timeout(Duration::from_secs(5), async {
        while !directory.join("started").exists() {
            tokio::time::sleep(Duration::from_millis(1)).await;
        }
    })
    .await
    .unwrap();
    assert!(
        !task.is_finished(),
        "runtime did not progress until the process had finished"
    );
    fs::write(directory.join("release"), "continue").unwrap();
    let response = tokio::time::timeout(Duration::from_secs(5), task)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(response.id, "blocking-test");
    assert!(
        matches!(response.status, CommandStatus::Ok),
        "{:?}",
        response.error
    );
    assert!(response.error.is_none());
    let expected = if command.starts_with("docker.") {
        json!({"version":"2.99.0"})
    } else {
        json!({"scheduled":true,"when":"+1"})
    };
    assert_eq!(response.data, Some(expected));
}
