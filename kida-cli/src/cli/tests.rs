// Must implement module tests here! Do not implement tests inside source files!
#[cfg(test)]
mod backup_tests {
    use clap::Parser;

    use crate::cli::{CreateParameters, backup::CreateArgs};

    #[derive(Debug, Parser)]
    struct CreateParser {
        #[command(flatten)]
        args: CreateArgs,
    }

    #[test]
    fn file_aliases_preserve_relative_paths() {
        for flag in ["-f", "--file"] {
            let parsed = CreateParser::try_parse_from(["kida", flag, "./daily.toml"]).unwrap();

            assert_eq!(
                parsed.args.file,
                Some(std::path::PathBuf::from("./daily.toml"))
            );
            assert_eq!(parsed.args.parameters, CreateParameters::default());
        }
    }

    #[test]
    fn no_options_leave_defaults_for_preparation() {
        let parsed = CreateParser::try_parse_from(["kida"]).unwrap();

        assert_eq!(parsed.args, CreateArgs::default());
    }

    #[test]
    fn repeated_elements_and_modifiers_preserve_order() {
        let parsed = CreateParser::try_parse_from([
            "kida",
            "--target-required",
            "1=false",
            "--target",
            "./main",
            "--pre-backup-params",
            "1=null",
            "--pre-backup",
            "first",
            "--target",
            "../secondary",
            "--pre-backup",
            "second",
            "--pre-backup-params",
            "0={}",
        ])
        .unwrap();

        let parameters = parsed.args.parameters;
        assert_eq!(parameters.targets, ["./main", "../secondary"]);
        assert_eq!(parameters.target_required, ["1=false"]);
        assert_eq!(parameters.pre_backup, ["first", "second"]);
        assert_eq!(parameters.pre_backup_params, ["1=null", "0={}"]);
    }

    #[test]
    fn every_configuration_flag_is_detectable() {
        for (flag, value) in [
            ("--name", "daily"),
            ("--compression", "tar_zstd"),
            ("--source", "/etc/hosts"),
            ("--target", "/mnt/backups"),
            ("--target-required", "0=false"),
            ("--target-filesystem-uuid", "0=uuid"),
            ("--pre-backup", "first"),
            ("--post-backup", "last"),
            ("--pre-backup-params", "0=null"),
            ("--post-backup-params", "0={}"),
            ("--schedule", "null"),
            ("--retention-max-age", "7d"),
            ("--retention-keep-last", "0"),
            ("--retention-protected-restore-point", "point"),
        ] {
            let parsed = CreateParser::try_parse_from(["kida", flag, value]).unwrap();

            assert_ne!(
                parsed.args.parameters,
                CreateParameters::default(),
                "{flag}"
            );
        }
    }

    #[test]
    fn captures_file_and_parameters_for_local_mode_validation() {
        let parsed =
            CreateParser::try_parse_from(["kida", "-f", "daily.toml", "--name", "daily"]).unwrap();

        assert!(parsed.args.file.is_some());
        assert_ne!(parsed.args.parameters, CreateParameters::default());
    }
}

#[cfg(test)]
mod help_tests {
    use clap::CommandFactory;

    use crate::cli::{Cli, texts, with_banner};

    #[test]
    fn every_command_renders_banner_before_short_and_long_help() {
        fn check(mut command: clap::Command) {
            for help in [command.render_help(), command.render_long_help()] {
                let text = help.to_string();
                assert!(text.starts_with(texts::BANNER), "{text}");
                assert_eq!(text.matches(texts::BANNER).count(), 1, "{text}");
            }
            for subcommand in command.get_subcommands() {
                check(subcommand.clone());
            }
        }
        check(with_banner(Cli::command()));
    }
}
