use super::model::NewSchedule;
use crate::{
    cli::AddParameters,
    input::error::InputError,
    protocol::scheduler::{ScheduleRule, utc},
};

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
