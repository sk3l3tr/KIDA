use std::{env, path::Path};

use clap::{ArgGroup, Subcommand};

#[derive(Debug, Subcommand, PartialEq, Eq)]
pub enum BackupCommand {
    Config {
        #[command(subcommand)]
        command: BackupConfigCommand,
    },

    #[command(group(
        ArgGroup::new("selector")
            .required(true)
            .multiple(false)
            .args(["id", "name"])
    ))]
    Run {
        #[arg(long)]
        id: Option<String>,

        #[arg(long)]
        name: Option<String>,
    },
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
