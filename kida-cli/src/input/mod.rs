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

pub struct PreparedCommand {
    command: PreparedKind,
}

enum PreparedKind {
    PowerCycle(system::PowerCycle),
    Schedule(scheduler::NewSchedule),
    Create(Box<backup::NewBackupJob>),
    Other(crate::protocol::CommandRequest),
}

impl PreparedCommand {
    pub(crate) fn into_request(self) -> crate::protocol::CommandRequest {
        match self.command {
            PreparedKind::PowerCycle(params) => crate::mapper::power_cycle(params),
            PreparedKind::Schedule(schedule) => crate::mapper::schedule(schedule),
            PreparedKind::Create(job) => crate::mapper::create(*job),
            PreparedKind::Other(request) => request,
        }
    }
}

fn prepare_mode<T, R: std::io::BufRead, W: std::io::Write>(
    mode: InputMode,
    interactive: bool,
    io: (&mut R, &mut W),
    file: impl FnOnce() -> Result<T, InputError>,
    parameters: impl FnOnce() -> Result<T, InputError>,
    wizard: impl FnOnce(&mut R, &mut W) -> Result<T, InputError>,
) -> Result<T, InputError> {
    match mode {
        InputMode::File => file(),
        InputMode::Parameters => parameters(),
        InputMode::Wizard => {
            if !interactive {
                return Err(InputError::new(
                    "wizard",
                    "an interactive terminal is required",
                ));
            }
            wizard(io.0, io.1)
        }
    }
}

pub fn prepare(
    command: crate::cli::Command,
    interactive: bool,
    reader: &mut impl std::io::BufRead,
    writer: &mut impl std::io::Write,
) -> Result<PreparedCommand, InputError> {
    use crate::cli::{BackupCommand, BackupConfigCommand, Command, CreateParameters};
    let command = match command {
        Command::System {
            command:
                crate::cli::SystemCommand::PowerCycle {
                    wake_time,
                    wake_after_seconds,
                },
        } => PreparedKind::PowerCycle(system::prepare(
            wake_time,
            wake_after_seconds,
            interactive,
            reader,
            writer,
        )?),
        Command::Scheduler {
            command: crate::cli::SchedulerCommand::Add(args),
        } => {
            let mode = resolve_mode(
                args.file.is_some(),
                args.parameters != crate::cli::AddParameters::default(),
            )?;
            let schedule = prepare_mode(
                mode,
                interactive,
                (reader, writer),
                || file::read_toml::<scheduler::FileSchedule>(&args.file.unwrap())?.prepare(),
                || scheduler::from_parameters(args.parameters),
                scheduler::wizard,
            )?;
            PreparedKind::Schedule(schedule)
        }
        Command::Backup {
            command:
                BackupCommand::Config {
                    command: BackupConfigCommand::Create(args),
                },
        } => {
            let args = *args;
            let mode = resolve_mode(
                args.file.is_some(),
                args.parameters != CreateParameters::default(),
            )?;
            let job = prepare_mode(
                mode,
                interactive,
                (reader, writer),
                || file::read_toml(&args.file.unwrap()),
                || backup::from_parameters(args.parameters),
                backup::wizard,
            )?;
            PreparedKind::Create(Box::new(job))
        }
        other => PreparedKind::Other(crate::mapper::direct(other)?),
    };
    Ok(PreparedCommand { command })
}

#[cfg(test)]
pub(crate) mod tests;
