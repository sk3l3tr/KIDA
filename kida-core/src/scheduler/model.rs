use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NewSchedule {
    pub command: String,

    #[serde(deserialize_with = "deserialize_params")]
    pub params: Value,

    pub schedule: ScheduleRule,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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

        #[serde(default = "default_timezone")]
        timezone: String,
    },
}

fn deserialize_params<'de, D>(deserializer: D) -> Result<Value, D::Error>
where
    D: Deserializer<'de>,
{
    Value::deserialize(deserializer)
}

fn default_timezone() -> String {
    "UTC".to_string()
}
