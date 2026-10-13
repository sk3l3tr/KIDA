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
