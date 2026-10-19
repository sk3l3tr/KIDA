use clap::Parser;
use serde_json::{Value, json};
use std::{
    io::{BufRead, BufReader, Write},
    os::unix::net::UnixListener,
    process::ExitCode,
};

use crate::{
    cli::Cli,
    client::KidaClient,
    handle_response, input,
    protocol::command::{CommandRequest, CommandResponse},
    renderer, send_command,
};

use super::handlers::{RUN_ID, backup_health_fixture};

fn parse(args: &[&str]) -> Result<Cli, clap::Error> {
    Cli::try_parse_from(
        ["kida", "backup", "health"]
            .into_iter()
            .chain(args.iter().copied()),
    )
}

fn response(value: Value) -> CommandResponse {
    serde_json::from_value(json!({"id":"request", "status":"OK", "data":value})).unwrap()
}

fn cases() -> Vec<(Vec<&'static str>, &'static str, Value)> {
    vec![
        (
            vec![
                "create",
                "--file",
                "../missing/app.toml",
                "--mode",
                "manual",
            ],
            "create",
            json!({"definition_path":"../missing/app.toml", "mode":"MANUAL"}),
        ),
        (
            vec![
                "create",
                "--file",
                " /srv/missing.toml ",
                "--mode",
                "automatic",
            ],
            "create",
            json!({"definition_path":" /srv/missing.toml ", "mode":"AUTOMATIC"}),
        ),
        (
            vec!["run", "--file", "../missing/app.toml"],
            "run",
            json!({"definition_path":"../missing/app.toml"}),
        ),
        (
            vec!["start", "--run-id", RUN_ID],
            "start",
            json!({"run_id":RUN_ID}),
        ),
        (
            vec!["get", "--run-id", RUN_ID],
            "get",
            json!({"run_id":RUN_ID}),
        ),
        (
            vec!["stop", "--run-id", RUN_ID],
            "stop",
            json!({"run_id":RUN_ID}),
        ),
        (
            vec!["delete", "--run-id", RUN_ID],
            "delete",
            json!({"run_id":RUN_ID}),
        ),
        (vec!["list"], "list", json!({})),
        (vec!["report", "list"], "report.list", json!({})),
        (
            vec!["report", "get", "--run-id", RUN_ID],
            "report.get",
            json!({"run_id":RUN_ID}),
        ),
        (
            vec!["report", "delete", "--run-id", RUN_ID],
            "report.delete",
            json!({"run_id":RUN_ID}),
        ),
    ]
}

#[test]
fn all_commands_map_exactly_without_prompts_and_direct_mapping_is_blocked() {
    for (args, suffix, expected) in cases() {
        assert!(crate::mapper::direct(parse(&args).unwrap().command).is_err());
        for interactive in [false, true] {
            let mut prompts = Vec::new();
            let prepared = input::prepare(
                parse(&args).unwrap().command,
                interactive,
                &mut &b""[..],
                &mut prompts,
            )
            .unwrap();
            let request = CommandRequest::from(prepared);
            assert_eq!(request.command, format!("backup.health.{suffix}"));
            assert_eq!(request.params, expected);
            assert!(prompts.is_empty());
        }
    }
    for id in [
        "AABBCCDD1234456789AB0123456789AB",
        "{AABBCCDD-1234-4567-89AB-0123456789AB}",
    ] {
        let prepared = input::prepare(
            parse(&["get", "--run-id", id]).unwrap().command,
            false,
            &mut &b""[..],
            &mut Vec::new(),
        )
        .unwrap();
        assert_eq!(
            CommandRequest::from(prepared).params,
            json!({"run_id":RUN_ID})
        );
    }
}

#[test]
fn incomplete_flags_and_json_are_rejected_by_parser() {
    for args in [
        vec![],
        vec!["create"],
        vec!["create", "--file", "x"],
        vec!["create", "--mode", "manual"],
        vec!["run"],
        vec!["report"],
        vec!["list", "--json"],
    ] {
        assert!(parse(&args).is_err(), "{args:?}");
    }
    for (args, _, _) in cases() {
        let mut json_args = args.clone();
        json_args.push("--json");
        assert!(parse(&json_args).is_err());
        if args.contains(&"--run-id") {
            let index = args.iter().position(|arg| *arg == "--run-id").unwrap();
            assert!(parse(&args[..index]).is_err());
            assert!(parse(&args[..=index]).is_err());
        }
    }
}

