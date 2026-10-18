use chrono::{DateTime, TimeDelta, Utc};
use serde::Serialize;
use serde_json::json;

use super::{
    model::{BackupHealthExecution, BackupHealthMode, BackupHealthState, HealthCleanupState},
    service::HealthService,
};
use crate::features::scheduler::{
    model::{NewSchedule, ScheduleOriginFilter, ScheduleRule},
    service::ScheduleService,
};

pub const EXPIRE: &str = "backup.health.expire";
pub const RETAIN: &str = "backup.health.retain";

#[derive(Default, Serialize)]
pub struct MaintenanceResult {
    pub processed: Vec<String>,
    pub errors: Vec<String>,
}

/// Keep matching schedules stable across restarts and remove only our duplicates.
pub fn register_jobs(scheduler: &mut ScheduleService, now: DateTime<Utc>) -> Result<(), String> {
    for (command, seconds) in [(EXPIRE, 60), (RETAIN, 86400)] {
        let jobs = scheduler.list_by_origin(ScheduleOriginFilter::Internal);
        let mut matching = jobs
            .as_array()
            .unwrap()
            .iter()
            .filter(|job| job["command"] == command);
        let input = || NewSchedule {
            command: command.into(),
            params: json!({}),
            schedule: ScheduleRule::Interval { seconds },
        };
        if let Some(first) = matching.next() {
            if first["params"] != json!({})
                || first["schedule"] != json!({"type": "interval", "seconds": seconds})
            {
                scheduler.replace_internal(first["id"].as_str().unwrap(), input(), now)?;
            }
            for duplicate in matching {
                scheduler.delete_internal(duplicate["id"].as_str().unwrap())?;
            }
        } else {
            scheduler.add_internal(input(), now)?;
        }
    }
    Ok(())
}

/// Called before transports start. No previous execution is resumed.
pub async fn startup(
    service: &HealthService,
    now: DateTime<Utc>,
) -> Result<MaintenanceResult, String> {
    let repaired = service
        .repository()
        .reconcile()
        .map_err(|error| error.to_string())?;
    let mut result = MaintenanceResult {
        errors: repaired.errors,
        ..Default::default()
    };
    for record in service.records().await? {
        let run = record.execution;
        let operation = if matches!(
            run.state,
            BackupHealthState::Created | BackupHealthState::Starting | BackupHealthState::Running
        ) {
            service.interrupt(&run.run_id, now).await.map(|_| ())
        } else if run.cleanup.state != HealthCleanupState::Completed {
            service.delete(&run.run_id).await.map(|_| ())
        } else {
            continue;
        };
        record_result(&mut result, &run.run_id, operation);
    }
    Ok(result)
}

/// TTL uses admission time; reads never extend it. Retry cleanup in this same pass.
pub async fn expire(
    service: &HealthService,
    now: DateTime<Utc>,
) -> Result<MaintenanceResult, String> {
    let mut result = MaintenanceResult::default();
    for record in service.records().await? {
        let run = record.execution;
        let pending = run.cleanup.state == HealthCleanupState::Error
            || (run.state == BackupHealthState::Error
                && run.cleanup.state == HealthCleanupState::Pending);
        if pending || expired(&run, now, service.config().manual_ttl_hours) {
            record_result(
                &mut result,
                &run.run_id,
                service.delete(&run.run_id).await.map(|_| ()),
            );
        }
    }
    Ok(result)
}

pub async fn retain(
    service: &HealthService,
    now: DateTime<Utc>,
) -> Result<MaintenanceResult, String> {
    let mut result = MaintenanceResult::default();
    let seconds = service
        .config()
        .report_retention_days
        .checked_mul(86400)
        .and_then(|seconds| i64::try_from(seconds).ok())
        .and_then(TimeDelta::try_seconds);
    let Some(cutoff) = seconds.and_then(|age| now.checked_sub_signed(age)) else {
        return Ok(result);
    };
    for record in service.records().await? {
        match service.forget(&record.execution.run_id, cutoff).await {
            Ok(true) => result.processed.push(record.execution.run_id),
            Ok(false) => (),
            Err(error) => result
                .errors
                .push(format!("{}: {error}", record.execution.run_id)),
        }
    }
    Ok(result)
}

fn expired(run: &BackupHealthExecution, now: DateTime<Utc>, hours: u64) -> bool {
    run.mode == BackupHealthMode::Manual
        && matches!(
            run.state,
            BackupHealthState::Starting | BackupHealthState::Running | BackupHealthState::Stopped
        )
        && run.cleanup.state != HealthCleanupState::Completed
        && run
            .started_at
            .as_deref()
            .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
            .and_then(|started| {
                u64::try_from(now.signed_duration_since(started).num_seconds()).ok()
            })
            .zip(hours.checked_mul(3600))
            .is_some_and(|(elapsed, ttl)| elapsed >= ttl)
}

fn record_result(result: &mut MaintenanceResult, id: &str, operation: Result<(), String>) {
    match operation {
        Ok(()) => result.processed.push(id.into()),
        Err(error) => result.errors.push(format!("{id}: {error}")),
    }
}

#[cfg(test)]
#[path = "maintenance_tests.rs"]
mod tests;
