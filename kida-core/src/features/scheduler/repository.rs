use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::infrastructure::storage::{Storage, StorageError, TomlStorage};

use super::model::ScheduleRule;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StoredSchedule {
    pub id: String,
    pub command: String,

    #[serde(with = "json_params")]
    pub params: Value,

    pub schedule: ScheduleRule,
    pub anchor_at: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScheduleDocument {
    pub(crate) schedules: Vec<StoredSchedule>,
}

pub struct ScheduleRepository {
    storage: TomlStorage<ScheduleDocument>,
}

impl ScheduleRepository {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self {
            storage: TomlStorage::new(path),
        }
    }

    pub fn load(&self) -> Result<Vec<StoredSchedule>, StorageError> {
        match self.storage.load() {
            Ok(document) => Ok(document.schedules),
            Err(StorageError::NotFound { .. }) => Ok(Vec::new()),
            Err(error) => Err(error),
        }
    }

    pub fn save(&self, schedules: &[StoredSchedule]) -> Result<(), StorageError> {
        self.storage.save(&ScheduleDocument {
            schedules: schedules.to_vec(),
        })
    }
}

mod json_params {
    use serde::{Deserialize, Deserializer, Serializer};
    use serde_json::Value;

    pub fn serialize<S>(value: &Value, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let encoded = serde_json::to_string(value).map_err(serde::ser::Error::custom)?;

        serializer.serialize_str(&encoded)
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<Value, D::Error>
    where
        D: Deserializer<'de>,
    {
        let encoded = String::deserialize(deserializer)?;

        serde_json::from_str(&encoded).map_err(serde::de::Error::custom)
    }
}
