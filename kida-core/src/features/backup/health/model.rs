use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::features::{backup::model::BackupJob, docker::ManagedProject};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BackupHealthDefinition {
    pub id: String,
    pub name: String,
    pub backup: HealthBackupReference,
    pub docker: HealthDocker,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HealthBackupReference {
    pub reference: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HealthDocker {
    pub compose: PathBuf,
}

#[derive(Debug, Clone)]
pub struct ResolvedHealthDefinition {
    pub definition: BackupHealthDefinition,
    pub definition_path: PathBuf,
    pub compose_path: PathBuf,
    pub backup_job: BackupJob,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum BackupHealthMode {
    Automatic,
    Manual,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum BackupHealthState {
    Created,
    Starting,
    Running,
    Stopped,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum BackupHealthResult {
    Failed,
    Unhealthy,
    Unknown,
    Degraded,
    Healthy,
}

/// A concrete, verified selection; timestamps use UTC RFC 3339, as in Scheduler.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolvedBackupArtifact {
    pub artifact_id: String,
    pub job_id: String,
    pub artifact_name: String,
    pub created_at: String,
    pub path: PathBuf,
    pub checksum: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthService {
    pub name: String,
    pub image: String,
    pub replicas: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthResource {
    pub kind: String,
    pub identity: String,
}

/// Only bounded, sanitized excerpts belong here; never raw environment or Compose.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthEvidence {
    pub observed_at: String,
    pub service: Option<String>,
    pub container_id: Option<String>,
    pub description: String,
    pub logs: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthServiceDiagnosis {
    pub service: String,
    pub result: BackupHealthResult,
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthDiagnosis {
    pub result: BackupHealthResult,
    pub summary: String,
    pub complete: bool,
    pub services: Vec<HealthServiceDiagnosis>,
    pub anomalies: Vec<String>,
    pub evidence: Vec<HealthEvidence>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum HealthCleanupState {
    Pending,
    Completed,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthCleanup {
    pub state: HealthCleanupState,
    pub errors: Vec<String>,
}

/// Domain snapshot. Task 06 owns the on-disk representation and repositories.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupHealthExecution {
    pub run_id: String,
    pub definition: BackupHealthDefinition,
    pub definition_path: PathBuf,
    pub mode: BackupHealthMode,
    pub state: BackupHealthState,
    pub diagnosis: HealthDiagnosis,
    pub created_at: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub artifact: Option<ResolvedBackupArtifact>,
    pub compose_path: PathBuf,
    pub compose_checksum: Option<String>,
    pub restore_dir: PathBuf,
    pub project: Option<ManagedProject>,
    pub services: Vec<HealthService>,
    pub resources: Vec<HealthResource>,
    pub cleanup: HealthCleanup,
    pub report_path: Option<PathBuf>,
}
