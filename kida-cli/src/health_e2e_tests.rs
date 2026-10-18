//! CLI pipeline against the live CORE fixture, orchestrated by tests/backup-health/run.py.
use clap::Parser;
use serde_json::Value;
use std::{
    path::PathBuf,
    process::ExitCode,
    time::{Duration, Instant},
};

use crate::{cli::Cli, client::KidaClient, handle_response, send_command};

fn invoke(args: &[&str]) -> Value {
    let socket = PathBuf::from(std::env::var_os("KIDA_HEALTH_E2E_SOCKET").unwrap());
    assert_ne!(socket, PathBuf::from(crate::DEFAULT_SOCKET_PATH));
    let command = Cli::try_parse_from(
        ["kida", "backup", "health"]
            .into_iter()
            .chain(args.iter().copied()),
    )
    .unwrap()
    .command;
    let mut prompts = Vec::new();
    let (command, response) = send_command(
        command,
        false,
        &mut &b""[..],
        &mut prompts,
        &KidaClient::new(socket),
    )
    .unwrap();
    let result = handle_response(&command, &response);
    assert_eq!(result.exit_code, ExitCode::SUCCESS, "{:?}", result.stderr);
    assert!(result.stderr.is_none());
    assert!(!result.stdout.unwrap().is_empty());
    assert!(prompts.is_empty());
    response.data.unwrap()
}

fn wait(run_id: &str, final_state: bool) -> Value {
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        let value = invoke(&["get", "--run-id", run_id]);
        if value["diagnosis"]["complete"] == true
            && (!final_state || value["state"] == "STOPPED" || value["state"] == "ERROR")
        {
            return value;
        }
        assert!(Instant::now() < deadline, "CLI diagnosis deadline: {value}");
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[test]
#[ignore = "live CORE fixture; run python3 tests/backup-health/run.py --simulated or --real"]
fn against_core() {
    let definition = std::env::var("KIDA_HEALTH_E2E_DEFINITION").unwrap();
    for mode in ["manual", "automatic"] {
        let created = invoke(&["create", "--file", &definition, "--mode", mode]);
        let run_id = created["run_id"].as_str().unwrap();
        assert_eq!(created["state"], "CREATED");
        let queued = invoke(&["start", "--run-id", run_id]);
        assert_ne!(queued["execution_id"], run_id);
        let value = wait(run_id, mode == "automatic");
        assert_eq!(value["diagnosis"]["result"], "HEALTHY", "{value}");
        if mode == "manual" {
            assert_eq!(value["state"], "RUNNING");
            assert_eq!(invoke(&["stop", "--run-id", run_id])["state"], "STOPPED");
        }
        assert_eq!(
            invoke(&["delete", "--run-id", run_id])["cleanup"]["state"],
            "COMPLETED"
        );
        let listed = invoke(&["list"]);
        assert!(
            listed
                .as_array()
                .unwrap()
                .iter()
                .any(|row| row["run_id"] == run_id)
        );
        assert!(
            invoke(&["report", "list"])
                .as_array()
                .unwrap()
                .iter()
                .any(|id| id == run_id)
        );
        assert!(
            invoke(&["report", "get", "--run-id", run_id])["markdown"]
                .as_str()
                .unwrap()
                .starts_with('#')
        );
        assert_eq!(
            invoke(&["report", "delete", "--run-id", run_id])["deleted"],
            true
        );
        assert!(
            !invoke(&["report", "list"])
                .as_array()
                .unwrap()
                .iter()
                .any(|id| id == run_id)
        );
    }
    let queued = invoke(&["run", "--file", &definition]);
    let run_id = queued["run_id"].as_str().unwrap();
    assert_ne!(queued["execution_id"], run_id);
    assert_eq!(wait(run_id, true)["cleanup"]["state"], "COMPLETED");
}
