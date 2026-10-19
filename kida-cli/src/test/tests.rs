// Must implement module tests here! Do not implement tests inside source files!

#[test]
fn client_error_debug_preserves_variant_names_and_causes() {
    use crate::client::ClientError;

    let io_error = std::io::Error::other("connection failed");
    let json_error = || serde_json::from_str::<serde_json::Value>("invalid").unwrap_err();
    let cases = [
        (
            ClientError::AgentUnavailable,
            "AgentUnavailable".to_string(),
        ),
        (
            ClientError::PermissionDenied,
            "PermissionDenied".to_string(),
        ),
        (
            ClientError::Connection(std::io::Error::other("connection failed")),
            format!("Connection({io_error:?})"),
        ),
        (
            ClientError::Serialization(json_error()),
            format!("Serialization({:?})", json_error()),
        ),
        (
            ClientError::InvalidResponse(json_error()),
            format!("InvalidResponse({:?})", json_error()),
        ),
        (ClientError::EmptyResponse, "EmptyResponse".to_string()),
    ];
    for (error, expected) in cases {
        assert_eq!(format!("{error:?}"), expected);
    }

    assert_eq!(
        format!("{:#?}", ClientError::Connection(io_error)),
        "Connection(\n    Custom {\n        kind: Other,\n        error: \"connection failed\",\n    },\n)"
    );
}

#[cfg(test)]
mod power_tests {
    use crate::{
        cli::Cli,
        client::KidaClient,
        handle_response, input,
        protocol::command::{CommandRequest, CommandResponse, CommandStatus},
        send_command,
    };
    use clap::Parser;
    use serde_json::{Value, json};
    use std::{
        io::{BufRead, BufReader, Write},
        os::unix::net::UnixListener,
        process::ExitCode,
    };

    fn command(args: &[&str]) -> crate::cli::Command {
        Cli::try_parse_from(["kida", "system"].into_iter().chain(args.iter().copied()))
            .unwrap()
            .command
    }

    fn response(data: Value) -> CommandResponse {
        CommandResponse {
            id: "test".into(),
            status: CommandStatus::Ok,
            data: Some(data),
            error: None,
        }
    }

