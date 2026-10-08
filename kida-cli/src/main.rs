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

use crate::protocol::ResponseResult;

pub const DEFAULT_SOCKET_PATH: &str = "/tmp/kida.sock";

fn main() -> ExitCode {
    let request = CommandRequest::from(Cli::parse().command);
    let command = request.command.clone();

    let client = KidaClient::new(DEFAULT_SOCKET_PATH);

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
