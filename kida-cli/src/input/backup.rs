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

    let mut targets: Vec<BackupTarget> = parameters
        .targets
        .into_iter()
        .map(|path| BackupTarget {
            path: path.into(),
            required: default_required(),
            filesystem_uuid: None,
        })
        .collect();

    apply_indexed(
        &mut targets,
        &parameters.target_required,
        "targets.required",
        |target, required: bool| target.required = required,
    )?;

    apply_indexed(
        &mut targets,
        &parameters.target_filesystem_uuid,
        "targets.filesystem_uuid",
        |target, uuid: String| target.filesystem_uuid = Some(uuid),
    )?;

    let commands = |commands: Vec<String>| {
        commands
            .into_iter()
            .map(|command| LifecycleCommand {
                command,
                params: Value::Null,
            })
            .collect::<Vec<_>>()
    };

    let mut pre_backup = commands(parameters.pre_backup);
    let mut post_backup = commands(parameters.post_backup);

    apply_indexed(
        &mut pre_backup,
        &parameters.pre_backup_params,
        "lifecycle.pre_backup.params",
        |command, params: Value| command.params = params,
    )?;

    apply_indexed(
        &mut post_backup,
        &parameters.post_backup_params,
        "lifecycle.post_backup.params",
        |command, params: Value| command.params = params,
    )?;

    let compression = parameters
        .compression
        .map(|compression| {
            serde_json::from_value::<Compression>(Value::String(compression))
                .map_err(|error| InputError::new("compression", error))
        })
        .transpose()?
        .unwrap_or_default();

    let schedule = parameters
        .schedule
        .map(|schedule| {
            serde_json::from_str::<Value>(&schedule)
                .map_err(|error| InputError::new("schedule", error))
        })
        .transpose()?
        .filter(|value| !value.is_null());

    let retention = if parameters.retention_max_age.is_some()
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

        Some(RetentionPolicy {
            max_age: parameters.retention_max_age,
            keep_last,
            protected_restore_points: parameters.retention_protected_restore_points,
        })
    } else {
        None
    };

    Ok(NewBackupJob {
        name,
        sources: parameters.sources.into_iter().map(PathBuf::from).collect(),
        targets,
        compression,
        lifecycle: Lifecycle {
            pre_backup,
            post_backup,
        },
        schedule,
        retention,
    })
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
