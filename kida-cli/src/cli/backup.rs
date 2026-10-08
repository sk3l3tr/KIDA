use std::{
    env,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

use clap::{ArgGroup, Subcommand};
use serde_json::{Value, json};

use crate::protocol::CommandRequest;

#[derive(Debug, Subcommand, PartialEq, Eq)]
pub enum BackupCommand {
    Config {
        #[command(subcommand)]
        command: BackupConfigCommand,
    },
}

impl From<BackupConfigCommand> for CommandRequest {
    fn from(command: BackupConfigCommand) -> Self {
        match command {
            BackupConfigCommand::List => request("backup.config.list", empty_params()),

            BackupConfigCommand::Create { file } => {
                request("backup.config.create", json!({ "file": file }))
            }

            BackupConfigCommand::Delete { id, name } => match (id, name) {
                (Some(id), None) => request("backup.config.delete", json!({ "id": id })),

                (None, Some(name)) => request("backup.config.delete", json!({ "name": name })),

                _ => unreachable!("clap requires exactly one backup selector"),
            },

            BackupConfigCommand::Run { name } => {
                request("backup.config.run", json!({ "name": name }))
            }
        }
    }
}

#[derive(Debug, Subcommand, PartialEq, Eq)]
pub enum BackupConfigCommand {
    List,

    Create {
        #[arg(
            short = 'f',
            value_name = "file",
            value_parser = absolute_file_path
        )]
        file: String,
    },

    #[command(group(
        ArgGroup::new("selector")
            .required(true)
            .multiple(false)
            .args(["id", "name"])
    ))]
    Delete {
        #[arg(long)]
        id: Option<String>,

        #[arg(long)]
        name: Option<String>,
    },

    Run {
        #[arg(value_name = "name")]
        name: String,
    },
}

fn absolute_file_path(file: &str) -> Result<String, String> {
    let path = Path::new(file);
    if path.is_absolute() {
        return Ok(file.to_string());
    }

    env::current_dir()
        .map_err(|error| format!("cannot resolve relative file path: {error}"))?
        .join(path)
        .into_os_string()
        .into_string()
        .map_err(|_| "resolved file path is not valid UTF-8".to_string())
}

fn request(command: impl Into<String>, params: Value) -> CommandRequest {
    CommandRequest {
        id: generate_request_id(),
        command: command.into(),
        params,
    }
}

fn empty_params() -> Value {
    serde_json::json!({})
}

fn generate_request_id() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
        .to_string()
}
