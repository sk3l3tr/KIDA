use serde_json::{Map, Value};

use crate::protocol::CommandResponse;

use super::{RenderError, array, boolean, data, string, value_object};

const JOB_SEPARATOR: &str = "------------------------------------------------------------";

pub(super) fn create(response: &CommandResponse) -> Result<String, RenderError> {
    let data = data(response)?;
    let id = string(data, "id", "data.id")?;
    let name = string(data, "name", "data.name")?;

    Ok(format!("Backup job {name} created (ID: {id})."))
}

pub(super) fn delete(response: &CommandResponse) -> Result<String, RenderError> {
    let data = data(response)?;
    let id = string(data, "id", "data.id")?;
    let name = string(data, "name", "data.name")?;

    Ok(format!("Backup job {name} deleted (ID: {id})."))
}

pub(super) fn list(response: &CommandResponse) -> Result<String, RenderError> {
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
    let lifecycle = super::object(job, "lifecycle", &format!("{path}.lifecycle"))?;
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

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::*;
    use crate::protocol::CommandStatus;

    fn response(data: Value) -> CommandResponse {
        CommandResponse {
            id: "request-1".into(),
            status: CommandStatus::Ok,
            data: Some(data),
            error: None,
        }
    }

    #[test]
    fn renders_created_backup_job() {
        let output = crate::renderer::render(
            "backup.create",
            &response(json!({
                "id": "backup-1",
                "name": "Nextcloud",
                "sources": ["/srv/nextcloud"]
            })),
        )
        .expect("valid response should render");

        assert_eq!(output, "Backup job Nextcloud created (ID: backup-1).");
    }

    #[test]
    fn rejects_missing_or_invalid_id() {
        assert!(create(&response(json!({"name": "Nextcloud"}))).is_err());
        assert!(create(&response(json!({"id": 1, "name": "Nextcloud"}))).is_err());
    }

    #[test]
    fn rejects_missing_or_invalid_name() {
        assert!(create(&response(json!({"id": "backup-1"}))).is_err());
        assert!(create(&response(json!({"id": "backup-1", "name": false}))).is_err());
    }

    #[test]
    fn renders_deleted_backup_job() {
        let output = crate::renderer::render(
            "backup.delete",
            &response(json!({
                "id": "backup-1",
                "name": "Nextcloud"
            })),
        )
        .expect("valid response should render");

        assert_eq!(output, "Backup job Nextcloud deleted (ID: backup-1).");
    }

    #[test]
    fn delete_rejects_missing_or_invalid_id() {
        assert!(delete(&response(json!({"name": "Nextcloud"}))).is_err());
        assert!(delete(&response(json!({"id": 1, "name": "Nextcloud"}))).is_err());
    }

    #[test]
    fn delete_rejects_missing_or_invalid_name() {
        assert!(delete(&response(json!({"id": "backup-1"}))).is_err());
        assert!(delete(&response(json!({"id": "backup-1", "name": false}))).is_err());
    }

    #[test]
    fn renders_all_backup_jobs_in_core_order_with_full_details() {
        let output = crate::renderer::render(
            "backup.list",
            &response(json!({
                "backups": [
                    {
                        "id": "alpha-id",
                        "name": "Alpha",
                        "sources": ["/srv/alpha", "/etc/alpha"],
                        "targets": [
                            {
                                "path": "/backup/main",
                                "required": true,
                                "filesystem_uuid": "uuid-main"
                            },
                            {
                                "path": "/backup/offsite",
                                "required": false
                            }
                        ],
                        "compression": "tar_zstd",
                        "lifecycle": {
                            "pre_backup": [{"command": ["docker", "stop", "alpha"]}],
                            "post_backup": [{"command": ["docker", "start", "alpha"]}]
                        },
                        "schedule": {"cron": "0 3 * * *", "options": {"enabled": true}},
                        "retention": {
                            "max_age": "30d",
                            "keep_last": 7,
                            "protected_restore_points": ["monthly-1", "monthly-2"]
                        }
                    },
                    {
                        "id": "beta-id",
                        "name": "Beta",
                        "sources": ["/srv/beta"],
                        "targets": [{
                            "path": "/backup/beta",
                            "required": true,
                            "filesystem_uuid": null
                        }],
                        "compression": "tar_zstd",
                        "lifecycle": {"pre_backup": [], "post_backup": []}
                    }
                ]
            })),
        )
        .expect("valid response should render");

        let separator = format!("\n{JOB_SEPARATOR}\n");
        assert_eq!(output.matches(JOB_SEPARATOR).count(), 1);
        assert!(!output.starts_with(JOB_SEPARATOR));
        assert!(!output.ends_with(JOB_SEPARATOR));
        assert!(output.find("Name: Alpha") < output.find("Name: Beta"));
        assert!(output.contains("ID: alpha-id\nCompression: tar_zstd"));
        assert!(output.contains("Schedule:\n  {\n    \"cron\": \"0 3 * * *\""));
        assert!(output.contains("\"options\": {\n      \"enabled\": true"));
        assert!(output.contains("Sources:\n  - /srv/alpha\n  - /etc/alpha"));
        assert!(output.contains("/backup/main (required, filesystem UUID: uuid-main)"));
        assert!(output.contains("/backup/offsite (optional, filesystem UUID: not set)"));
        assert!(output.contains("Pre-backup:\n    - {\n        \"command\": ["));
        assert!(output.contains("Post-backup:\n    - {\n        \"command\": ["));
        assert!(output.contains("Max age: 30d\n  Keep last: 7"));
        assert!(output.contains("Protected restore points:\n    - monthly-1\n    - monthly-2"));
        assert!(output.contains(&format!(
            "{separator}Name: Beta\nID: beta-id\nCompression: tar_zstd\nSchedule: Not scheduled"
        )));
        assert!(output.contains("/backup/beta (required, filesystem UUID: not set)"));
        assert!(output.contains("Pre-backup: None\n  Post-backup: None\nRetention: None"));
    }

    #[test]
    fn renders_an_empty_backup_collection() {
        assert_eq!(
            list(&response(json!({"backups": []}))).unwrap(),
            "No backup jobs found."
        );
    }

    #[test]
    fn rejects_invalid_list_contracts() {
        let valid_job = json!({
            "id": "backup-1",
            "name": "Backup",
            "sources": ["/srv/data"],
            "targets": [{"path": "/backup", "required": true}],
            "compression": "tar_zstd",
            "lifecycle": {"pre_backup": [], "post_backup": []}
        });

        let missing_data = CommandResponse {
            id: "request-1".into(),
            status: CommandStatus::Ok,
            data: None,
            error: None,
        };
        assert!(list(&missing_data).is_err());
        assert!(list(&response(json!([]))).is_err());
        assert!(list(&response(json!({}))).is_err());
        assert!(list(&response(json!({"backups": {}}))).is_err());
        assert!(list(&response(json!({"backups": [false]}))).is_err());

        for field in [
            "id",
            "name",
            "sources",
            "targets",
            "compression",
            "lifecycle",
        ] {
            let mut job = valid_job.clone();
            job.as_object_mut().unwrap().remove(field);
            assert!(
                list(&response(json!({"backups": [job]}))).is_err(),
                "missing {field} should fail"
            );
        }

        let invalid_jobs = [
            ("id", json!(1)),
            ("name", json!(false)),
            ("sources", json!([false])),
            ("targets", json!([false])),
            ("compression", json!(false)),
            ("lifecycle", json!({"pre_backup": {}, "post_backup": []})),
            ("retention", json!({"protected_restore_points": {}})),
        ]
        .map(|(field, value)| {
            let mut job = valid_job.clone();
            job.as_object_mut().unwrap().insert(field.into(), value);
            job
        });
        for job in invalid_jobs {
            assert!(list(&response(json!({"backups": [job]}))).is_err());
        }

        let invalid_nested_fields = [
            json!({
                "id": "backup-1", "name": "Backup", "sources": ["/srv/data"],
                "targets": [{"required": true}], "compression": "tar_zstd",
                "lifecycle": {"pre_backup": [], "post_backup": []}
            }),
            json!({
                "id": "backup-1", "name": "Backup", "sources": ["/srv/data"],
                "targets": [{"path": "/backup"}], "compression": "tar_zstd",
                "lifecycle": {"pre_backup": [], "post_backup": []}
            }),
            json!({
                "id": "backup-1", "name": "Backup", "sources": ["/srv/data"],
                "targets": [{"path": "/backup", "required": "yes"}],
                "compression": "tar_zstd",
                "lifecycle": {"pre_backup": [], "post_backup": []}
            }),
            json!({
                "id": "backup-1", "name": "Backup", "sources": ["/srv/data"],
                "targets": [{"path": "/backup", "required": true, "filesystem_uuid": 1}],
                "compression": "tar_zstd",
                "lifecycle": {"pre_backup": [], "post_backup": []}
            }),
            json!({
                "id": "backup-1", "name": "Backup", "sources": ["/srv/data"],
                "targets": [{"path": "/backup", "required": true}],
                "compression": "tar_zstd", "lifecycle": {"pre_backup": []}
            }),
            json!({
                "id": "backup-1", "name": "Backup", "sources": ["/srv/data"],
                "targets": [{"path": "/backup", "required": true}],
                "compression": "tar_zstd",
                "lifecycle": {"pre_backup": [], "post_backup": []},
                "retention": {"keep_last": "7", "protected_restore_points": []}
            }),
        ];
        for job in invalid_nested_fields {
            assert!(list(&response(json!({"backups": [job]}))).is_err());
        }
    }

    #[test]
    fn backup_create_and_delete_renderers_remain_registered() {
        assert_eq!(
            crate::renderer::render(
                "backup.create",
                &response(json!({"id": "backup-1", "name": "Backup"}))
            )
            .unwrap(),
            "Backup job Backup created (ID: backup-1)."
        );
        assert_eq!(
            crate::renderer::render(
                "backup.delete",
                &response(json!({"id": "backup-1", "name": "Backup"}))
            )
            .unwrap(),
            "Backup job Backup deleted (ID: backup-1)."
        );
    }
}
