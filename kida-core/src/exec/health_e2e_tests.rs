//! Test-only CORE process used by transport/CLI acceptance; no production entrypoints.
use std::{fs, path::PathBuf, process::Command, time::Duration};

use chrono::{DateTime, Utc};
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, BufReader};

use super::{executor, worker};
use crate::{
    conf,
    features::{
        backup::health::{maintenance, service},
        scheduler::runtime,
    },
    infrastructure::comm::transport::{http::HttpServer, unix::UnixSocketServer},
};

#[test]
fn simulated_transports_and_lifecycle() {
    let output = Command::new("python3")
        .arg(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../tests/backup-health/run.py"
        ))
        .arg("--core-test-bin")
        .arg(std::env::current_exe().unwrap())
        .arg("--simulated")
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(String::from_utf8_lossy(&output.stdout).contains("HEALTH E2E PASS"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "fixture process; invoked by tests/backup-health/run.py"]
async fn server() {
    assert_eq!(std::env::var("KIDA_HEALTH_E2E_CHILD").as_deref(), Ok("1"));
    let root = PathBuf::from(std::env::var_os("KIDA_HEALTH_E2E_ROOT").unwrap());
    assert!(root.is_absolute());
    if std::env::var("KIDA_HEALTH_E2E_REAL").as_deref() == Ok("1") {
        let host = std::env::var("KIDA_E2E_DOCKER_HOST").unwrap();
        assert_eq!(std::env::var("DOCKER_HOST").unwrap(), host);
        assert!(host.starts_with("unix:///"));
        let output = Command::new("docker")
            .args(["info", "--format", "{{.ID}}"])
            .output()
            .unwrap();
        assert!(output.status.success());
        assert_eq!(
            String::from_utf8(output.stdout).unwrap().trim(),
            std::env::var("KIDA_E2E_DAEMON_ID").unwrap()
        );
    }
    conf::init(root.join("config.toml")).unwrap();
    let config = conf::get().unwrap();
    let receiver = executor::init_queue().unwrap();
    runtime::init(executor::command_queue().unwrap()).unwrap();
    let service = service::get_service().await.unwrap();
    let gate_root = root.clone();
    tokio::spawn(worker::run_with_context(
        receiver,
        move |request, context, execution_id| {
            let root = gate_root.clone();
            async move {
                if root.join("paused").exists() {
                    fs::write(root.join("worker-entered"), b"entered").unwrap();
                    while root.join("paused").exists() {
                        tokio::time::sleep(Duration::from_millis(10)).await;
                    }
                }
                executor::execute_queued(request, context, execution_id).await
            }
        },
        config.queue.max_concurrent_jobs,
        config.queue.capacity + config.queue.max_concurrent_jobs,
    ));
    let unix = UnixSocketServer::new(&config.unix.socket_path);
    let http = HttpServer::new(&config.http.host, config.http.port);
    let unix_task = tokio::spawn(async move { unix.start().await });
    let http_task = tokio::spawn(async move { http.start().await });
    fs::write(
        root.join("ready.json"),
        serde_json::to_vec(&json!({"ready":true})).unwrap(),
    )
    .unwrap();

    // Private fixture controls use stdin, never either public transport.
    let mut lines = BufReader::new(tokio::io::stdin()).lines();
    while let Some(line) = lines.next_line().await.unwrap() {
        let control: Value = serde_json::from_str(&line).unwrap();
        let operation = control["operation"].as_str().unwrap();
        let now = control
            .get("now")
            .and_then(Value::as_str)
            .map(|text| {
                DateTime::parse_from_rfc3339(text)
                    .unwrap()
                    .with_timezone(&Utc)
            })
            .unwrap_or_else(Utc::now);
        let value = match operation {
            "expire" => {
                serde_json::to_value(maintenance::expire(service, now).await.unwrap()).unwrap()
            }
            "retain" => {
                serde_json::to_value(maintenance::retain(service, now).await.unwrap()).unwrap()
            }
            "tick" => {
                runtime::manager().unwrap().enqueue_due().unwrap();
                json!({})
            }
            "fill" => {
                let queue = executor::command_queue().unwrap();
                let mut count = 0;
                loop {
                    let request = crate::infrastructure::comm::protocol::CommandRequest {
                        id: "fixture-fill".into(),
                        command: "system.info".into(),
                        params: json!({}),
                    };
                    match queue.enqueue(request) {
                        Ok(_) => count += 1,
                        Err(super::queue::QueueError::Full) => break,
                        Err(error) => panic!("queue unexpectedly closed: {error:?}"),
                    }
                }
                json!({"enqueued":count})
            }
            "shutdown" => break,
            other => panic!("unknown fixture control: {other}"),
        };
        // Atomic rename prevents the driver reading an incomplete acknowledgement.
        let temp = root.join("control.tmp");
        fs::write(
            &temp,
            serde_json::to_vec(&json!({"id":control["id"],"data":value})).unwrap(),
        )
        .unwrap();
        fs::rename(temp, root.join("control.json")).unwrap();
    }
    unix_task.abort();
    http_task.abort();
}
