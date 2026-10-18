use super::error::InputError;
use crate::cli::{HealthCommand, HealthReportCommand};

pub struct PreparedHealth {
    command: HealthCommand,
}

impl PreparedHealth {
    pub(crate) fn into_command(self) -> HealthCommand {
        self.command
    }
}

pub fn prepare(mut command: HealthCommand) -> Result<PreparedHealth, InputError> {
    match &mut command {
        HealthCommand::Create { file, mode } => {
            validate_path(file)?;
            *mode = match mode.as_str() {
                "automatic" => "AUTOMATIC",
                "manual" => "MANUAL",
                _ => return Err(InputError::new("mode", "expected automatic or manual")),
            }
            .into();
        }
        HealthCommand::Run { file } => validate_path(file)?,
        HealthCommand::Start { run_id }
        | HealthCommand::Get { run_id }
        | HealthCommand::Stop { run_id }
        | HealthCommand::Delete { run_id }
        | HealthCommand::Report {
            command: HealthReportCommand::Get { run_id } | HealthReportCommand::Delete { run_id },
        } => {
            *run_id = uuid::Uuid::parse_str(run_id)
                .map_err(|error| InputError::new("run_id", error))?
                .to_string();
        }
        HealthCommand::List
        | HealthCommand::Report {
            command: HealthReportCommand::List,
        } => {}
    }
    Ok(PreparedHealth { command })
}

fn validate_path(file: &str) -> Result<(), InputError> {
    if file.trim().is_empty() {
        return Err(InputError::new("file", "--file must not be empty"));
    }
    Ok(())
}
