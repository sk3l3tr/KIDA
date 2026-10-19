use serde_json::{Map, Value};

use crate::protocol::command::CommandResponse;
use crate::renderer::error::RenderError;
use crate::renderer::json::{array, boolean, data, object, string, value_object};

const JOB_SEPARATOR: &str = "------------------------------------------------------------";

pub fn create(response: &CommandResponse) -> Result<String, RenderError> {
    let data = data(response)?;
    let id = string(data, "id", "data.id")?;
    let name = string(data, "name", "data.name")?;

    Ok(format!("Backup job {name} created (ID: {id})."))
}

pub fn delete(response: &CommandResponse) -> Result<String, RenderError> {
    let data = data(response)?;
    let id = string(data, "id", "data.id")?;
    let name = string(data, "name", "data.name")?;

    Ok(format!("Backup job {name} deleted (ID: {id})."))
}

pub fn list(response: &CommandResponse) -> Result<String, RenderError> {
    let backups = array(data(response)?, "backups", "data.backups")?;

    if backups.is_empty() {
        return Ok("No backup jobs found.".to_string());
    }

    backups
        .iter()
        .enumerate()
        .map(|(index, value)| render_job(value, &format!("data.backups[{index}]")))
        .collect::<Result<Vec<_>, _>>()
        .map(|jobs| jobs.join(&format!("\n{JOB_SEPARATOR}\n")))
}

fn render_job(value: &Value, path: &str) -> Result<String, RenderError> {
    let job = value_object(value, path)?;
    let name = string(job, "name", &format!("{path}.name"))?;
    let id = string(job, "id", &format!("{path}.id"))?;
    let compression = string(job, "compression", &format!("{path}.compression"))?;
    let sources = array(job, "sources", &format!("{path}.sources"))?;
    let targets = array(job, "targets", &format!("{path}.targets"))?;
    let lifecycle = object(job, "lifecycle", &format!("{path}.lifecycle"))?;
    let pre_backup = array(
        lifecycle,
        "pre_backup",
        &format!("{path}.lifecycle.pre_backup"),
    )?;
    let post_backup = array(
        lifecycle,
        "post_backup",
        &format!("{path}.lifecycle.post_backup"),
    )?;

    let mut lines = vec![
        format!("Name: {name}"),
        format!("ID: {id}"),
        format!("Compression: {compression}"),
    ];

    match job.get("schedule") {
        Some(schedule) => {
            lines.push("Schedule:".to_string());
            lines.extend(indented_json(schedule, 2));
        }
        None => lines.push("Schedule: Not scheduled".to_string()),
    }

    lines.push("Sources:".to_string());
    for (index, source) in sources.iter().enumerate() {
        let source = source
            .as_str()
            .ok_or_else(|| RenderError::invalid(&format!("{path}.sources[{index}]"), "a string"))?;
        lines.push(format!("  - {source}"));
    }

    lines.push("Targets:".to_string());
    for (index, value) in targets.iter().enumerate() {
        let target_path = format!("{path}.targets[{index}]");
        let target = value_object(value, &target_path)?;
        let destination = string(target, "path", &format!("{target_path}.path"))?;
        let requirement = if boolean(target, "required", &format!("{target_path}.required"))? {
            "required"
        } else {
            "optional"
        };
        let filesystem_uuid = optional_string(
            target,
            "filesystem_uuid",
            &format!("{target_path}.filesystem_uuid"),
        )?
        .unwrap_or("not set");
        lines.push(format!(
            "  - {destination} ({requirement}, filesystem UUID: {filesystem_uuid})"
        ));
    }

    lines.push("Lifecycle:".to_string());
    render_operations(&mut lines, "Pre-backup", pre_backup);
    render_operations(&mut lines, "Post-backup", post_backup);

    match job.get("retention") {
        None => lines.push("Retention: None".to_string()),
        Some(value) => render_retention(&mut lines, value, &format!("{path}.retention"))?,
    }

    Ok(lines.join("\n"))
}

fn render_operations(lines: &mut Vec<String>, label: &str, operations: &[Value]) {
    if operations.is_empty() {
        lines.push(format!("  {label}: None"));
        return;
    }

    lines.push(format!("  {label}:"));
    for operation in operations {
        let mut json = indented_json(operation, 6);
        if let Some(first) = json.first_mut() {
            *first = format!("    - {}", first.trim_start());
        }
        lines.extend(json);
    }
}

fn render_retention(lines: &mut Vec<String>, value: &Value, path: &str) -> Result<(), RenderError> {
    let retention = value_object(value, path)?;
    let max_age =
        optional_string(retention, "max_age", &format!("{path}.max_age"))?.unwrap_or("not set");
    let keep_last = optional_u64(retention, "keep_last", &format!("{path}.keep_last"))?
        .map_or_else(|| "not set".to_string(), |value| value.to_string());
    let protected = array(
        retention,
        "protected_restore_points",
        &format!("{path}.protected_restore_points"),
    )?;

    lines.push("Retention:".to_string());
    lines.push(format!("  Max age: {max_age}"));
    lines.push(format!("  Keep last: {keep_last}"));
    if protected.is_empty() {
        lines.push("  Protected restore points: None".to_string());
    } else {
        lines.push("  Protected restore points:".to_string());
        for (index, value) in protected.iter().enumerate() {
            let restore_point = value.as_str().ok_or_else(|| {
                RenderError::invalid(
                    &format!("{path}.protected_restore_points[{index}]"),
                    "a string",
                )
            })?;
            lines.push(format!("    - {restore_point}"));
        }
    }

    Ok(())
}

fn optional_string<'a>(
    object: &'a Map<String, Value>,
    key: &str,
    path: &str,
) -> Result<Option<&'a str>, RenderError> {
    match object.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => value
            .as_str()
            .map(Some)
            .ok_or_else(|| RenderError::invalid(path, "a string or null")),
    }
}

fn optional_u64(
    object: &Map<String, Value>,
    key: &str,
    path: &str,
) -> Result<Option<u64>, RenderError> {
    match object.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => value
            .as_u64()
            .map(Some)
            .ok_or_else(|| RenderError::invalid(path, "a non-negative integer or null")),
    }
}

fn indented_json(value: &Value, spaces: usize) -> Vec<String> {
    let prefix = " ".repeat(spaces);
    serde_json::to_string_pretty(value)
        .expect("serializing a JSON value cannot fail")
        .lines()
        .map(|line| format!("{prefix}{line}"))
        .collect()
}
