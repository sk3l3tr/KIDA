use std::path::PathBuf;

use serde_json::Value;

use super::model::{
    BackupTarget, Compression, Lifecycle, LifecycleCommand, NewBackupJob, RetentionPolicy,
    default_required,
};
use crate::input::{error::InputError, indexed::apply_indexed};

pub fn from_parameters(
    parameters: crate::cli::CreateParameters,
) -> Result<NewBackupJob, InputError> {
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
