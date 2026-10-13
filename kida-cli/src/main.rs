mod cli;
mod client;
mod input;
mod mapper;
mod protocol;
mod renderer;

use std::{
    io::{self, IsTerminal},
    process::ExitCode,
};

use clap::Parser;
use cli::Cli;
use client::{ClientError, KidaClient};
use protocol::{CommandRequest, CommandResponse, CommandStatus};

use crate::protocol::ResponseResult;

pub const DEFAULT_SOCKET_PATH: &str = "/tmp/kida.sock";

fn main() -> ExitCode {
    let command = Cli::parse().command;
    let stdin = io::stdin();
    let stderr = io::stderr();
    let client = KidaClient::new(DEFAULT_SOCKET_PATH);
    match send_command(
        command,
        stdin.is_terminal() && stderr.is_terminal(),
        &mut stdin.lock(),
        &mut stderr.lock(),
        &client,
    ) {
        Err(RunError::Input(error)) => {
            eprintln!("{error}");
            ExitCode::from(1)
        }
        Ok((command, response)) => {
            let result = handle_response(&command, &response);

            if let Some(output) = result.stdout {
                println!("{output}");
            }

            if let Some(error) = result.stderr {
                eprintln!("{error}");
            }

            result.exit_code
        }

        Err(RunError::Client(ClientError::AgentUnavailable)) => {
            eprintln!("KIDA agent is not running.");
            ExitCode::from(1)
        }

        Err(RunError::Client(ClientError::PermissionDenied)) => {
            eprintln!("Permission denied accessing KIDA agent.");
            ExitCode::from(2)
        }

        Err(RunError::Client(err)) => {
            eprintln!("Unable to communicate with KIDA: {err:?}");
            ExitCode::from(3)
        }
    }
}

#[derive(Debug)]
enum RunError {
    Input(input::error::InputError),
    Client(ClientError),
}

fn send_command(
    command: cli::Command,
    interactive: bool,
    reader: &mut impl io::BufRead,
    writer: &mut impl io::Write,
    client: &KidaClient,
) -> Result<(String, CommandResponse), RunError> {
    let prepared = input::prepare(command, interactive, reader, writer).map_err(RunError::Input)?;
    let request = CommandRequest::from(prepared);
    let response = client.send(&request).map_err(RunError::Client)?;
    Ok((request.command, response))
}

fn handle_response(command: &str, response: &CommandResponse) -> ResponseResult {
    match response.status {
        CommandStatus::Ok => match renderer::render(command, response) {
            Ok(output) => ResponseResult {
                stdout: Some(output),
                stderr: None,
                exit_code: ExitCode::SUCCESS,
            },

            Err(error) => ResponseResult {
                stdout: None,
                stderr: Some(format!("Unable to render KIDA response: {error}")),
                exit_code: ExitCode::from(3),
            },
        },

        CommandStatus::Error => ResponseResult {
            stdout: None,
            stderr: Some(
                response
                    .error
                    .clone()
                    .unwrap_or_else(|| "Command failed.".to_string()),
            ),
            exit_code: ExitCode::from(1),
        },
    }
}

#[cfg(test)]
mod acceptance_tests {
    use super::*;
    use std::{
        io::{BufRead, BufReader, Write},
        os::unix::net::UnixListener,
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
                assert_eq!(
                    request.params,
                    serde_json::from_str::<serde_json::Value>(include_str!(
                        "../../tests/fixtures/backup.json"
                    ))
                    .unwrap()
                );
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
