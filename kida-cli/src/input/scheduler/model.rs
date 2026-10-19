use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

use crate::{input::error::InputError, protocol::scheduler::ScheduleRule};

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NewSchedule {
    pub command: String,
    #[serde(deserialize_with = "required_json")]
    pub params: Value,
    pub schedule: ScheduleRule,
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

// A custom deserializer also makes null-valued params mandatory.
fn required_json<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Value, D::Error> {
    Value::deserialize(deserializer)
}
