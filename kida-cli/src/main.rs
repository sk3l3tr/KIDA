mod cli;
mod client;
mod mapper;
mod protocol;

use std::process::ExitCode;

use clap::Parser;
use cli::Cli;
use client::{ClientError, KidaClient};
use protocol::{CommandRequest, CommandResponse, CommandStatus};

fn main() -> ExitCode {
    let request = CommandRequest::from(Cli::parse().command);

    let client = KidaClient::default();

    match client.send(&request) {
        Ok(response) => handle_response(response),

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

fn handle_response(response: CommandResponse) -> ExitCode {
    match response.status {
        CommandStatus::Ok => {
            if let Some(data) = response.data {
                print_data(data);
            }

            ExitCode::SUCCESS
        }

        CommandStatus::Error => {
            if let Some(error) = response.error {
                eprintln!("{error}");
            } else {
                eprintln!("Command failed.");
            }

            ExitCode::from(1)
        }
    }
}

fn print_data(data: serde_json::Value) {
    match data {
        serde_json::Value::String(value) => {
            println!("{value}");
        }

        value => match serde_json::to_string_pretty(&value) {
            Ok(output) => println!("{output}"),
            Err(_) => println!("{value}"),
        },
    }
}
