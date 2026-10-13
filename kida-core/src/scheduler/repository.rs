use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::storage::{Storage, StorageError, TomlStorage};

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
struct ScheduleDocument {
    schedules: Vec<StoredSchedule>,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn toml_preserves_json_params() {
        let values = [
            Value::Null,
            serde_json::json!({
                "nested": [null, true, {"text": "línea\n\"texto\""}],
                "integer": 18446744073709551615_u64,
                "decimal": 1.25
            }),
        ];

        for params in values {
            let document = ScheduleDocument {
                schedules: vec![StoredSchedule {
                    id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
                    command: "health".to_string(),
                    params: params.clone(),
                    schedule: ScheduleRule::Interval { seconds: 60 },
                    anchor_at: "2026-10-10T12:00:00Z".to_string(),
                }],
            };

            let encoded = toml::to_string_pretty(&document).unwrap();
            let decoded: ScheduleDocument = toml::from_str(&encoded).unwrap();

            assert_eq!(decoded.schedules[0].params, params);
        }
    }
}
