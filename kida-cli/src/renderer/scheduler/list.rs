use crate::{
    protocol::command::CommandResponse,
    renderer::{
        error::RenderError,
        json::{field, string, value_object},
        scheduler::helpers::{origin, rule},
    },
};

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
        let origin = origin(field(object, "origin", &format!("{path}.origin"))?, &format!("{path}.origin"))?;
        let command = string(object, "command", &format!("{path}.command"))?;
        let params = field(object, "params", &format!("{path}.params"))?;
        let schedule = rule(field(object, "schedule", &format!("{path}.schedule"))?, &format!("{path}.schedule"))?;
        let next = string(object, "next_enqueue_at", &format!("{path}.next_enqueue_at"))?;
        Ok(format!("ID: {id}\nOrigin: {origin}\nCommand: {command}\nParameters: {params}\nSchedule: {schedule}\nNext enqueue attempt: {next}"))
    }).collect::<Result<Vec<_>, RenderError>>()
        .map(|blocks| blocks.join("\n------------------------------------------------------------\n"))
}
