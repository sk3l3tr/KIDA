// Must implement module tests here! Do not implement tests inside source files!
#[cfg(test)]
mod mod_tests {
    use crate::input::{InputMode, resolve_mode};

    #[test]
    fn resolves_exclusive_modes() {
        assert_eq!(resolve_mode(true, false).unwrap(), InputMode::File);
        assert_eq!(resolve_mode(false, true).unwrap(), InputMode::Parameters);
        assert_eq!(resolve_mode(false, false).unwrap(), InputMode::Wizard);
        assert!(resolve_mode(true, true).is_err());
    }
}

#[cfg(test)]
mod backup_tests {
    use crate::input::backup::model::NewBackupJob;
    use serde_json::json;

    #[test]
    fn defaults_and_literal_paths_are_preserved() {
        let input: NewBackupJob = serde_json::from_value(json!({
            "name": "daily",
            "sources": ["./etc/../hosts"],
            "targets": [{"path": "../backups"}]
        }))
        .unwrap();

        assert_eq!(
            serde_json::to_value(input).unwrap(),
            json!({
                "name": "daily",
                "sources": ["./etc/../hosts"],
                "targets": [{"path": "../backups", "required": true}],
                "compression": "tar_zstd",
                "lifecycle": {
                    "pre_backup": [],
                    "post_backup": []
                }
            })
        );
    }

    #[test]
    fn lifecycle_params_default_to_null() {
        let input: NewBackupJob = serde_json::from_value(json!({
            "name": "daily",
            "sources": ["/etc/hosts"],
            "targets": [{"path": "/mnt/backups"}],
            "lifecycle": {
                "pre_backup": [{"command": "system.health"}]
            }
        }))
        .unwrap();

        assert_eq!(
            serde_json::to_value(input).unwrap()["lifecycle"],
            json!({
                "pre_backup": [{
                    "command": "system.health",
                    "params": null
                }],
                "post_backup": []
            })
        );
    }
}

#[cfg(test)]
mod backup_parameter_tests {
    use serde_json::{Value, json};

    use crate::{
        cli::CreateParameters,
        input::backup::{map, model::NewBackupJob},
    };

    fn minimal() -> CreateParameters {
        CreateParameters {
            name: Some("test-backup".into()),
            sources: vec!["/etc/hosts".into()],
            targets: vec!["/tmp/backups".into()],
            ..CreateParameters::default()
        }
    }

    #[test]
    fn file_and_parameters_produce_identical_configuration() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("kida-backup-test.toml");

        let file: NewBackupJob = crate::input::file::read_toml(&path).unwrap();
        let parameters = map(minimal()).unwrap();

