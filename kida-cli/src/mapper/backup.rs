use super::{empty_params, request};
use crate::{cli::BackupCommand, protocol::CommandRequest};

impl From<BackupCommand> for CommandRequest {
    fn from(command: BackupCommand) -> Self {
        match command {
            BackupCommand::List => request("backup.list", empty_params()),
        }
    }
}
