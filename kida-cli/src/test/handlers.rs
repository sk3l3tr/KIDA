use serde_json::Value;

pub fn protocol_fixture() -> Value {
    serde_json::from_str(include_str!("../../../tests/fixtures/protocol.json")).unwrap()
}

pub fn scheduler_fixture() -> Value {
    serde_json::from_str(include_str!("../../../tests/fixtures/scheduler.json")).unwrap()
}

pub fn backup_health_fixture() -> Value {
    // Shapes serialized by health.rs handlers from BackupHealthExecution and HealthHistoryRecord.
    serde_json::from_str(include_str!("../../../tests/fixtures/backup-health.json")).unwrap()
}

pub fn backup_fixture() -> Value {
    // Shapes serialized by health.rs handlers from BackupHealthExecution and HealthHistoryRecord.
    serde_json::from_str(include_str!("../../../tests/fixtures/backup.json")).unwrap()
}

pub const RUN_ID: &str = "aabbccdd-1234-4567-89ab-0123456789ab";
