use super::{empty_params, request};
use crate::{cli::SchedulerCommand, protocol::CommandRequest};

impl From<SchedulerCommand> for CommandRequest {
    fn from(command: SchedulerCommand) -> Self {
        match command {
            SchedulerCommand::List => request("scheduler.list", empty_params()),
            SchedulerCommand::Delete { id } => {
                request("scheduler.delete", serde_json::json!({"id":id}))
            }
            SchedulerCommand::Add(_) => unreachable!("schedule must be prepared before mapping"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::Cli;
    use clap::Parser;

    #[test]
    fn list_and_delete_map_exactly_and_defer_uuid_validation() {
        for (args, command, params) in [
            (vec!["list"], "scheduler.list", serde_json::json!({})),
            (
                vec!["delete", "--id", "invalid-uuid"],
                "scheduler.delete",
                serde_json::json!({"id":"invalid-uuid"}),
            ),
        ] {
            let cli = Cli::try_parse_from(["kida", "scheduler"].into_iter().chain(args)).unwrap();
            let request = CommandRequest::from(cli.command);
            assert_eq!(request.command, command);
            assert_eq!(request.params, params);
        }
    }

    #[test]
    fn parser_rejects_missing_ids_unknown_flags_and_invalid_u64() {
        for args in [
            vec!["delete"],
            vec!["delete", "--name", "x"],
            vec!["list", "--id", "x"],
            vec!["add", "--seconds", "-1"],
            vec!["add", "--seconds", "18446744073709551616"],
            vec!["add", "--seconds", "1.5"],
        ] {
            assert!(Cli::try_parse_from(["kida", "scheduler"].into_iter().chain(args)).is_err());
        }
    }
}