#[test]
fn invalid_inputs_fail_before_transport_without_wizard() {
    let path =
        std::env::temp_dir().join(format!("kida-health-invalid-{}.sock", std::process::id()));
    let listener = UnixListener::bind(&path).unwrap();
    listener.set_nonblocking(true).unwrap();
    let mut invalid = vec![
        vec!["create", "--file", "x", "--mode", "AUTO"],
        vec!["create", "--file", "", "--mode", "manual"],
        vec!["run", "--file", "  "],
    ];
    for (mut args, _, _) in cases() {
        if args.contains(&"--run-id") {
            *args.last_mut().unwrap() = "invalid";
            invalid.push(args);
        }
    }
    for args in invalid {
        for interactive in [false, true] {
            let mut prompts = Vec::new();
            let error = send_command(
                parse(&args).unwrap().command,
                interactive,
                &mut &b""[..],
                &mut prompts,
                &KidaClient::new(&path),
            )
            .unwrap_err();
            assert!(matches!(error, crate::RunError::Input(_)), "{error:?}");
            assert!(prompts.is_empty());
            assert_eq!(
                listener.accept().unwrap_err().kind(),
                std::io::ErrorKind::WouldBlock
            );
        }
    }
    std::fs::remove_file(path).unwrap();
}

#[test]
fn server_paths_are_transmitted_intact_over_socket() {
    for (index, args) in [
        vec![
            "create",
            "--file",
            "../missing/health.toml",
            "--mode",
            "manual",
        ],
        vec![
            "run",
            "--file",
            "/nonexistent/kida-health-cli/definition.toml",
        ],
    ]
    .into_iter()
    .enumerate()
    {
        assert!(!std::path::Path::new(args[2]).exists());
        let path = std::env::temp_dir().join(format!(
            "kida-health-wire-{}-{index}.sock",
            std::process::id()
        ));
        let listener = UnixListener::bind(&path).unwrap();
        let value = backup_health_fixture()[if index == 0 { "created" } else { "queued" }].clone();
        let server = std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                .unwrap();
            let mut reader = BufReader::new(stream);
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            let request: CommandRequest = serde_json::from_str(&line).unwrap();
            writeln!(
                reader.get_mut(),
                "{}",
                json!({"id":request.id,"status":"OK","data":value})
            )
            .unwrap();
            request
        });
        let mut prompts = Vec::new();
        let (command, value) = send_command(
            parse(&args).unwrap().command,
            false,
            &mut &b""[..],
            &mut prompts,
            &KidaClient::new(&path),
        )
        .unwrap();
        assert_eq!(
            handle_response(&command, &value).exit_code,
            ExitCode::SUCCESS
        );
        assert_eq!(server.join().unwrap().params["definition_path"], args[2]);
        assert!(prompts.is_empty());
        std::fs::remove_file(path).unwrap();
    }
}

#[test]
fn render_all_operations_partial_snapshots_and_technical_results() {
    let fixtures = backup_health_fixture();
    for (suffix, value, expected) in [
        ("create", fixtures["created"].clone(), "state: CREATED"),
        (
            "start",
            fixtures["queued"].clone(),
            "Queue execution ID: queue-id",
        ),
        ("run", fixtures["queued"].clone(), "Run ID: aabbccdd"),
        ("get", fixtures["created"].clone(), "Artifact: not selected"),
        (
            "stop",
            fixtures["closed"].clone(),
            "Operational state: STOPPED",
        ),
        (
            "delete",
            fixtures["closed"].clone(),
            "Cleanup error: Docker unavailable",
        ),
        ("list", fixtures["listed"].clone(), "TECHNICAL RESULT"),
        ("list", json!([]), "No Backup Health executions found."),
        ("report.list", json!([RUN_ID]), RUN_ID),
        ("report.list", json!([]), "No Backup Health reports found."),
        ("report.get", fixtures["report"].clone(), "# Backup Health"),
        (
            "report.delete",
            fixtures["deleted"].clone(),
            "report deleted",
        ),
    ] {
        let rendered =
            renderer::render(&format!("backup.health.{suffix}"), &response(value)).unwrap();
        assert!(rendered.contains(expected), "{rendered}");
    }
    assert_eq!(
        renderer::render(
            "backup.health.report.get",
            &response(fixtures["report"].clone())
        )
        .unwrap(),
        fixtures["report"]["markdown"]
    );
    for result in ["FAILED", "UNHEALTHY", "UNKNOWN", "DEGRADED", "HEALTHY"] {
        let mut value = fixtures["closed"].clone();
        value["diagnosis"]["result"] = json!(result);
        let output = handle_response("backup.health.get", &response(value));
        assert_eq!(output.exit_code, ExitCode::SUCCESS);
        let text = output.stdout.unwrap();
        for expected in [
            result,
            "Restart recovered",
            "Safe log excerpt",
            "copy.tar.zst",
            "Cleanup: ERROR",
            "Report (CORE): /var/lib/kida",
        ] {
            assert!(text.contains(expected), "{text}");
        }
    }
}