    #[test]
    fn flags_and_wizard_send_identical_payloads_and_render_over_socket() {
        for (index, args, script, expected, data, rendered) in [
            (
                0,
                vec!["powercicle", "--wake-time", "06:00"],
                "",
                json!({"wake_time":"06:00"}),
                json!({"wake_at":"2030-01-01T06:00:00+02:00","shutdown_scheduled":true,"s5_wake_status":"unverified"}),
                "RTC wake scheduled for 2030-01-01T06:00:00+02:00.",
            ),
            (
                1,
                vec!["powercicle"],
                "time\n06:00\n",
                json!({"wake_time":"06:00"}),
                json!({"wake_at":"2030-01-01T06:00:00+02:00","shutdown_scheduled":true,"s5_wake_status":"unverified"}),
                "Wake from S5 is unverified",
            ),
            (
                2,
                vec!["powercicle", "--wake-after-seconds", "120"],
                "",
                json!({"wake_after_seconds":120}),
                json!({"wake_at":"2030-01-01T06:00:00+02:00","shutdown_scheduled":true,"s5_wake_status":"unverified"}),
                "Shutdown scheduled in one minute.",
            ),
            (
                3,
                vec!["powercicle"],
                "after\n120\n",
                json!({"wake_after_seconds":120}),
                json!({"wake_at":"2030-01-01T06:00:00+02:00","shutdown_scheduled":true,"s5_wake_status":"unverified"}),
                "physical power-on is not guaranteed",
            ),
            (
                5,
                vec![
                    "powercicle",
                    "--shutdown-time",
                    "23:30",
                    "--wake-time",
                    "06:00",
                ],
                "",
                json!({"wake_time":"06:00","shutdown_time":"23:30"}),
                json!({"wake_at":"2030-01-02T06:00:00+02:00","shutdown_at":"2030-01-01T23:30:00+02:00","shutdown_scheduled":true,"s5_wake_status":"unverified"}),
                "Shutdown scheduled for 2030-01-01T23:30:00+02:00.",
            ),
            (
                6,
                vec![
                    "powercicle",
                    "--shutdown-time",
                    "23:30",
                    "--wake-after-seconds",
                    "28800",
                ],
                "",
                json!({"wake_after_seconds":28800,"shutdown_time":"23:30"}),
                json!({"wake_at":"2030-01-02T06:00:00+02:00","shutdown_at":"2030-01-01T23:30:00+02:00","shutdown_scheduled":true,"s5_wake_status":"unverified"}),
                "Shutdown scheduled for 2030-01-01T23:30:00+02:00.",
            ),
            (
                7,
                vec!["powercicle", "--shutdown-time", "23:30"],
                "time\n06:00\n",
                json!({"wake_time":"06:00","shutdown_time":"23:30"}),
                json!({"wake_at":"2030-01-02T06:00:00+02:00","shutdown_at":"2030-01-01T23:30:00+02:00","shutdown_scheduled":true,"s5_wake_status":"unverified"}),
                "Shutdown scheduled for 2030-01-01T23:30:00+02:00.",
            ),
            (
                4,
                vec!["wake-capabilities"],
                "",
                json!({}),
                json!({"rtc_device":null,"rtcwake_available":null,"rtc_alarm_available":false,"s5_wake_status":"unverified","warnings":["first","second"]}),
                "RTC device: Unknown\nrtcwake available: Unknown\nRTC alarm available: No\nWake from S5: Unverified\nWarning: first\nWarning: second",
            ),
        ] {
            let path = std::env::temp_dir()
                .join(format!("kida-power-{}-{index}.sock", std::process::id()));
            let listener = UnixListener::bind(&path).unwrap();
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
                    json!({"id":request.id,"status":"OK","data":data})
                )
                .unwrap();
                request
            });
            let mut prompts = Vec::new();
            let (id, response) = send_command(
                command(&args),
                !script.is_empty(),
                &mut script.as_bytes(),
                &mut prompts,
                &KidaClient::new(&path),
            )
            .unwrap();
            let result = handle_response(&id, &response);
            assert_eq!(result.exit_code, ExitCode::SUCCESS);
            assert!(result.stdout.unwrap().contains(rendered));
            let request = server.join().unwrap();
            assert_eq!(
                request.command,
                if index == 4 {
                    "system.wake_capabilities"
                } else {
                    "system.power_cycle"
                }
            );
            assert_eq!(request.params, expected);
            if script.is_empty() {
                assert!(prompts.is_empty());
            }
            std::fs::remove_file(path).unwrap();
        }
    }

    #[test]
    fn invalid_input_does_not_prompt_or_contact_core() {
        for args in [
            vec!["powercicle"],
            vec!["powercicle", "--wake-time", "24:00"],
            vec!["powercicle", "--wake-time", "06:60"],
            vec!["powercicle", "--wake-time", "6:00"],
            vec!["powercicle", "--wake-time", "é:00"],
            vec!["powercicle", "--wake-after-seconds", "119"],
            vec!["powercicle", "--wake-after-seconds", "0"],
            vec![
                "powercicle",
                "--shutdown-time",
                "now",
                "--wake-time",
                "06:00",
            ],
            vec![
                "powercicle",
                "--shutdown-time",
                "+15",
                "--wake-time",
                "06:00",
            ],
            vec![
                "powercicle",
                "--shutdown-time",
                "6:30",
                "--wake-time",
                "06:00",
            ],
            vec![
                "powercicle",
                "--shutdown-time",
                "24:00",
                "--wake-time",
                "06:00",
            ],
            vec![
                "powercicle",
                "--shutdown-time",
                "06:60",
                "--wake-time",
                "06:00",
            ],
            vec![
                "powercicle",
                "--shutdown-time",
                "é:00",
                "--wake-time",
                "06:00",
            ],
            vec!["powercicle", "--shutdown-time", "23:30"],
        ] {
            let mut prompts = Vec::new();
            let error = send_command(
                command(&args),
                false,
                &mut &b""[..],
                &mut prompts,
                &KidaClient::new("/nonexistent/kida-power.sock"),
            )
            .unwrap_err();
            assert!(matches!(error, crate::RunError::Input(_)));
            assert!(prompts.is_empty());
        }
        for args in [
            vec!["--wake-time", "06:00", "--wake-after-seconds", "120"],
            vec!["--wake-after-seconds", "-1"],
            vec!["--wake-after-seconds", "18446744073709551616"],
            vec!["--wake-time"],
        ] {
            assert!(
                Cli::try_parse_from(["kida", "system", "powercicle"].into_iter().chain(args))
                    .is_err()
            );
        }
    }

    #[test]
    fn wizard_retries_and_cancels_without_sending() {
        for (script, expected) in [
            (
                "invalid\ntime\n24:00\n06:60\n06:00\n",
                json!({"wake_time":"06:00"}),
            ),
            ("after\n-1\n119\n120\n", json!({"wake_after_seconds":120})),
        ] {
            let mut prompts = Vec::new();
            let prepared = input::prepare(
                command(&["powercicle"]),
                true,
                &mut script.as_bytes(),
                &mut prompts,
            )
            .unwrap();
            assert_eq!(CommandRequest::from(prepared).params, expected);
            assert!(String::from_utf8(prompts).unwrap().contains("try again"));
        }
        for script in [
            "",
            "time\n",
            "after\n",
            "time\n24:00\n",
            "\u{3}\n",
            "after\n\u{3}\n",
        ] {
            assert!(matches!(
                send_command(
                    command(&["powercicle"]),
                    true,
                    &mut script.as_bytes(),
                    &mut Vec::new(),
                    &KidaClient::new("/nonexistent/kida-power.sock")
                ),
                Err(crate::RunError::Input(_))
            ));
        }
    }

    #[test]
    fn renderers_reject_incompatible_responses_and_preserve_core_errors() {
        for (id, valid) in [
            (
                "system.power_cycle",
                json!({"wake_at":"2030-01-01T06:00:00+02:00","shutdown_scheduled":true,"s5_wake_status":"unverified"}),
            ),
            (
                "system.wake_capabilities",
                json!({"rtc_device":"rtc0","rtcwake_available":true,"rtc_alarm_available":true,"s5_wake_status":"unverified","warnings":[]}),
            ),
        ] {
            assert_eq!(
                handle_response(id, &response(valid.clone())).exit_code,
                ExitCode::SUCCESS
            );
            for key in valid.as_object().unwrap().keys() {
                for replacement in [None, Some(json!(42))] {
                    let mut malformed = valid.clone();
                    match replacement {
                        None => {
                            malformed.as_object_mut().unwrap().remove(key);
                        }
                        Some(value) => {
                            malformed[key] = value;
                        }
                    }
                    let result = handle_response(id, &response(malformed));
                    assert_eq!(result.exit_code, ExitCode::from(3), "{key}");
                    assert!(result.stdout.is_none());
                }
            }
            let mut unknown = valid.clone();
            unknown["s5_wake_status"] = json!("verified");
            assert_eq!(
                handle_response(id, &response(unknown)).exit_code,
                ExitCode::from(3)
            );
            let error = CommandResponse {
                id: "test".into(),
                status: CommandStatus::Error,
                data: None,
                error: Some("Shutdown failed; RTC alarm may remain active".into()),
            };
            let result = handle_response(id, &error);
            assert_eq!(result.stderr, error.error);
            assert_eq!(result.exit_code, ExitCode::from(1));
            assert!(result.stdout.is_none());
        }
        for (id, data) in [
            (
                "system.power_cycle",
                json!({"wake_at":"future","shutdown_scheduled":false,"s5_wake_status":"unverified"}),
            ),
            (
                "system.power_cycle",
                json!({"wake_at":"future","shutdown_at":null,"shutdown_scheduled":true,"s5_wake_status":"unverified"}),
            ),
            (
                "system.power_cycle",
                json!({"wake_at":"future","shutdown_at":42,"shutdown_scheduled":true,"s5_wake_status":"unverified"}),
            ),
            (
                "system.wake_capabilities",
                json!({"rtc_device":null,"rtcwake_available":false,"rtc_alarm_available":null,"s5_wake_status":"unverified","warnings":[42]}),
            ),
        ] {
            assert_eq!(
                handle_response(id, &response(data)).exit_code,
                ExitCode::from(3)
            );
        }
    }
}

