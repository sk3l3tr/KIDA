use serde_json::Value;

use crate::{
    protocol::{command::CommandResponse, scheduler::ScheduleRule},
    renderer::{
        error::RenderError,
        json::{data, field, string, value_object},
    },
};

pub fn confirmation(response: &CommandResponse, action: &str) -> Result<String, RenderError> {
    let object = data(response)?;
    let id = string(object, "id", "data.id")?;
    origin(field(object, "origin", "data.origin")?, "data.origin")?;
    string(object, "command", "data.command")?;
    field(object, "params", "data.params")?;
    rule(field(object, "schedule", "data.schedule")?, "data.schedule")?;
    Ok(format!("Schedule {action} (ID: {id})."))
}

pub fn rule(value: &Value, path: &str) -> Result<String, RenderError> {
    let schedule: ScheduleRule = serde_json::from_value(value.clone())
        .map_err(|e| RenderError(format!("invalid {path}: {e}")))?;
    match schedule {
        ScheduleRule::Once { at } => Ok(format!("once at {at}")),
        ScheduleRule::Interval { seconds } => Ok(format!("interval every {seconds} seconds")),
        ScheduleRule::Cron {
            expression,
            timezone,
        } => {
            string(
                value_object(value, path)?,
                "timezone",
                &format!("{path}.timezone"),
            )?;
            Ok(format!("cron {expression} ({timezone})"))
        }
    }
}

pub fn origin<'a>(value: &'a Value, path: &str) -> Result<&'a str, RenderError> {
    match value.as_str() {
        Some(origin @ ("USER" | "INTERNAL")) => Ok(origin),
        _ => Err(RenderError::invalid(path, "USER or INTERNAL")),
    }
}
