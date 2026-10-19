use serde_json::{Map, Value};

use crate::protocol::command::CommandResponse;
use crate::renderer::{
    RenderError,
    format::{table, unknown},
    json::{array, boolean, data, field, nullable_string, object, string, u64_value, value_object},
};

type Object = Map<String, Value>;

fn choice<'a>(value: &'a Object, key: &str, choices: &[&str]) -> Result<&'a str, RenderError> {
    let text = string(value, key, key)?;
    if !choices.contains(&text) {
        return Err(RenderError::invalid(key, &choices.join(" / ")));
    }
    Ok(text)
}

fn run_id(value: &Object) -> Result<&str, RenderError> {
    let id = string(value, "run_id", "run_id")?;
    uuid::Uuid::parse_str(id).map_err(|_| RenderError::invalid("run_id", "a UUID"))?;
    Ok(id)
}

fn strings(value: &Object, key: &str) -> Result<Vec<String>, RenderError> {
    array(value, key, key)?
        .iter()
        .map(|item| {
            item.as_str()
                .map(str::to_owned)
                .ok_or_else(|| RenderError::invalid(key, "an array of strings"))
        })
        .collect()
}

fn state(value: &Object) -> Result<&str, RenderError> {
    choice(
        value,
        "state",
        &["CREATED", "STARTING", "RUNNING", "STOPPED", "ERROR"],
    )
}

fn result(value: &Object) -> Result<&str, RenderError> {
    choice(
        value,
        "result",
        &["FAILED", "UNHEALTHY", "UNKNOWN", "DEGRADED", "HEALTHY"],
    )
}

fn summary(value: &Object) -> Result<Vec<String>, RenderError> {
    let definition = object(value, "definition", "definition")?;
    let diagnosis = object(value, "diagnosis", "diagnosis")?;
    let cleanup = object(value, "cleanup", "cleanup")?;
    Ok(vec![
        run_id(value)?.into(),
        format!(
            "{} ({})",
            string(definition, "name", "definition.name")?,
            string(definition, "id", "definition.id")?
        ),
        choice(value, "mode", &["AUTOMATIC", "MANUAL"])?.into(),
        state(value)?.into(),
        result(diagnosis)?.into(),
        choice(cleanup, "state", &["PENDING", "COMPLETED", "ERROR"])?.into(),
    ])
}

pub fn create(response: &CommandResponse) -> Result<String, RenderError> {
    let value = data(response)?;
    detail(response)?;
    if state(value)? != "CREATED" {
        return Err(RenderError::invalid("state", "CREATED"));
    }
    Ok(format!(
        "Backup Health created (Run ID: {}, state: CREATED).",
        run_id(value)?
    ))
}

pub fn queued(response: &CommandResponse) -> Result<String, RenderError> {
    let value = data(response)?;
    choice(value, "state", &["STARTING"])?;
    let execution_id = string(value, "execution_id", "execution_id")?;
    if execution_id.is_empty() {
        return Err(RenderError::invalid("execution_id", "a non-empty string"));
    }
    Ok(format!(
        "Backup Health admitted (Run ID: {}, state: STARTING, Queue execution ID: {execution_id}).",
        run_id(value)?
    ))
}

pub fn list(response: &CommandResponse) -> Result<String, RenderError> {
    let values = response
        .data
        .as_ref()
        .ok_or_else(|| RenderError::missing("data"))?
        .as_array()
        .ok_or_else(|| RenderError::invalid("data", "an array"))?;
    let rows = values
        .iter()
        .map(|value| summary(value_object(value, "data[]")?))
        .collect::<Result<Vec<_>, _>>()?;
    if rows.is_empty() {
        return Ok("No Backup Health executions found.".into());
    }
    Ok(table(
        &[
            "RUN ID",
            "DEFINITION",
            "MODE",
            "STATE",
            "TECHNICAL RESULT",
            "CLEANUP",
        ],
        &rows,
    ))
}