#[cfg(test)]
mod acceptance_tests {
    use std::{
        io::{self, BufRead, BufReader, Write},
        os::unix::net::UnixListener,
        process::ExitCode,
    };

    use clap::Parser;

    use crate::{
        RunError,
        cli::{self, Cli},
        client::KidaClient,
        handle_response,
        protocol::command::{CommandRequest, CommandResponse, CommandStatus},
        send_command,
        test::handlers::backup_fixture,
    };

    fn command(args: &[&str]) -> cli::Command {
        Cli::try_parse_from(
            ["kida", "backup", "config", "create"]
                .into_iter()
                .chain(args.iter().copied()),
        )
        .unwrap()
        .command
    }

    fn listener() -> (std::path::PathBuf, UnixListener) {
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "kida-wire-{}-{}.sock",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        let listener = UnixListener::bind(&path).unwrap();
        (path, listener)
    }

    fn scheduler_command(args: &[&str]) -> cli::Command {
        Cli::try_parse_from(
            ["kida", "scheduler"]
                .into_iter()
                .chain(args.iter().copied()),
        )
        .unwrap()
        .command
    }

    #[test]
    fn scheduler_modes_send_identical_payloads_over_socket() {
        use serde_json::json;
        for (flags, table, script, schedule) in [
            (
                vec!["--at", "2030-01-01T12:00:00Z"],
                "type='once'\nat='2030-01-01T12:00:00Z'",
                "once\n2030-01-01T12:00:00Z\n",
                json!({"type":"once","at":"2030-01-01T12:00:00Z"}),
            ),
            (
                vec!["--seconds", "60"],
                "type='interval'\nseconds=60",
                "interval\n60\n",
                json!({"type":"interval","seconds":60}),
            ),
            (
                vec!["--cron", "30 2 * * *", "--timezone", "Europe/Madrid"],
                "type='cron'\nexpression='30 2 * * *'\ntimezone='Europe/Madrid'",
                "cron\n30 2 * * *\nEurope/Madrid\n",
                json!({"type":"cron","expression":"30 2 * * *","timezone":"Europe/Madrid"}),
            ),
        ] {
            for mode in 0..3 {
                let (path, listener) = listener();
                let file = path.with_extension("toml");
                std::fs::write(
                    &file,
                    format!("command='backup.run'\nparams='[null,true,3]'\n[schedule]\n{table}"),
                )
                .unwrap();
                let args = match mode {
                    0 => vec!["add", "--file", file.to_str().unwrap()],
                    1 => [
                        "add",
                        "--command",
                        "backup.run",
                        "--params",
                        "[null,true,3]",
                    ]
                    .into_iter()
                    .chain(flags.iter().copied())
                    .collect(),
                    _ => vec!["add"],
                };
                let server = std::thread::spawn(move || {
                    let (stream, _) = listener.accept().unwrap();
                    stream
                        .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                        .unwrap();
                    let mut reader = BufReader::new(stream);
                    let mut payload = String::new();
                    reader.read_line(&mut payload).unwrap();
                    let request: CommandRequest = serde_json::from_str(&payload).unwrap();
                    let mut data = request.params.clone();
                    data["id"] = json!("schedule-id");
                    data["origin"] = json!("USER");
                    writeln!(
                        reader.get_mut(),
                        "{}",
                        json!({"id":request.id,"status":"OK","data":data})
                    )
                    .unwrap();
                    request
                });
                let (command, response) = send_command(
                    scheduler_command(&args),
                    mode == 2,
                    &mut format!("backup.run\n[null,true,3]\n{script}").as_bytes(),
                    &mut Vec::new(),
                    &KidaClient::new(&path),
                )
                .unwrap();
                assert_eq!(
                    handle_response(&command, &response).stdout.as_deref(),
                    Some("Schedule added (ID: schedule-id).")
                );
                let request = server.join().unwrap();
                assert_eq!(request.command, "scheduler.add");
                assert_eq!(
                    request.params,
                    json!({"command":"backup.run","params":[null,true,3],"schedule":schedule})
                );
                std::fs::remove_file(path).unwrap();
                std::fs::remove_file(file).unwrap();
            }
        }
    }

