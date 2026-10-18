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
pub(crate) mod tests;

#[cfg(test)]
mod contract_tests;

#[cfg(test)]
mod health_tests;

#[cfg(test)]
mod health_e2e_tests;
