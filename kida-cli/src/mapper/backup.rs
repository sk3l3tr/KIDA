use crate::{cli::BackupCommand, protocol::CommandRequest};

impl From<BackupCommand> for CommandRequest {
    fn from(command: BackupCommand) -> Self {
        match command {
            BackupCommand::Config { command } => command.into(),
        }
    }
}