pub fn detail(response: &CommandResponse) -> Result<String, RenderError> {
    let value = data(response)?;
    let row = summary(value)?;
    let diagnosis = object(value, "diagnosis", "diagnosis")?;
    let cleanup = object(value, "cleanup", "cleanup")?;
    let mut lines = vec![
        format!("Run ID: {}", row[0]),
        format!("Definition: {}", row[1]),
        format!(
            "Definition path (CORE): {}",
            string(value, "definition_path", "definition_path")?
        ),
        format!("Mode: {}", row[2]),
        format!("Operational state: {}", row[3]),
        format!("Technical result: {}", row[4]),
        format!(
            "Diagnosis complete: {}",
            boolean(diagnosis, "complete", "diagnosis.complete")?
        ),
        format!(
            "Diagnosis: {}",
            string(diagnosis, "summary", "diagnosis.summary")?
        ),
        format!("Created: {}", string(value, "created_at", "created_at")?),
        format!(
            "Started: {}",
            unknown(nullable_string(value, "started_at", "started_at")?)
        ),
        format!(
            "Finished: {}",
            unknown(nullable_string(value, "finished_at", "finished_at")?)
        ),
        format!(
            "Compose (CORE): {}",
            string(value, "compose_path", "compose_path")?
        ),
        format!(
            "Compose checksum: {}",
            unknown(nullable_string(
                value,
                "compose_checksum",
                "compose_checksum"
            )?)
        ),
        format!(
            "Restore directory (CORE): {}",
            string(value, "restore_dir", "restore_dir")?
        ),
        format!("Cleanup: {}", row[5]),
        format!(
            "Report (CORE): {}",
            nullable_string(value, "report_path", "report_path")?.unwrap_or("not available")
        ),
    ];
    let artifact = field(value, "artifact", "artifact")?;
    if artifact.is_null() {
        lines.push("Artifact: not selected".into());
    } else {
        let artifact = value_object(artifact, "artifact")?;
        for key in [
            "artifact_id",
            "job_id",
            "artifact_name",
            "created_at",
            "path",
            "checksum",
        ] {
            lines.push(format!("Artifact {key}: {}", string(artifact, key, key)?));
        }
        lines.push(format!(
            "Artifact size: {} bytes",
            u64_value(artifact, "size", "artifact.size")?
        ));
    }
    for service in array(diagnosis, "services", "diagnosis.services")? {
        let service = value_object(service, "diagnosis.services[]")?;
        lines.push(format!(
            "Service {}: {}",
            string(service, "service", "service")?,
            result(service)?
        ));
        lines.extend(
            strings(service, "reasons")?
                .into_iter()
                .map(|reason| format!("  Reason: {reason}")),
        );
    }
    lines.extend(
        strings(diagnosis, "anomalies")?
            .into_iter()
            .map(|text| format!("Anomaly: {text}")),
    );
    for evidence in array(diagnosis, "evidence", "diagnosis.evidence")? {
        let evidence = value_object(evidence, "evidence")?;
        lines.push(format!(
            "Evidence [{}] service={} container={}: {}",
            string(evidence, "observed_at", "observed_at")?,
            unknown(nullable_string(evidence, "service", "service")?),
            unknown(nullable_string(evidence, "container_id", "container_id")?),
            string(evidence, "description", "description")?
        ));
        if let Some(logs) = nullable_string(evidence, "logs", "logs")? {
            lines.push(format!("Logs: {logs}"));
        }
    }
    lines.extend(
        strings(cleanup, "errors")?
            .into_iter()
            .map(|text| format!("Cleanup error: {text}")),
    );
    Ok(lines.join("\n"))
}

pub fn report_list(response: &CommandResponse) -> Result<String, RenderError> {
    let values = response
        .data
        .as_ref()
        .ok_or_else(|| RenderError::missing("data"))?
        .as_array()
        .ok_or_else(|| RenderError::invalid("data", "an array"))?;
    let mut lines: Vec<String> = vec!["Available Backup Health reports (Run IDs):".into()];
    for value in values {
        let id = value
            .as_str()
            .ok_or_else(|| RenderError::invalid("data[]", "a UUID string"))?;
        uuid::Uuid::parse_str(id).map_err(|_| RenderError::invalid("data[]", "a UUID string"))?;
        lines.push(id.into());
    }
    if values.is_empty() {
        return Ok("No Backup Health reports found.".into());
    }
    Ok(lines.join("\n"))
}

pub fn report_get(response: &CommandResponse) -> Result<String, RenderError> {
    let value = data(response)?;
    run_id(value)?;
    Ok(string(value, "markdown", "markdown")?.into())
}

pub fn report_delete(response: &CommandResponse) -> Result<String, RenderError> {
    let value = data(response)?;
    if !boolean(value, "deleted", "deleted")? {
        return Err(RenderError::invalid("deleted", "true"));
    }
    Ok(format!(
        "Backup Health report deleted (Run ID: {}).",
        run_id(value)?
    ))
}
