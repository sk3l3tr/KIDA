use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Value, json};

use super::{
    error::InputError,
    fields::{Kind, ask},
};
use crate::cli::AddParameters;

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

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum ScheduleRule {
    Once {
        at: String,
    },
    Interval {
        seconds: u64,
    },
    Cron {
        expression: String,
        #[serde(default = "utc")]
        timezone: String,
    },
}

fn utc() -> String {
    "UTC".into()
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{cli::Cli, input::prepare, protocol::CommandRequest};
    use clap::Parser;

    #[test]
    fn all_modes_match_for_each_rule_and_arbitrary_json() {
        for params in [
            "null",
            "true",
            "42",
            "\"text\"",
            "[null,false,3]",
            "{\"name\":\"daily\"}",
        ] {
            for (flags, table, script, expected) in [
                (
                    vec!["--at", "2030-01-01T12:00:00Z"],
                    "type='once'\nat='2030-01-01T12:00:00Z'",
                    "once\n2030-01-01T12:00:00Z\n",
                    json!({"type":"once","at":"2030-01-01T12:00:00Z"}),
                ),
                (
                    vec!["--seconds", "18446744073709551615"],
                    "type='interval'\nseconds=18446744073709551615",
                    "interval\n18446744073709551615\n",
                    json!({"type":"interval","seconds":u64::MAX}),
                ),
                (
                    vec!["--cron", "30 2 * * *"],
                    "type='cron'\nexpression='30 2 * * *'",
                    "cron\n30 2 * * *\n\n",
                    json!({"type":"cron","expression":"30 2 * * *","timezone":"UTC"}),
                ),
                (
                    vec!["--cron", "30 2 * * *", "--timezone", "Europe/Madrid"],
                    "type='cron'\nexpression='30 2 * * *'\ntimezone='Europe/Madrid'",
                    "cron\n30 2 * * *\nEurope/Madrid\n",
                    json!({"type":"cron","expression":"30 2 * * *","timezone":"Europe/Madrid"}),
                ),
            ] {
                let file: FileSchedule = toml::from_str(&format!(
                    "command='backup.run'\nparams='{params}'\n[schedule]\n{table}"
                ))
                .unwrap();
                let cli = Cli::try_parse_from(
                    [
                        "kida",
                        "scheduler",
                        "add",
                        "--command",
                        "backup.run",
                        "--params",
                        params,
                    ]
                    .into_iter()
                    .chain(flags),
                )
                .unwrap();
                let request = CommandRequest::from(
                    prepare(cli.command, false, &mut &b""[..], &mut Vec::new()).unwrap(),
                );
                let mut prompts = Vec::new();
                let wizard = wizard(
                    &mut format!("backup.run\n{params}\n{script}").as_bytes(),
                    &mut prompts,
                )
                .unwrap();
                assert_eq!(request.command, "scheduler.add");
                for value in [
                    serde_json::to_value(file.prepare().unwrap()).unwrap(),
                    serde_json::to_value(wizard).unwrap(),
                    request.params,
                ] {
                    assert_eq!(
                        value,
                        json!({"command":"backup.run","params":serde_json::from_str::<Value>(params).unwrap(),"schedule":expected})
                    );
                }
                let prompts = String::from_utf8(prompts).unwrap();
                assert_eq!(
                    prompts.contains("IANA timezone"),
                    expected["type"] == "cron"
                );
                assert_eq!(
                    prompts.contains("Interval in seconds"),
                    expected["type"] == "interval"
                );
                assert_eq!(
                    prompts.contains("Execution time"),
                    expected["type"] == "once"
                );
            }
        }
    }

    #[test]
    fn file_rejects_unknown_missing_and_mistyped_fields() {
        let base = "command='backup.run'\nparams='null'\n";
        for content in [
            format!("{base}extra=true\n[schedule]\ntype='once'\nat='future'"),
            format!("{base}[schedule]\ntype='once'\nat='future'\nseconds=1"),
            format!("{base}[schedule]\ntype='interval'\nseconds=-1"),
            format!("{base}[schedule]\ntype='interval'\nseconds='1'"),
            format!("{base}[schedule]\ntype='cron'\nexpression='* * * * *'\nat='future'"),
            format!("{base}[schedule]\ntype='cron'"),
            "command='backup.run'\n[schedule]\ntype='interval'\nseconds=1".into(),
            "command='backup.run'\nparams={}\n[schedule]\ntype='interval'\nseconds=1".into(),
        ] {
            assert!(
                toml::from_str::<FileSchedule>(&content).is_err(),
                "{content}"
            );
        }
        let file: FileSchedule =
            toml::from_str("command='x'\nparams='{'\n[schedule]\ntype='interval'\nseconds=1")
                .unwrap();
        assert!(file.prepare().is_err());
        assert!(
            serde_json::from_value::<NewSchedule>(
                json!({"command":"x","schedule":{"type":"interval","seconds":1}})
            )
            .is_err()
        );
    }

    #[test]
    fn wizard_retries_formats_and_cancels_at_each_question() {
        let mut prompts = Vec::new();
        let job = wizard(
            &mut "x\n{\nnull\nwrong\ninterval\n-1\n18446744073709551616\n0\n".as_bytes(),
            &mut prompts,
        )
        .unwrap();
        assert_eq!(serde_json::to_value(job).unwrap()["schedule"]["seconds"], 0);
        assert_eq!(
            String::from_utf8(prompts)
                .unwrap()
                .matches("try again")
                .count(),
            4
        );
        for script in [
            "x\nnull\nonce\nfuture\n",
            "x\nnull\ninterval\n1\n",
            "x\nnull\ncron\n* * * * *\n\n",
        ] {
            assert!(wizard(&mut &b""[..], &mut Vec::new()).is_err());
            for (index, _) in script[..script.len() - 1].match_indices('\n') {
                assert!(wizard(&mut &script.as_bytes()[..=index], &mut Vec::new()).is_err());
            }
        }
        assert!(
            wizard(&mut "\u{3}\n".as_bytes(), &mut Vec::new())
                .unwrap_err()
                .to_string()
                .contains("interrupt")
        );
    }
}
