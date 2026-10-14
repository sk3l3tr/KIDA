use error::InputError;

pub mod backup;
pub mod error;
pub mod fields;
pub mod file;
pub mod indexed;
pub mod scheduler;
pub mod system;

#[derive(Debug, PartialEq, Eq)]
pub enum InputMode {
    File,
    Parameters,
    Wizard,
}

pub fn resolve_mode(has_file: bool, has_parameters: bool) -> Result<InputMode, InputError> {
    match (has_file, has_parameters) {
        (true, true) => Err(InputError::new(
            "input",
            "--file cannot be combined with configuration parameters",
        )),
        (true, false) => Ok(InputMode::File),
        (false, true) => Ok(InputMode::Parameters),
        (false, false) => Ok(InputMode::Wizard),
    }
}

pub enum PreparedCommand {
    PowerCycle(system::PowerCycle),
    Schedule(scheduler::NewSchedule),
    Create(Box<backup::NewBackupJob>),
    Other(crate::cli::Command),
}

pub fn prepare(
    command: crate::cli::Command,
    interactive: bool,
    reader: &mut impl std::io::BufRead,
    writer: &mut impl std::io::Write,
) -> Result<PreparedCommand, InputError> {
    use crate::cli::{BackupCommand, BackupConfigCommand, Command, CreateParameters};
    match command {
        Command::System {
            command:
                crate::cli::SystemCommand::PowerCycle {
                    wake_time,
                    wake_after_seconds,
                },
        } => Ok(PreparedCommand::PowerCycle(system::prepare(
            wake_time,
            wake_after_seconds,
            interactive,
            reader,
            writer,
        )?)),
        Command::Scheduler {
            command: crate::cli::SchedulerCommand::Add(args),
        } => {
            let mode = resolve_mode(
                args.file.is_some(),
                args.parameters != crate::cli::AddParameters::default(),
            )?;
            let schedule = match mode {
                InputMode::File => {
                    file::read_toml::<scheduler::FileSchedule>(&args.file.unwrap())?.prepare()?
                }
                InputMode::Parameters => scheduler::from_parameters(args.parameters)?,
                InputMode::Wizard => {
                    if !interactive {
                        return Err(InputError::new(
                            "wizard",
                            "an interactive terminal is required",
                        ));
                    }
                    scheduler::wizard(reader, writer)?
                }
            };
            Ok(PreparedCommand::Schedule(schedule))
        }
        Command::Backup {
            command:
                BackupCommand::Config {
                    command: BackupConfigCommand::Create(args),
                },
        } => {
            let mode = resolve_mode(
                args.file.is_some(),
                args.parameters != CreateParameters::default(),
            )?;
            let job = match mode {
                InputMode::File => file::read_toml(&args.file.unwrap())?,
                InputMode::Parameters => backup::from_parameters(args.parameters)?,
                InputMode::Wizard => {
                    if !interactive {
                        return Err(InputError::new(
                            "wizard",
                            "an interactive terminal is required",
                        ));
                    }
                    backup::wizard(reader, writer)?
                }
            };
            Ok(PreparedCommand::Create(Box::new(job)))
        }
        other => Ok(PreparedCommand::Other(other)),
    }
}

#[cfg(test)]
pub(crate) mod tests;