        assert_eq!(
            serde_json::to_value(file).unwrap(),
            serde_json::to_value(parameters).unwrap()
        );
    }

    #[test]
    fn composes_advanced_fields_and_preserves_defaults_and_order() {
        let parameters = CreateParameters {
            targets: vec!["./main".into(), "../secondary".into()],
            target_required: vec!["1=false".into()],
            target_filesystem_uuid: vec!["0=volume-id".into()],
            pre_backup: vec!["first".into(), "second".into()],
            pre_backup_params: vec![r#"1={"text":"a=b"}"#.into()],
            post_backup: vec!["last".into()],
            post_backup_params: vec!["0=[null,true,3]".into()],
            schedule: Some(r#"{"custom":[null,1]}"#.into()),
            retention_max_age: Some("7d".into()),
            retention_keep_last: Some("0".into()),
            retention_protected_restore_points: vec!["point-a".into(), "point-b".into()],
            ..minimal()
        };

        let configuration = serde_json::to_value(map(parameters).unwrap()).unwrap();

        assert_eq!(
            configuration,
            json!({
                "name": "test-backup",
                "sources": ["/etc/hosts"],
                "targets": [
                    {
                        "path": "./main",
                        "required": true,
                        "filesystem_uuid": "volume-id"
                    },
                    {"path": "../secondary", "required": false}
                ],
                "compression": "tar_zstd",
                "lifecycle": {
                    "pre_backup": [
                        {"command": "first", "params": null},
                        {"command": "second", "params": {"text": "a=b"}}
                    ],
                    "post_backup": [
                        {"command": "last", "params": [null, true, 3]}
                    ]
                },
                "schedule": {"custom": [null, 1]},
                "retention": {
                    "max_age": "7d",
                    "keep_last": 0,
                    "protected_restore_points": ["point-a", "point-b"]
                }
            })
        );
    }

    #[test]
    fn rejects_incomplete_parameters_and_invalid_scalar_values() {
        let cases = [
            (
                CreateParameters {
                    name: None,
                    ..minimal()
                },
                "name",
            ),
            (
                CreateParameters {
                    sources: vec![],
                    ..minimal()
                },
                "sources",
            ),
            (
                CreateParameters {
                    targets: vec![],
                    ..minimal()
                },
                "targets",
            ),
            (
                CreateParameters {
                    compression: Some("zip".into()),
                    ..minimal()
                },
                "compression",
            ),
            (
                CreateParameters {
                    schedule: Some("{".into()),
                    ..minimal()
                },
                "schedule",
            ),
            (
                CreateParameters {
                    retention_keep_last: Some("-1".into()),
                    ..minimal()
                },
                "retention.keep_last",
            ),
            (
                CreateParameters {
                    retention_keep_last: Some("4294967296".into()),
                    ..minimal()
                },
                "retention.keep_last",
            ),
        ];

        for (parameters, field) in cases {
            let error = map(parameters).unwrap_err().to_string();
            assert!(error.contains(field), "{error}");
        }
    }

    #[test]
    fn explicit_null_matches_deserialized_defaults() {
        let parameters = map(CreateParameters {
            compression: Some("tar_zstd".into()),
            pre_backup: vec!["health".into()],
            pre_backup_params: vec!["0=null".into()],
            schedule: Some("null".into()),
            ..minimal()
        })
        .unwrap();
        let deserialized: NewBackupJob = serde_json::from_value(json!({
            "name": "test-backup",
            "sources": ["/etc/hosts"],
            "targets": [{"path": "/tmp/backups"}],
            "schedule": null,
            "lifecycle": {"pre_backup": [{"command": "health", "params": null}]}
        }))
        .unwrap();
        assert_eq!(
            serde_json::to_value(parameters).unwrap(),
            serde_json::to_value(deserialized).unwrap()
        );
    }

    #[test]
    fn retention_can_contain_only_protected_restore_points() {
        let parameters = CreateParameters {
            retention_protected_restore_points: vec!["point".into()],
            ..minimal()
        };

        let configuration: Value = serde_json::to_value(map(parameters).unwrap()).unwrap();

        assert_eq!(
            configuration["retention"],
            json!({"protected_restore_points": ["point"]})
        );
    }
}

#[cfg(test)]
mod backup_wizard_tests {
    use crate::{
        cli::CreateParameters,
        input::backup::{map, model::NewBackupJob, wizard},
    };
    use serde_json::{Value, json};

    const SCRIPT: &str = " daily \n2\n./etc/../hosts\n source with spaces \n2\n../main\n\ntrue\n volume-id \n./secondary\nfalse\n\n\ntrue\n2\n first \n\nsecond\n{\"text\":\"a=b\",\"items\":[true,3]}\n1\nlast\n\"null\"\ntrue\n{\"custom\":[1]}\ntrue\ntrue\n7d\ntrue\n0\n2\npoint-a\npoint-b\n";

    #[test]
    fn all_modes_match_the_shared_fixture() {
        let expected: Value =
            serde_json::from_str(include_str!("../../../tests/fixtures/backup.json")).unwrap();
        let file: NewBackupJob =
            toml::from_str(include_str!("../../../tests/fixtures/backup.toml")).unwrap();
        let parameters = map(CreateParameters {
            name: Some(" daily ".into()),
            sources: vec!["./etc/../hosts".into(), " source with spaces ".into()],
            targets: vec!["../main".into(), "./secondary".into()],
            target_required: vec!["1=false".into()],
            target_filesystem_uuid: vec!["0= volume-id ".into()],
            pre_backup: vec![" first ".into(), "second".into()],
            pre_backup_params: vec![r#"1={"text":"a=b","items":[true,3]}"#.into()],
            post_backup: vec!["last".into()],
            post_backup_params: vec![r#"0="null""#.into()],
            schedule: Some(r#"{"custom":[1]}"#.into()),
            retention_max_age: Some("7d".into()),
            retention_keep_last: Some("0".into()),
            retention_protected_restore_points: vec!["point-a".into(), "point-b".into()],
            ..CreateParameters::default()
        })
        .unwrap();
        let mut prompts = Vec::new();
        let interactive = wizard(&mut SCRIPT.as_bytes(), &mut prompts).unwrap();
        for job in [file, parameters, interactive] {
            assert_eq!(serde_json::to_value(job).unwrap(), expected);
        }
        let prompts = String::from_utf8(prompts).unwrap();
        assert!(prompts.contains("[true]"));
        assert!(prompts.contains("[\"tar_zstd\"]"));
        assert!(prompts.contains("[null]"));
    }

    #[test]
    fn retries_invalid_scalars_and_counts_and_uses_optional_defaults() {
        let script = "name\nwrong\n0\n1\n./source\n1\n./target\nyes\n\n\nzip\n\n\n\n\n";
        let mut prompts = Vec::new();
        let job = wizard(&mut script.as_bytes(), &mut prompts).unwrap();
        assert_eq!(
            serde_json::to_value(job).unwrap(),
            json!({"name":"name", "sources":["./source"], "targets":[{"path":"./target","required":true}], "compression":"tar_zstd", "lifecycle":{"pre_backup":[],"post_backup":[]}})
        );
        let prompts = String::from_utf8(prompts).unwrap();
        assert!(prompts.matches("try again").count() >= 3);
        assert!(prompts.contains("Expected at least 1"));
    }

    #[test]
    fn eof_cancels_at_every_prompt_and_interrupt_cancels() {
        for (index, _) in SCRIPT[..SCRIPT.len() - 1].match_indices('\n') {
            assert!(wizard(&mut &SCRIPT.as_bytes()[..=index], &mut Vec::new()).is_err());
        }
        assert!(
            wizard(&mut "\u{3}\n".as_bytes(), &mut Vec::new())
                .unwrap_err()
                .to_string()
                .contains("interrupt")
        );
        struct Interrupted;
        impl std::io::Read for Interrupted {
            fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> {
                Err(std::io::ErrorKind::Interrupted.into())
            }
        }
        impl std::io::BufRead for Interrupted {
            fn fill_buf(&mut self) -> std::io::Result<&[u8]> {
                Err(std::io::ErrorKind::Interrupted.into())
            }
            fn consume(&mut self, _: usize) {}
        }
        assert!(
            wizard(&mut Interrupted, &mut Vec::new())
                .unwrap_err()
                .to_string()
                .contains("cancelled")
        );
    }
}

#[cfg(test)]
mod field_tests {
    use serde_json::json;

    use crate::input::fields::{Field, Kind, ask};

    #[test]
    fn corrects_json_and_u32_and_preserves_crlf_string_content() {
        let definition = Kind::Object(vec![
            Field {
                name: "json",
                kind: Kind::Json,
            },
            Field {
                name: "count",
                kind: Kind::U32,
            },
            Field {
                name: "text",
                kind: Kind::String,
            },
        ]);
        let mut prompts = Vec::new();
        let result = ask(
            &definition,
            "test",
            &mut "{\n[null,true,3]\n-1\n4294967296\n0\n  literal = value  \r\n".as_bytes(),
            &mut prompts,
        )
        .unwrap();
        assert_eq!(
            result,
            json!({"json":[null,true,3],"count":0,"text":"  literal = value  "})
        );
        assert_eq!(
            String::from_utf8(prompts)
                .unwrap()
                .matches("try again")
                .count(),
            3
        );
    }
}

#[cfg(test)]
mod file_tests {
    use std::{
        fs,
        sync::atomic::{AtomicU64, Ordering},
    };

    use serde::Deserialize;

    use crate::input::{error::InputError, file::read_toml};

    static NEXT_ID: AtomicU64 = AtomicU64::new(0);

    #[derive(Debug, Deserialize, PartialEq)]
    struct Configuration {
        name: String,
        paths: Vec<String>,

        #[serde(default = "default_enabled")]
        enabled: bool,
    }

    fn default_enabled() -> bool {
        true
    }

    fn temporary_path() -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "kida-input-{}-{}.toml",
            std::process::id(),
            NEXT_ID.fetch_add(1, Ordering::Relaxed)
        ))
    }

    fn load(content: &str) -> Result<Configuration, InputError> {
        let path = temporary_path();
        fs::write(&path, content).unwrap();

        let result = read_toml(&path);

        fs::remove_file(&path).unwrap();
        result
    }

    #[test]
    fn reads_typed_configuration_with_defaults_and_literal_paths() {
        let configuration = load(
            r#"
name = "daily"
paths = ["./etc/../hosts", "../backups"]
"#,
        )
        .unwrap();

        assert_eq!(
            configuration,
            Configuration {
                name: "daily".to_string(),
                paths: vec!["./etc/../hosts".to_string(), "../backups".to_string(),],
                enabled: true,
            }
        );
    }

    #[test]
    fn rejects_invalid_toml() {
        let error = load("name = [").unwrap_err().to_string();

        assert!(error.contains("invalid TOML in"));
    }

    #[test]
    fn rejects_invalid_field_types_with_context() {
        let error = load(
            r#"
name = "daily"
paths = []
enabled = "yes"
"#,
        )
        .unwrap_err()
        .to_string();

        assert!(error.contains("invalid TOML in"));
        assert!(error.contains("enabled"));
    }

    #[test]
    fn rejects_missing_required_fields() {
        let error = load("paths = []").unwrap_err().to_string();

        assert!(error.contains("missing field"));
        assert!(error.contains("name"));
    }

    #[test]
    fn reports_unreadable_file_with_its_path() {
        let path = temporary_path();
        let error = read_toml::<Configuration>(&path).unwrap_err().to_string();

        assert!(error.contains("cannot read file"));
        assert!(error.contains(path.to_str().unwrap()));
    }
}

#[cfg(test)]
mod indexed_tests {
    use crate::input::indexed::apply_indexed;
    use serde_json::{Value, json};

    #[test]
    fn changes_only_the_selected_index() {
        let mut items = [true, true, true];

        apply_indexed(
            &mut items,
            &["2=false".into(), "0=false".into()],
            "targets.required",
            |item, value: bool| *item = value,
        )
        .unwrap();

        assert_eq!(items, [false, true, false]);
    }

    #[test]
    fn preserves_strings_containing_equals() {
        let mut items = [String::new()];

        apply_indexed(
            &mut items,
            &["0=a=b".into()],
            "targets.filesystem_uuid",
            |item, value: String| *item = value,
        )
        .unwrap();

        assert_eq!(items[0], "a=b");
    }

    #[test]
    fn applies_free_json_to_object_attributes() {
        let mut items = [
            json!({"command": "first", "params": null}),
            json!({"command": "second", "params": null}),
        ];

        apply_indexed(
            &mut items,
            &[r#"1={"text":"a=b","values":[null,true,3]}"#.into()],
            "lifecycle.pre_backup.params",
            |item, value: Value| item["params"] = value,
        )
        .unwrap();

        assert_eq!(items[0], json!({"command": "first", "params": null}));
        assert_eq!(
            items[1],
            json!({
                "command": "second",
                "params": {"text": "a=b", "values": [null, true, 3]}
            })
        );
    }

    #[test]
    fn rejects_invalid_assignments_with_field_context() {
        let cases = [
            (vec!["0".into()], "expected INDEX=VALUE"),
            (vec!["x=false".into()], "targets.required"),
            (vec!["1=false".into()], "index does not exist"),
            (vec!["0=yes".into()], "targets.required[0]"),
            (
                vec!["0=true".into(), "0=false".into()],
                "duplicate assignment",
            ),
        ];

        for (assignments, expected) in cases {
            let mut items = [true];
            let error = apply_indexed(
                &mut items,
                &assignments,
                "targets.required",
                |item, value: bool| *item = value,
            )
            .unwrap_err()
            .to_string();

            assert!(error.contains("targets.required"), "{error}");
            assert!(error.contains(expected), "{error}");
        }
    }

    #[test]
    fn rejects_invalid_json() {
        let mut items = [Value::Null];

        let error = apply_indexed(
            &mut items,
            &["0={".into()],
            "lifecycle.post_backup.params",
            |item, value: Value| *item = value,
        )
        .unwrap_err()
        .to_string();

        assert!(error.contains("lifecycle.post_backup.params[0]"));
    }
}

#[cfg(test)]
mod scheduler_tests {
    use crate::{
        cli::Cli,
        input::{
            prepare,
            scheduler::{FileSchedule, NewSchedule, wizard},
        },
        protocol::command::CommandRequest,
    };
    use clap::Parser;
    use serde_json::{Value, json};

    #[test]
    fn all_modes_match_for_each_rule_and_arbitrary_json() {
        for params in [
            "null",
            "true",
            "42",
            "\"text\"",
            "[null,false,3]",
            "{\"name\":\"daily\"}",
        ] {
            for (flags, table, script, expected) in [
                (
                    vec!["--at", "2030-01-01T12:00:00Z"],
                    "type='once'\nat='2030-01-01T12:00:00Z'",
                    "once\n2030-01-01T12:00:00Z\n",
                    json!({"type":"once","at":"2030-01-01T12:00:00Z"}),
                ),
                (
                    vec!["--seconds", "18446744073709551615"],
                    "type='interval'\nseconds=18446744073709551615",
                    "interval\n18446744073709551615\n",
                    json!({"type":"interval","seconds":u64::MAX}),
                ),
                (
                    vec!["--cron", "30 2 * * *"],
                    "type='cron'\nexpression='30 2 * * *'",
                    "cron\n30 2 * * *\n\n",
                    json!({"type":"cron","expression":"30 2 * * *","timezone":"UTC"}),
                ),
                (
                    vec!["--cron", "30 2 * * *", "--timezone", "Europe/Madrid"],
                    "type='cron'\nexpression='30 2 * * *'\ntimezone='Europe/Madrid'",
                    "cron\n30 2 * * *\nEurope/Madrid\n",
                    json!({"type":"cron","expression":"30 2 * * *","timezone":"Europe/Madrid"}),
                ),
            ] {
                let file: FileSchedule = toml::from_str(&format!(
                    "command='backup.run'\nparams='{params}'\n[schedule]\n{table}"
                ))
                .unwrap();
                let cli = Cli::try_parse_from(
                    [
                        "kida",
                        "scheduler",
                        "add",
                        "--command",
                        "backup.run",
                        "--params",
                        params,
                    ]
                    .into_iter()
                    .chain(flags),
                )
                .unwrap();
                let request = CommandRequest::from(
                    prepare(cli.command, false, &mut &b""[..], &mut Vec::new()).unwrap(),
                );
                let mut prompts = Vec::new();
                let wizard = wizard(
                    &mut format!("backup.run\n{params}\n{script}").as_bytes(),
                    &mut prompts,
                )
                .unwrap();
                assert_eq!(request.command, "scheduler.add");
                for value in [
                    serde_json::to_value(file.prepare().unwrap()).unwrap(),
                    serde_json::to_value(wizard).unwrap(),
                    request.params,
                ] {
                    assert_eq!(
                        value,
                        json!({"command":"backup.run","params":serde_json::from_str::<Value>(params).unwrap(),"schedule":expected})
                    );
                }
                let prompts = String::from_utf8(prompts).unwrap();
                assert_eq!(
                    prompts.contains("IANA timezone"),
                    expected["type"] == "cron"
                );
                assert_eq!(
                    prompts.contains("Interval in seconds"),
                    expected["type"] == "interval"
                );
                assert_eq!(
                    prompts.contains("Execution time"),
                    expected["type"] == "once"
                );
            }
        }
    }

    #[test]
    fn file_rejects_unknown_missing_and_mistyped_fields() {
        let base = "command='backup.run'\nparams='null'\n";
        for content in [
            format!("{base}extra=true\n[schedule]\ntype='once'\nat='future'"),
            format!("{base}[schedule]\ntype='once'\nat='future'\nseconds=1"),
            format!("{base}[schedule]\ntype='interval'\nseconds=-1"),
            format!("{base}[schedule]\ntype='interval'\nseconds='1'"),
            format!("{base}[schedule]\ntype='cron'\nexpression='* * * * *'\nat='future'"),
            format!("{base}[schedule]\ntype='cron'"),
            "command='backup.run'\n[schedule]\ntype='interval'\nseconds=1".into(),
            "command='backup.run'\nparams={}\n[schedule]\ntype='interval'\nseconds=1".into(),
        ] {
            assert!(
                toml::from_str::<FileSchedule>(&content).is_err(),
                "{content}"
            );
        }
        let file: FileSchedule =
            toml::from_str("command='x'\nparams='{'\n[schedule]\ntype='interval'\nseconds=1")
                .unwrap();
        assert!(file.prepare().is_err());
        assert!(
            serde_json::from_value::<NewSchedule>(
                json!({"command":"x","schedule":{"type":"interval","seconds":1}})
            )
            .is_err()
        );
    }

    #[test]
    fn wizard_retries_formats_and_cancels_at_each_question() {
        let mut prompts = Vec::new();
        let job = wizard(
            &mut "x\n{\nnull\nwrong\ninterval\n-1\n18446744073709551616\n0\n".as_bytes(),
            &mut prompts,
        )
        .unwrap();
        assert_eq!(serde_json::to_value(job).unwrap()["schedule"]["seconds"], 0);
        assert_eq!(
            String::from_utf8(prompts)
                .unwrap()
                .matches("try again")
                .count(),
            4
        );
        for script in [
            "x\nnull\nonce\nfuture\n",
            "x\nnull\ninterval\n1\n",
            "x\nnull\ncron\n* * * * *\n\n",
        ] {
            assert!(wizard(&mut &b""[..], &mut Vec::new()).is_err());
            for (index, _) in script[..script.len() - 1].match_indices('\n') {
                assert!(wizard(&mut &script.as_bytes()[..=index], &mut Vec::new()).is_err());
            }
        }
        assert!(
            wizard(&mut "\u{3}\n".as_bytes(), &mut Vec::new())
                .unwrap_err()
                .to_string()
                .contains("interrupt")
        );
    }
}

#[cfg(test)]
mod validated_field_tests {
    use crate::input::{
        error::InputError,
        fields::{Kind, ask_validated},
    };
    use std::{
        cell::Cell,
        io::{self, Write},
    };

    #[test]
    fn cancellation_does_not_call_the_validator() {
        for script in ["", "\u{3}\n"] {
            let calls = Cell::new(0);
            let error = ask_validated(
                &Kind::String,
                "test",
                &mut script.as_bytes(),
                &mut Vec::new(),
                |_| {
                    calls.set(calls.get() + 1);
                    Ok(())
                },
            )
            .unwrap_err();
            assert!(error.to_string().contains("cancelled"));
            assert_eq!(calls.get(), 0);
        }
    }

    #[test]
    fn write_failure_during_retry_stops_immediately() {
        struct LimitedWriter(usize);
        impl Write for LimitedWriter {
            fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
                if self.0 == 0 {
                    return Err(io::ErrorKind::BrokenPipe.into());
                }
                let count = bytes.len().min(self.0);
                self.0 -= count;
                Ok(count)
            }
            fn flush(&mut self) -> io::Result<()> {
                Ok(())
            }
        }
        let mut reader = &b"invalid\nvalid\n"[..];
        let calls = Cell::new(0);
        let error = ask_validated(
            &Kind::String,
            "test",
            &mut reader,
            &mut LimitedWriter("test: ".len()),
            |_| {
                calls.set(calls.get() + 1);
                Err::<(), _>(InputError::new("test", "invalid"))
            },
        )
        .unwrap_err();
        assert!(error.to_string().contains("broken pipe"));
        assert_eq!(calls.get(), 1);
        assert_eq!(reader, b"valid\n");
    }
}
