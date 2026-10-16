use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Value, json};

use super::{
    error::InputError,
    fields::{Kind, ask},
};
use crate::{
    cli::AddParameters,
    protocol::scheduler::{ScheduleRule, utc},
};

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NewSchedule {
    pub command: String,
    #[serde(deserialize_with = "required_json")]
    pub params: Value,
    pub schedule: ScheduleRule,
}

// A custom deserializer also makes null-valued params mandatory.
fn required_json<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Value, D::Error> {
    Value::deserialize(deserializer)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FileSchedule {
    command: String,
    params: String,
    schedule: ScheduleRule,
}

impl FileSchedule {
    pub fn prepare(self) -> Result<NewSchedule, InputError> {
        Ok(NewSchedule {
            command: self.command,
            params: serde_json::from_str(&self.params).map_err(|e| InputError::new("params", e))?,
            schedule: self.schedule,
        })
    }
}

pub fn from_parameters(p: AddParameters) -> Result<NewSchedule, InputError> {
    if p.timezone.is_some() && p.cron.is_none() {
        return Err(InputError::new("timezone", "--timezone requires --cron"));
    }
    let schedule = match (p.at, p.seconds, p.cron) {
        (Some(at), None, None) => ScheduleRule::Once { at },
        (None, Some(seconds), None) => ScheduleRule::Interval { seconds },
        (None, None, Some(expression)) => ScheduleRule::Cron {
            expression,
            timezone: p.timezone.unwrap_or_else(utc),
        },
        _ => {
            return Err(InputError::new(
                "schedule",
                "exactly one of --at, --seconds or --cron is required",
            ));
        }
    };
    Ok(NewSchedule {
        command: p
            .command
            .ok_or_else(|| InputError::new("command", "--command is required"))?,
        params: serde_json::from_str(
            &p.params
                .ok_or_else(|| InputError::new("params", "--params is required"))?,
        )
        .map_err(|e| InputError::new("params", e))?,
        schedule,
    })
}

pub fn wizard(
    reader: &mut impl std::io::BufRead,
    writer: &mut impl std::io::Write,
) -> Result<NewSchedule, InputError> {
    let command = ask(
        &Kind::String,
        "Command to schedule (example: backup.run)",
        reader,
        writer,
    )?;
    let params = ask(
        &Kind::Json,
        "Command parameters as JSON (example: {\"name\":\"daily\"}, or null)",
        reader,
        writer,
    )?;
    let rule = ask(
        &Kind::Choice(&["once", "interval", "cron"]),
        "Schedule type",
        reader,
        writer,
    )?;
    let schedule = match rule.as_str().unwrap() {
        "once" => {
            json!({"type":"once", "at":ask(&Kind::String, "Execution time in RFC3339 (example: 2030-01-01T12:00:00Z)", reader, writer)?})
        }
        "interval" => {
            json!({"type":"interval", "seconds":ask(&Kind::U64, "Interval in seconds (unsigned integer, example: 3600)", reader, writer)?})
        }
        "cron" => json!({"type":"cron",
            "expression":ask(&Kind::String, "Cron expression (example: 30 2 * * *)", reader, writer)?,
            "timezone":ask(&Kind::Default(Box::new(Kind::String), json!("UTC")), "IANA timezone (example: Europe/Madrid)", reader, writer)?}),
        _ => unreachable!(),
    };
    serde_json::from_value(json!({"command":command, "params":params, "schedule":schedule}))
        .map_err(|e| InputError::new("schedule", e))
}
