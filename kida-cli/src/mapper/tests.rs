// Must implement module tests here! Do not implement tests inside source files!

#[cfg(test)]
mod backup_tests {
    use clap::Parser;
    use serde_json::json;

    use crate::{cli::Cli, protocol::CommandRequest};

    #[test]
    fn backup_run_by_id_maps_to_core_contract() {
        let cli = Cli::try_parse_from(["kida", "backup", "run", "--id", "job-id"]).unwrap();

        let request = CommandRequest::from(
            crate::input::prepare(cli.command, false, &mut &b""[..], &mut Vec::new()).unwrap(),
        );

        assert_eq!(request.command, "backup.run");
        assert_eq!(request.params, json!({ "id": "job-id" }));
    }

    #[test]
    fn backup_run_by_name_maps_to_core_contract() {
        let cli = Cli::try_parse_from(["kida", "backup", "run", "--name", "daily"]).unwrap();

        let request = CommandRequest::from(
            crate::input::prepare(cli.command, false, &mut &b""[..], &mut Vec::new()).unwrap(),
        );

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
            (
                vec!["list"],
                "scheduler.list",
                serde_json::json!({"origin":"USER"}),
            ),
            (
                vec!["delete", "--id", "invalid-uuid"],
                "scheduler.delete",
                serde_json::json!({"id":"invalid-uuid"}),
            ),
        ] {
            let cli = Cli::try_parse_from(["kida", "scheduler"].into_iter().chain(args)).unwrap();
            let request = CommandRequest::from(
                crate::input::prepare(cli.command, false, &mut &b""[..], &mut Vec::new()).unwrap(),
            );
            assert_eq!(request.command, command);
            assert_eq!(request.params, params);
        }
    }

    #[test]
    fn list_maps_each_origin() {
        for (flag, expected) in [("user", "USER"), ("internal", "INTERNAL"), ("all", "ALL")] {
            let cli = Cli::try_parse_from(["kida", "scheduler", "list", "--origin", flag]).unwrap();
            let request = CommandRequest::from(
                crate::input::prepare(cli.command, false, &mut &b""[..], &mut Vec::new()).unwrap(),
            );
            assert_eq!(request.command, "scheduler.list");
            assert_eq!(request.params, serde_json::json!({"origin":expected}));
        }
    }

    #[test]
    fn parser_rejects_missing_ids_unknown_flags_and_invalid_u64() {
        for args in [
            vec!["delete"],
            vec!["delete", "--name", "x"],
            vec!["list", "--id", "x"],
            vec!["list", "--origin", "USER"],
            vec!["list", "--origin", "invalid"],
            vec!["add", "--origin", "internal"],
            vec!["add", "--seconds", "-1"],
            vec!["add", "--seconds", "18446744073709551616"],
            vec!["add", "--seconds", "1.5"],
        ] {
            assert!(Cli::try_parse_from(["kida", "scheduler"].into_iter().chain(args)).is_err());
        }
    }
}

#[test]
fn direct_mapping_rejects_commands_requiring_preparation() {
    use crate::cli::Cli;
    use clap::Parser;

    for args in [
        vec!["backup", "config", "create"],
        vec!["scheduler", "add"],
        vec!["system", "powercicle"],
    ] {
        let command = Cli::try_parse_from(["kida"].into_iter().chain(args))
            .unwrap()
            .command;
        assert!(
            super::direct(command)
                .unwrap_err()
                .to_string()
                .contains("must be prepared before mapping")
        );
    }
}

#[test]
fn prepared_commands_preserve_direct_domain_contracts() {
    use crate::{cli::Cli, input::prepare, protocol::CommandRequest};
    use clap::Parser;
    use serde_json::json;

    for (args, command, params) in [
        (vec!["system", "info"], "system.info", json!({})),
        (vec!["system", "health"], "system.health", json!({})),
        (
            vec!["system", "shutdown", "now"],
            "system.shutdown",
            json!({"when":"now"}),
        ),
        (
            vec!["system", "reboot", "now"],
            "system.reboot",
            json!({"when":"now"}),
        ),
        (
            vec!["docker", "containers", "list"],
            "docker.containers.list",
            json!({}),
        ),
        (
            vec!["docker", "container", "start", "web"],
            "docker.container.start",
            json!({"container":"web"}),
        ),
        (
            vec!["docker", "container", "stop", "web"],
            "docker.container.stop",
            json!({"container":"web"}),
        ),
        (
            vec!["docker", "container", "restart", "web"],
            "docker.container.restart",
            json!({"container":"web"}),
        ),
        (
            vec!["docker", "container", "delete", "web"],
            "docker.container.delete",
            json!({"container":"web"}),
        ),
        (
            vec!["backup", "config", "list"],
            "backup.config.list",
            json!({}),
        ),
        (
            vec!["backup", "config", "delete", "--id", "id"],
            "backup.config.delete",
            json!({"id":"id"}),
        ),
        (
            vec!["backup", "config", "delete", "--name", " daily "],
            "backup.config.delete",
            json!({"name":" daily "}),
        ),
    ] {
        let cli = Cli::try_parse_from(["kida"].into_iter().chain(args)).unwrap();
        let mut prompts = Vec::new();
        let request =
            CommandRequest::from(prepare(cli.command, false, &mut &b""[..], &mut prompts).unwrap());
        assert_eq!(request.command, command);
        assert_eq!(request.params, params);
        assert!(prompts.is_empty());
    }
}
