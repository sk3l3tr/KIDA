use std::{fs, io, path::PathBuf};

use chrono::{DateTime, FixedOffset};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{
    evidence::EvidencePolicy,
    model::{BackupHealthExecution, BackupHealthState, HealthCleanupState},
    report,
    restore::RestoredDirectory,
};
use crate::infrastructure::storage::{JsonStorage, Storage, StorageError, atomic_write};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum ReportStatus {
    Pending,
    Ready,
    Deleted,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthHistoryRecord {
    pub record_version: u32,
    #[serde(flatten)]
    pub execution: BackupHealthExecution,
    pub restore_provenance: Option<RestoredDirectory>,
    pub report_status: ReportStatus,
}

#[derive(Debug, Default)]
pub struct Reconciliation {
    pub repaired: Vec<String>,
    pub errors: Vec<String>,
}

/// Blocking domain repository. 07 serializes conflicting operations on each run.
pub struct ExecutionRepository {
    root: PathBuf,
    known_values: Vec<String>,
    allow_logs: bool,
}

impl ExecutionRepository {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self::with_evidence_policy(root, vec![], false)
    }

    pub fn with_evidence_policy(
        root: impl Into<PathBuf>,
        known_values: Vec<String>,
        allow_logs: bool,
    ) -> Self {
        Self {
            root: root.into(),
            known_values,
            allow_logs,
        }
    }

    pub fn save(
        &self,
        execution: &BackupHealthExecution,
        provenance: Option<&RestoredDirectory>,
    ) -> Result<(), StorageError> {
        let previous = self.previous(&execution.run_id)?;
        if previous
            .as_ref()
            .is_some_and(|record| record.report_status != ReportStatus::Pending)
        {
            return Err(invalid(
                "finalized executions must be updated through finish",
            ));
        }
        let record = self.record(
            execution,
            provenance,
            previous.as_ref(),
            ReportStatus::Pending,
        )?;
        self.validate(&record)?;
        JsonStorage::new(self.execution_path(&execution.run_id)?).save(&record)
    }

    /// Save all report inputs first. A Markdown failure is repairable from JSON.
    pub fn finish(
        &self,
        execution: &BackupHealthExecution,
        provenance: Option<&RestoredDirectory>,
    ) -> Result<(), StorageError> {
        let previous = self.previous(&execution.run_id)?;
        if execution.finished_at.is_none()
            || execution.cleanup.state == HealthCleanupState::Pending
            || !matches!(
                execution.state,
                BackupHealthState::Stopped | BackupHealthState::Error
            )
        {
            return Err(invalid(
                "final report requires a closed execution and a cleanup attempt",
            ));
        }
        let status = if previous
            .as_ref()
            .is_some_and(|record| record.report_status == ReportStatus::Deleted)
        {
            ReportStatus::Deleted
        } else {
            ReportStatus::Ready
        };
        let record = self.record(execution, provenance, previous.as_ref(), status)?;
        self.validate(&record)?;
        JsonStorage::new(self.execution_path(&execution.run_id)?).save(&record)?;
        self.write_report(&record).map(|_| ())
    }

    pub fn get(&self, run_id: &str) -> Result<HealthHistoryRecord, StorageError> {
        let path = self.execution_path(run_id)?;
        require_regular(&path)?;
        let record: HealthHistoryRecord = JsonStorage::new(path).load()?;
        self.validate(&record)?;
        if record.execution.run_id != run_id {
            return Err(invalid("execution identity does not match its filename"));
        }
        Ok(record)
    }

    pub fn list(&self) -> Result<Vec<HealthHistoryRecord>, StorageError> {
        let mut result = Vec::new();
        for id in self.ids()? {
            let record = self.get(&id)?;
            result.push((timestamp(&record.execution.created_at)?, record));
        }
        result.sort_by(|a, b| (&b.0, &b.1.execution.run_id).cmp(&(&a.0, &a.1.execution.run_id)));
        Ok(result.into_iter().map(|(_, record)| record).collect())
    }

    /// Maintenance must still close valid executions when another record is corrupt.
    pub fn list_available(&self) -> Result<(Vec<HealthHistoryRecord>, Vec<String>), StorageError> {
        let mut records = Vec::new();
        let mut errors = Vec::new();
        for id in self.ids()? {
            match self.get(&id) {
                Ok(record) => records.push((timestamp(&record.execution.created_at)?, record)),
                Err(error) => errors.push(format!("{id}: {error}")),
            }
        }
        records.sort_by(|a, b| (&b.0, &b.1.execution.run_id).cmp(&(&a.0, &a.1.execution.run_id)));
        Ok((
            records.into_iter().map(|(_, record)| record).collect(),
            errors,
        ))
    }

    pub fn report_list(&self) -> Result<Vec<String>, StorageError> {
        let mut result = Vec::new();
        for record in self.list()? {
            if record.report_status == ReportStatus::Ready {
                let path = self.report_path(&record.execution.run_id)?;
                match fs::symlink_metadata(path) {
                    Ok(metadata) if metadata.is_file() => result.push(record.execution.run_id),
                    Ok(_) => return Err(invalid("report is not a regular file")),
                    Err(error) if error.kind() == io::ErrorKind::NotFound => (),
                    Err(error) => return Err(error.into()),
                }
            }
        }
        Ok(result)
    }

    pub fn report_get(&self, run_id: &str) -> Result<String, StorageError> {
        let path = self.report_path(run_id)?;
        if self.get(run_id)?.report_status != ReportStatus::Ready {
            return Err(StorageError::NotFound { path });
        }
        require_regular(&path)?;
        Ok(fs::read_to_string(path)?)
    }

    /// Tombstone first so a crash or failed unlink cannot resurrect the Markdown.
    pub fn report_delete(&self, run_id: &str) -> Result<(), StorageError> {
        let mut record = self.get(run_id)?;
        if record.report_status == ReportStatus::Pending {
            return Err(invalid("execution has no final report"));
        }
        record.report_status = ReportStatus::Deleted;
        JsonStorage::new(self.execution_path(run_id)?).save(&record)?;
        self.write_report(&record).map(|_| ())
    }

    /// Caller serializes this with other operations on the execution.
    /// Remove Markdown first; a failed unlink retains the ownership record.
    pub fn prune(&self, run_id: &str, cutoff: DateTime<FixedOffset>) -> Result<bool, StorageError> {
        let record = self.get(run_id)?;
        let run = &record.execution;
        if run.cleanup.state != HealthCleanupState::Completed
            || !matches!(
                run.state,
                BackupHealthState::Stopped | BackupHealthState::Error
            )
            || run
                .finished_at
                .as_deref()
                .map(timestamp)
                .transpose()?
                .is_none_or(|date| date > cutoff)
        {
            return Ok(false);
        }
        let report = self.report_path(run_id)?;
        match fs::remove_file(report) {
            Ok(()) => (),
            Err(error) if error.kind() == io::ErrorKind::NotFound => (),
            Err(error) => return Err(error.into()),
        }
        fs::remove_file(self.execution_path(run_id)?)?;
        Ok(true)
    }

    /// One corrupt record does not prevent repair of the other executions.
    pub fn reconcile(&self) -> Result<Reconciliation, StorageError> {
        let mut result = Reconciliation::default();
        for id in self.ids()? {
            match self.get(&id).and_then(|record| self.write_report(&record)) {
                Ok(true) => result.repaired.push(id),
                Ok(false) => (),
                Err(error) => result.errors.push(format!("{id}: {error}")),
            }
        }
        Ok(result)
    }

    fn previous(&self, id: &str) -> Result<Option<HealthHistoryRecord>, StorageError> {
        match self.get(id) {
            Ok(record) => Ok(Some(record)),
            Err(StorageError::NotFound { .. }) => Ok(None),
            Err(error) => Err(error),
        }
    }

    fn record(
        &self,
        execution: &BackupHealthExecution,
        provenance: Option<&RestoredDirectory>,
        previous: Option<&HealthHistoryRecord>,
        status: ReportStatus,
    ) -> Result<HealthHistoryRecord, StorageError> {
        if let Some(old) = previous.and_then(|record| record.restore_provenance.as_ref())
            && provenance.is_some_and(|provenance| old != provenance)
        {
            return Err(invalid("restoration creation identity cannot be replaced"));
        }
        let mut execution = execution.clone();
        let mut policy = EvidencePolicy::new(self.known_values.clone(), self.allow_logs);
        execution.diagnosis.summary = policy.text(&execution.diagnosis.summary);
        execution.diagnosis.anomalies.truncate(128);
        for value in &mut execution.diagnosis.anomalies {
            *value = policy.text(value);
        }
        for service in &mut execution.diagnosis.services {
            for reason in &mut service.reasons {
                *reason = policy.text(reason);
            }
        }
        execution.diagnosis.evidence.truncate(128);
        for evidence in &mut execution.diagnosis.evidence {
            evidence.description = policy.text(&evidence.description);
            if let Some(logs) = evidence.logs.take() {
                match policy.excerpt(&logs) {
                    Ok(safe) => evidence.logs = Some(safe),
                    Err(reason) => {
                        evidence.description =
                            policy.text(&format!("{reason}; {}", evidence.description))
                    }
                }
            }
        }
        for error in &mut execution.cleanup.errors {
            *error = policy.text(error);
        }
        execution.report_path = (status != ReportStatus::Pending).then(|| {
            self.root
                .join("reports")
                .join(format!("{}.md", execution.run_id))
        });
        Ok(HealthHistoryRecord {
            record_version: 1,
            execution,
            restore_provenance: provenance
                .cloned()
                .or_else(|| previous.and_then(|record| record.restore_provenance.clone())),
            report_status: status,
        })
    }

    fn validate(&self, record: &HealthHistoryRecord) -> Result<(), StorageError> {
        self.execution_path(&record.execution.run_id)?;
        if record.record_version != 1 {
            return Err(invalid("unsupported execution record version"));
        }
        let execution = &record.execution;
        let expected_report = (record.report_status != ReportStatus::Pending)
            .then(|| self.report_path(&execution.run_id))
            .transpose()?;
        if execution.report_path != expected_report {
            return Err(invalid("report reference does not match execution"));
        }
        let created = timestamp(&execution.created_at)?;
        let started = execution.started_at.as_deref().map(timestamp).transpose()?;
        let finished = execution
            .finished_at
            .as_deref()
            .map(timestamp)
            .transpose()?;
        if started.is_some_and(|date| date < created)
            || finished.is_some_and(|date| date < started.unwrap_or(created))
        {
            return Err(invalid("execution timestamps are out of order"));
        }
        if record.report_status != ReportStatus::Pending
            && (finished.is_none()
                || execution.cleanup.state == HealthCleanupState::Pending
                || !matches!(
                    execution.state,
                    BackupHealthState::Stopped | BackupHealthState::Error
                ))
        {
            return Err(invalid(
                "finalized record lacks closure or cleanup evidence",
            ));
        }
        if let Some(provenance) = &record.restore_provenance
            && (provenance.path != execution.restore_dir || !provenance.path.is_absolute())
        {
            return Err(invalid("restoration provenance does not match execution"));
        }
        Ok(())
    }

    fn ids(&self) -> Result<Vec<String>, StorageError> {
        let entries = match fs::read_dir(self.root.join("executions")) {
            Ok(entries) => entries,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(vec![]),
            Err(error) => return Err(error.into()),
        };
        let mut ids = Vec::new();
        for entry in entries {
            let path = entry?.path();
            if path
                .extension()
                .is_some_and(|extension| extension == "json")
            {
                ids.push(
                    path.file_stem()
                        .and_then(|stem| stem.to_str())
                        .ok_or_else(|| invalid("invalid execution filename"))?
                        .into(),
                );
            }
        }
        ids.sort();
        Ok(ids)
    }

    fn execution_path(&self, id: &str) -> Result<PathBuf, StorageError> {
        checked_id(id)?;
        Ok(self.root.join("executions").join(format!("{id}.json")))
    }

    fn report_path(&self, id: &str) -> Result<PathBuf, StorageError> {
        checked_id(id)?;
        Ok(self.root.join("reports").join(format!("{id}.md")))
    }

    fn write_report(&self, record: &HealthHistoryRecord) -> Result<bool, StorageError> {
        let path = self.report_path(&record.execution.run_id)?;
        match record.report_status {
            ReportStatus::Pending => Ok(false),
            ReportStatus::Deleted => match fs::remove_file(path) {
                Ok(()) => Ok(true),
                Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
                Err(error) => Err(error.into()),
            },
            ReportStatus::Ready => {
                let markdown = report::render(record);
                if fs::symlink_metadata(&path).is_ok_and(|metadata| metadata.is_file()) {
                    match fs::read(&path) {
                        Ok(bytes) if bytes == markdown.as_bytes() => return Ok(false),
                        Ok(_) => (),
                        Err(error) => return Err(error.into()),
                    }
                }
                atomic_write(&path, markdown.as_bytes())?;
                Ok(true)
            }
        }
    }
}

fn require_regular(path: &std::path::Path) -> Result<(), StorageError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_file() => Ok(()),
        Ok(_) => Err(invalid("history document is not a regular file")),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            Err(StorageError::NotFound { path: path.into() })
        }
        Err(error) => Err(error.into()),
    }
}

fn checked_id(id: &str) -> Result<(), StorageError> {
    if Uuid::parse_str(id).is_ok_and(|parsed| parsed.to_string() == id) {
        Ok(())
    } else {
        Err(invalid("invalid canonical run UUID"))
    }
}

fn timestamp(value: &str) -> Result<DateTime<FixedOffset>, StorageError> {
    let date =
        DateTime::parse_from_rfc3339(value).map_err(|_| invalid("invalid execution timestamp"))?;
    if date.offset().local_minus_utc() != 0 {
        return Err(invalid("execution timestamp must be UTC"));
    }
    Ok(date)
}

fn invalid(message: &str) -> StorageError {
    io::Error::new(io::ErrorKind::InvalidData, message).into()
}

#[cfg(test)]
#[path = "history_tests.rs"]
mod tests;
