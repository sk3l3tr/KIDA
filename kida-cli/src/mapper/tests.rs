// Must implement module tests here! Do not implement tests inside source files!

#[cfg(test)]
mod backup_tests {
    use clap::Parser;
    use serde_json::json;

    use crate::{cli::Cli, protocol::CommandRequest};

    #[test]
    fn backup_run_by_id_maps_to_core_contract() {
        let cli = Cli::try_parse_from(["kida", "backup", "run", "--id", "job-id"]).unwrap();

        let request = CommandRequest::from(cli.command);

        assert_eq!(request.command, "backup.run");
        assert_eq!(request.params, json!({ "id": "job-id" }));
    }

    #[test]
    fn backup_run_by_name_maps_to_core_contract() {
        let cli = Cli::try_parse_from(["kida", "backup", "run", "--name", "daily"]).unwrap();

        let request = CommandRequest::from(cli.command);

        assert_eq!(request.command, "backup.run");
        assert_eq!(request.params, json!({ "name": "daily" }));
    }

    #[test]
    fn backup_run_requires_exactly_one_selector() {
        assert!(Cli::try_parse_from(["kida", "backup", "run"]).is_err());
        assert!(
            Cli::try_parse_from(["kida", "backup", "run", "--id", "job-id", "--name", "daily"])
                .is_err()
        );
    }

    #[test]
    fn backup_config_run_is_rejected() {
        assert!(Cli::try_parse_from(["kida", "backup", "config", "run", "daily"]).is_err());
    }
}

#[cfg(test)]
mod scheduler_tests {
    use crate::{cli::Cli, protocol::CommandRequest};
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
