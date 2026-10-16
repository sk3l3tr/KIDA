use serde::{Deserialize, Serialize};

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

pub(crate) fn utc() -> String {
    "UTC".into()
}
