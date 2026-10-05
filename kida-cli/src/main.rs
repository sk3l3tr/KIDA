mod cli;
mod client;
mod mapper;
mod protocol;
mod renderer;

use std::process::ExitCode;

use clap::Parser;
use cli::Cli;
use client::{ClientError, KidaClient};
use protocol::{CommandRequest, CommandResponse, CommandStatus};

fn main() -> ExitCode {
    let request = CommandRequest::from(Cli::parse().command);
    let command = request.command.clone();

    let client = KidaClient::default();

    match client.send(&request) {
        Ok(response) => {
            let result = handle_response(&command, &response);

            if let Some(output) = result.stdout {
                println!("{output}");
            }

            if let Some(error) = result.stderr {
                eprintln!("{error}");
            }

            result.exit_code
        }

        Err(ClientError::AgentUnavailable) => {
            eprintln!("KIDA agent is not running.");
            ExitCode::from(1)
        }

        Err(ClientError::PermissionDenied) => {
            eprintln!("Permission denied accessing KIDA agent.");
            ExitCode::from(2)
        }

        Err(err) => {
            eprintln!("Unable to communicate with KIDA: {err:?}");
            ExitCode::from(3)
        }
    }
}

struct ResponseResult {
    stdout: Option<String>,
    stderr: Option<String>,
    exit_code: ExitCode,
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
mod tests {
    use serde_json::json;

    use super::*;

    fn response(status: CommandStatus, data: Option<serde_json::Value>) -> CommandResponse {
        CommandResponse {
            id: "1".into(),
            status,
            data,
            error: None,
        }
    }

    #[test]
    fn core_errors_keep_the_existing_error_flow() {
        let mut response = response(CommandStatus::Error, None);
        response.error = Some("Docker failed".into());

        let result = handle_response("docker.containers.list", &response);

        assert_eq!(result.stdout, None);
        assert_eq!(result.stderr.as_deref(), Some("Docker failed"));
        assert_eq!(result.exit_code, ExitCode::from(1));
    }

    #[test]
    fn renderer_errors_use_exit_code_three_and_no_stdout() {
        let response = response(CommandStatus::Ok, Some(json!({"scheduled": false})));

        let result = handle_response("system.shutdown", &response);

        assert_eq!(result.stdout, None);
        assert!(
            result
                .stderr
                .as_deref()
                .is_some_and(|error| error.starts_with("Unable to render KIDA response: "))
        );
        assert_eq!(result.exit_code, ExitCode::from(3));
    }
}
