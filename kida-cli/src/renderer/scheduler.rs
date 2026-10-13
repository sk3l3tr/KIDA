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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::CommandStatus;
    use serde_json::json;

    fn response(data: Value) -> CommandResponse {
        CommandResponse {
            id: "request".into(),
            status: CommandStatus::Ok,
            data: Some(data),
            error: None,
        }
    }

    fn entry(id: &str, schedule: Value) -> Value {
        json!({"id":id,"command":"backup.run","params":null,"schedule":schedule,"next_enqueue_at":"2030-01-01T12:00:00Z"})
    }

    #[test]
    fn renders_empty_multiple_schedules_and_confirmations() {
        assert_eq!(
            super::super::render("scheduler.list", &response(json!([]))).unwrap(),
            "No schedules found."
        );
        let once = entry("first", json!({"type":"once","at":"2030-01-01T12:00:00Z"}));
        let interval = entry("second", json!({"type":"interval","seconds":60}));
        let mut cron = entry(
            "third",
            json!({"type":"cron","expression":"30 2 * * *","timezone":"Europe/Madrid"}),
        );
        cron["params"] = json!({"name":"daily","items":[null,true,3]});
        let output = list(&response(json!([once, interval, cron]))).unwrap();
        assert!(output.find("ID: first").unwrap() < output.find("ID: second").unwrap());
        assert!(output.find("ID: second").unwrap() < output.find("ID: third").unwrap());
        for text in [
            "Command: backup.run",
            "Parameters: null",
            "once at 2030",
            "every 60 seconds",
            "cron 30 2 * * * (Europe/Madrid)",
            "Next enqueue attempt: 2030",
            "[null,true,3]",
        ] {
            assert!(output.contains(text), "{output}");
        }
        assert_eq!(
            add(&response(once.clone())).unwrap(),
            "Schedule added (ID: first)."
        );
        assert_eq!(
            delete(&response(once)).unwrap(),
            "Schedule deleted (ID: first)."
        );
    }

    #[test]
    fn malformed_responses_return_render_errors_without_fallback() {
        for value in [Value::Null, json!({}), json!([null]), json!([{}])] {
            assert!(super::super::render("scheduler.list", &response(value)).is_err());
        }
        let base = entry("id", json!({"type":"interval","seconds":60}));
        for key in ["id", "command", "params", "schedule", "next_enqueue_at"] {
            let mut value = base.clone();
            value.as_object_mut().unwrap().remove(key);
            assert!(list(&response(json!([value]))).is_err(), "{key}");
        }
        for (key, bad) in [
            ("id", json!(1)),
            ("command", json!([])),
            ("next_enqueue_at", Value::Null),
            ("schedule", json!({"type":"interval","seconds":-1})),
            ("schedule", json!({"type":"once","at":"future","seconds":1})),
            ("schedule", json!({"type":"cron","expression":"* * * * *"})),
            ("schedule", json!({"type":"other"})),
        ] {
            let mut value = base.clone();
            value[key] = bad;
            assert!(list(&response(json!([value]))).is_err());
        }
        for command in ["scheduler.add", "scheduler.delete"] {
            assert!(super::super::render(command, &response(json!({"id":"id"}))).is_err());
        }
    }
}
