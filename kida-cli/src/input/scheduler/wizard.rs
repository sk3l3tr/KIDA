use serde_json::json;

use crate::input::{
    error::InputError,
    fields::{Kind, ask},
};

use super::model::NewSchedule;

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