    #[test]
    fn scheduler_local_errors_never_connect_or_fall_back_to_wizard() {
        let (path, listener) = listener();
        listener.set_nonblocking(true).unwrap();
        let file = path.with_extension("toml");
        std::fs::write(
            &file,
            "command='x'\nparams='null'\n[schedule]\ntype='interval'\nseconds=1\nextra=true",
        )
        .unwrap();
        let base = ["add", "--command", "backup.run", "--params", "null"];
        let mut cases = vec![
            vec!["add"],
            vec!["add", "--command", "x"],
            vec!["add", "--params", "null", "--seconds", "1"],
            vec!["add", "-f", "/missing/schedule.toml"],
            vec!["add", "-f", "file", "--seconds", "1"],
            vec!["add", "-f", file.to_str().unwrap()],
            vec!["add", "--command", "x", "--params", "{", "--seconds", "1"],
        ];
        for extra in [
            vec![],
            vec!["--timezone", "UTC"],
            vec!["--at", "future", "--seconds", "1"],
            vec!["--at", "future", "--cron", "* * * * *"],
            vec!["--seconds", "1", "--cron", "* * * * *"],
            vec!["--at", "future", "--timezone", "UTC"],
        ] {
            cases.push(base.into_iter().chain(extra).collect());
        }
        for args in cases {
            for interactive in [false, true] {
                let mut prompts = Vec::new();
                let result = send_command(
                    scheduler_command(&args),
                    interactive,
                    &mut &b""[..],
                    &mut prompts,
                    &KidaClient::new(&path),
                );
                assert!(
                    matches!(result, Err(RunError::Input(_))),
                    "{args:?}: {result:?}"
                );
                if args.len() > 1 || !interactive {
                    assert!(prompts.is_empty());
                }
                assert_eq!(
                    listener.accept().unwrap_err().kind(),
                    io::ErrorKind::WouldBlock
                );
            }
        }
        std::fs::remove_file(path).unwrap();
        std::fs::remove_file(file).unwrap();
    }

