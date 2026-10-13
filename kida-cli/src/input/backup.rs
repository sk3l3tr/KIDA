use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Serialize, Deserialize)]
pub struct NewBackupJob {
    pub name: String,
    pub sources: Vec<PathBuf>,
    pub targets: Vec<BackupTarget>,

    #[serde(default)]
    pub compression: Compression,

    #[serde(default)]
    pub lifecycle: Lifecycle,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schedule: Option<Value>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retention: Option<RetentionPolicy>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BackupTarget {
    pub path: PathBuf,

    #[serde(default = "default_required")]
    pub required: bool,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub filesystem_uuid: Option<String>,
}

fn default_required() -> bool {
    true
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Compression {
    #[default]
    TarZstd,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LifecycleCommand {
    pub command: String,

    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct Lifecycle {
    #[serde(default)]
    pub pre_backup: Vec<LifecycleCommand>,

    #[serde(default)]
    pub post_backup: Vec<LifecycleCommand>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RetentionPolicy {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_age: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub keep_last: Option<u32>,

    #[serde(default)]
    pub protected_restore_points: Vec<String>,
}

pub fn from_parameters(
    parameters: crate::cli::CreateParameters,
) -> Result<NewBackupJob, super::error::InputError> {
    use serde_json::json;

    use super::{error::InputError, indexed::apply_indexed};

    let name = parameters
        .name
        .ok_or_else(|| InputError::new("name", "--name is required"))?;

    if parameters.sources.is_empty() {
        return Err(InputError::new(
            "sources",
            "at least one --source is required",
        ));
    }

    if parameters.targets.is_empty() {
        return Err(InputError::new(
            "targets",
            "at least one --target is required",
        ));
    }

    let mut targets: Vec<Value> = parameters
        .targets
        .into_iter()
        .map(|path| json!({ "path": path }))
        .collect();

    apply_indexed(
        &mut targets,
        &parameters.target_required,
        "targets.required",
        |target, required: bool| target["required"] = json!(required),
    )?;

    apply_indexed(
        &mut targets,
        &parameters.target_filesystem_uuid,
        "targets.filesystem_uuid",
        |target, uuid: String| target["filesystem_uuid"] = json!(uuid),
    )?;

    let commands = |commands: Vec<String>| {
        commands
            .into_iter()
            .map(|command| json!({ "command": command }))
            .collect::<Vec<_>>()
    };

    let mut pre_backup = commands(parameters.pre_backup);
    let mut post_backup = commands(parameters.post_backup);

    apply_indexed(
        &mut pre_backup,
        &parameters.pre_backup_params,
        "lifecycle.pre_backup.params",
        |command, params: Value| command["params"] = params,
    )?;

    apply_indexed(
        &mut post_backup,
        &parameters.post_backup_params,
        "lifecycle.post_backup.params",
        |command, params: Value| command["params"] = params,
    )?;

    let mut configuration = json!({
        "name": name,
        "sources": parameters.sources,
        "targets": targets,
        "lifecycle": {
            "pre_backup": pre_backup,
            "post_backup": post_backup
        }
    });

    if let Some(compression) = parameters.compression {
        serde_json::from_value::<Compression>(json!(&compression))
            .map_err(|error| InputError::new("compression", error))?;

        configuration["compression"] = json!(compression);
    }

    if let Some(schedule) = parameters.schedule {
        configuration["schedule"] =
            serde_json::from_str(&schedule).map_err(|error| InputError::new("schedule", error))?;
    }

    if parameters.retention_max_age.is_some()
        || parameters.retention_keep_last.is_some()
        || !parameters.retention_protected_restore_points.is_empty()
    {
        let keep_last = parameters
            .retention_keep_last
            .map(|value| {
                value
                    .parse::<u32>()
                    .map_err(|error| InputError::new("retention.keep_last", error))
            })
            .transpose()?;

        configuration["retention"] = json!({
            "max_age": parameters.retention_max_age,
            "keep_last": keep_last,
            "protected_restore_points": parameters.retention_protected_restore_points
        });
    }

    serde_json::from_value(configuration)
        .map_err(|error| InputError::new("backup configuration", error))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::NewBackupJob;

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
mod parameter_tests {
    use serde_json::{Value, json};

    use crate::cli::CreateParameters;

    use super::{NewBackupJob, from_parameters};

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
        let parameters = from_parameters(minimal()).unwrap();

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

        let configuration = serde_json::to_value(from_parameters(parameters).unwrap()).unwrap();

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
            let error = from_parameters(parameters).unwrap_err().to_string();
            assert!(error.contains(field), "{error}");
        }
    }

    #[test]
    fn retention_can_contain_only_protected_restore_points() {
        let parameters = CreateParameters {
            retention_protected_restore_points: vec!["point".into()],
            ..minimal()
        };

        let configuration: Value =
            serde_json::to_value(from_parameters(parameters).unwrap()).unwrap();

        assert_eq!(
            configuration["retention"],
            json!({"protected_restore_points": ["point"]})
        );
    }
}

pub fn wizard(
    reader: &mut impl std::io::BufRead,
    writer: &mut impl std::io::Write,
) -> Result<NewBackupJob, super::error::InputError> {
    use super::fields::{Field, Kind, ask};
    use serde_json::json;
    fn field(name: &'static str, kind: Kind) -> Field {
        Field { name, kind }
    }
    fn optional(kind: Kind) -> Kind {
        Kind::Optional(Box::new(kind))
    }
    fn list(kind: Kind, minimum: usize) -> Kind {
        Kind::List(Box::new(kind), minimum)
    }
    fn default(kind: Kind, value: Value) -> Kind {
        Kind::Default(Box::new(kind), value)
    }
    fn commands() -> Kind {
        list(
            Kind::Object(vec![
                field("command", Kind::String),
                field("params", default(Kind::Json, Value::Null)),
            ]),
            0,
        )
    }
    let definition = Kind::Object(vec![
        field("name", Kind::String),
        field("sources", list(Kind::String, 1)),
        field(
            "targets",
            list(
                Kind::Object(vec![
                    field("path", Kind::String),
                    field("required", default(Kind::Bool, json!(true))),
                    field("filesystem_uuid", optional(Kind::String)),
                ]),
                1,
            ),
        ),
        field(
            "compression",
            default(Kind::Choice(&["tar_zstd"]), json!("tar_zstd")),
        ),
        field(
            "lifecycle",
            optional(Kind::Object(vec![
                field("pre_backup", commands()),
                field("post_backup", commands()),
            ])),
        ),
        field("schedule", optional(Kind::Json)),
        field(
            "retention",
            optional(Kind::Object(vec![
                field("max_age", optional(Kind::String)),
                field("keep_last", optional(Kind::U32)),
                field("protected_restore_points", list(Kind::String, 0)),
            ])),
        ),
    ]);
    serde_json::from_value(ask(&definition, "backup", reader, writer)?)
        .map_err(|error| super::error::InputError::new("backup configuration", error))
}

#[cfg(test)]
mod wizard_tests {
    use super::*;
    use crate::cli::CreateParameters;
    use serde_json::json;

    const SCRIPT: &str = " daily \n2\n./etc/../hosts\n source with spaces \n2\n../main\n\ntrue\n volume-id \n./secondary\nfalse\n\n\ntrue\n2\n first \n\nsecond\n{\"text\":\"a=b\",\"items\":[true,3]}\n1\nlast\n\"null\"\ntrue\n{\"custom\":[1]}\ntrue\ntrue\n7d\ntrue\n0\n2\npoint-a\npoint-b\n";

    #[test]
    fn all_modes_match_the_shared_fixture() {
        let expected: Value =
            serde_json::from_str(include_str!("../../../tests/fixtures/backup.json")).unwrap();
        let file: NewBackupJob =
            toml::from_str(include_str!("../../../tests/fixtures/backup.toml")).unwrap();
        let parameters = from_parameters(CreateParameters {
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
