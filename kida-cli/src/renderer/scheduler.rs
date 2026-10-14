use serde_json::Value;

use super::{
    error::RenderError,
    json::{data, field, string, value_object},
};
use crate::{input::scheduler::ScheduleRule, protocol::CommandResponse};

pub fn add(response: &CommandResponse) -> Result<String, RenderError> {
    confirmation(response, "added")
}

pub fn delete(response: &CommandResponse) -> Result<String, RenderError> {
    confirmation(response, "deleted")
}

fn confirmation(response: &CommandResponse, action: &str) -> Result<String, RenderError> {
    let object = data(response)?;
    let id = string(object, "id", "data.id")?;
    string(object, "command", "data.command")?;
    field(object, "params", "data.params")?;
    rule(field(object, "schedule", "data.schedule")?, "data.schedule")?;
    Ok(format!("Schedule {action} (ID: {id})."))
}

pub fn list(response: &CommandResponse) -> Result<String, RenderError> {
    let schedules = response
        .data
        .as_ref()
        .ok_or_else(|| RenderError::missing("data"))?
        .as_array()
        .ok_or_else(|| RenderError::invalid("data", "an array"))?;
    if schedules.is_empty() {
        return Ok("No schedules found.".into());
    }
    schedules.iter().enumerate().map(|(index, value)| {
        let path = format!("data[{index}]");
        let object = value_object(value, &path)?;
        let id = string(object, "id", &format!("{path}.id"))?;
        let command = string(object, "command", &format!("{path}.command"))?;
        let params = field(object, "params", &format!("{path}.params"))?;
        let schedule = rule(field(object, "schedule", &format!("{path}.schedule"))?, &format!("{path}.schedule"))?;
        let next = string(object, "next_enqueue_at", &format!("{path}.next_enqueue_at"))?;
        Ok(format!("ID: {id}\nCommand: {command}\nParameters: {params}\nSchedule: {schedule}\nNext enqueue attempt: {next}"))
    }).collect::<Result<Vec<_>, RenderError>>()
        .map(|blocks| blocks.join("\n------------------------------------------------------------\n"))
}

fn rule(value: &Value, path: &str) -> Result<String, RenderError> {
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