    #[test]
    fn scheduler_response_errors_keep_stdout_empty_and_exit_codes() {
        for command in ["scheduler.add", "scheduler.list", "scheduler.delete"] {
            let response = CommandResponse {
                id: "request".into(),
                status: CommandStatus::Error,
                data: None,
                error: Some("CORE rejected schedule".into()),
            };
            let result = handle_response(command, &response);
            assert!(result.stdout.is_none());
            assert_eq!(result.stderr.as_deref(), Some("CORE rejected schedule"));
            assert_eq!(result.exit_code, ExitCode::from(1));
            let result = handle_response(
                command,
                &CommandResponse {
                    status: CommandStatus::Ok,
                    error: None,
                    ..response
                },
            );
            assert!(result.stdout.is_none());
            assert!(result.stderr.unwrap().contains("Unable to render"));
            assert_eq!(result.exit_code, ExitCode::from(3));
        }
    }

    #[test]
    fn file_and_parameters_send_configuration_without_file_path() {
        let fixture =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/backup.toml");
        for args in [
            vec!["--file", fixture.to_str().unwrap()],
            vec![
                "--name",
                "test-backup",
                "--source",
                "./missing-source",
                "--target",
                "../missing-target",
            ],
            vec![],
        ] {
            let (path, listener) = listener();
            let server = std::thread::spawn(move || {
                let (stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                    .unwrap();
                let mut reader = BufReader::new(stream);
                let mut payload = String::new();
                reader.read_line(&mut payload).unwrap();
                let request: CommandRequest = serde_json::from_str(&payload).unwrap();
                writeln!(
                    reader.get_mut(),
                    "{}",
                    serde_json::json!({"id":request.id,"status":"OK","data":{}})
                )
                .unwrap();
                request
            });
            let script = "test-backup\n\n./missing-source\n\n../missing-target\n\n\n\n\n\n\n";
            send_command(
                command(&args),
                args.is_empty(),
                &mut script.as_bytes(),
                &mut Vec::new(),
                &KidaClient::new(&path),
            )
            .unwrap();
            let request = server.join().unwrap();
            assert_eq!(request.command, "backup.config.create");
            assert!(request.params.get("file").is_none());
            assert_eq!(request.params["compression"], "tar_zstd");
            if args.first() == Some(&"--file") {
                assert_eq!(request.params, backup_fixture());
            } else {
                assert_eq!(request.params["sources"][0], "./missing-source");
                assert_eq!(request.params["targets"][0]["path"], "../missing-target");
            }
            std::fs::remove_file(path).unwrap();
        }
    }

    #[test]
    fn local_errors_and_wizard_cancellation_never_connect() {
        let (path, listener) = listener();
        listener.set_nonblocking(true).unwrap();
        let base = [
            "--name", "daily", "--source", "source", "--target", "target",
        ];
        let mut cases = vec![
            vec!["--name", "daily"],
            vec!["-f", "/missing/kida.toml"],
            vec!["-f", "file", "--name", "daily"],
            vec![],
        ];
        for extra in [
            vec!["--compression", "zip"],
            vec!["--target-required", "0=yes"],
            vec!["--target-required", "2=true"],
            vec![
                "--target-required",
                "0=true",
                "--target-required",
                "0=false",
            ],
            vec!["--pre-backup-params", "0={}"],
            vec!["--schedule", "{"],
            vec!["--retention-keep-last", "4294967296"],
        ] {
            cases.push(base.into_iter().chain(extra).collect());
        }
        for args in cases {
            for interactive in [false, true] {
                let result = send_command(
                    command(&args),
                    interactive,
                    &mut &b""[..],
                    &mut Vec::new(),
                    &KidaClient::new(&path),
                );
                assert!(
                    matches!(result, Err(RunError::Input(_))),
                    "{args:?}: {result:?}"
                );
                assert_eq!(
                    listener.accept().unwrap_err().kind(),
                    io::ErrorKind::WouldBlock
                );
            }
        }
        std::fs::remove_file(path).unwrap();
    }
}