#[test]
fn malformed_health_responses_never_fall_back_to_json() {
    let fixtures = backup_health_fixture();
    for (_, suffix, _) in cases() {
        let command = format!("backup.health.{suffix}");
        for value in [Value::Null, json!({}), json!(42), json!("bad")] {
            let result = handle_response(&command, &response(value));
            assert!(result.stdout.is_none(), "{command}");
            assert_eq!(result.exit_code, ExitCode::from(3));
        }
        let error = serde_json::from_value(
            json!({"id":"request","status":"ERROR","error":"CORE health error"}),
        )
        .unwrap();
        let result = handle_response(&command, &error);
        assert!(result.stdout.is_none());
        assert_eq!(result.stderr.as_deref(), Some("CORE health error"));
        assert_eq!(result.exit_code, ExitCode::from(1));
    }
    for value in [
        json!([{}]),
        json!([null]),
        json!([{"run_id":RUN_ID,"state":"STOPPED"}]),
    ] {
        assert!(renderer::render("backup.health.list", &response(value)).is_err());
    }
    for key in [
        "run_id",
        "definition",
        "mode",
        "state",
        "diagnosis",
        "created_at",
        "started_at",
        "finished_at",
        "artifact",
        "compose_path",
        "compose_checksum",
        "restore_dir",
        "cleanup",
        "report_path",
    ] {
        let mut value = fixtures["created"].clone();
        value.as_object_mut().unwrap().remove(key);
        for suffix in ["create", "get", "stop", "delete"] {
            assert!(
                renderer::render(&format!("backup.health.{suffix}"), &response(value.clone()))
                    .is_err(),
                "{key}"
            );
        }
    }
    for (pointer, bad) in [
        ("/state", json!("QUEUED")),
        ("/mode", json!("manual")),
        ("/diagnosis/result", json!("OK")),
        ("/cleanup/state", json!("DONE")),
        ("/diagnosis/complete", json!("true")),
        ("/diagnosis/anomalies", json!([42])),
        ("/diagnosis/evidence", json!([{}])),
        ("/artifact", json!({})),
        ("/run_id", json!("invalid")),
    ] {
        let mut value = fixtures["created"].clone();
        *value.pointer_mut(pointer).unwrap() = bad;
        assert!(
            renderer::render("backup.health.get", &response(value)).is_err(),
            "{pointer}"
        );
    }
    for (suffix, value) in [
        (
            "start",
            json!({"run_id":RUN_ID,"state":"CREATED","execution_id":"q"}),
        ),
        ("run", json!({"run_id":RUN_ID,"state":"STARTING"})),
        ("report.get", json!({"run_id":RUN_ID})),
        ("report.delete", json!({"run_id":RUN_ID,"deleted":false})),
        ("report.list", json!(["invalid"])),
    ] {
        assert!(renderer::render(&format!("backup.health.{suffix}"), &response(value)).is_err());
    }
}

#[test]
fn valid_health_input_preserves_transport_error() {
    let error = send_command(
        parse(&["list"]).unwrap().command,
        false,
        &mut &b""[..],
        &mut Vec::new(),
        &KidaClient::new("/nonexistent/kida-health-client.sock"),
    )
    .unwrap_err();
    assert!(matches!(
        error,
        crate::RunError::Client(crate::client::ClientError::AgentUnavailable)
    ));
}
