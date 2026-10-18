use std::{
    collections::HashMap,
    path::Path,
    sync::{
        Arc, Mutex as StdMutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use chrono::{DateTime, Utc};
use tokio::sync::{Mutex, Notify, OnceCell};
use uuid::Uuid;

use super::{
    compose::HealthCompose,
    definition,
    diagnosis::{DiagnosticSession, EvaluationPhase},
    evidence::EvidencePolicy,
    history::{ExecutionRepository, HealthHistoryRecord},
    model::*,
    restore::{self, RestoredDirectory},
};
use crate::{
    conf,
    features::{
        backup::service::BackupService,
        docker::{ComposeOptions, DockerService},
    },
    infrastructure::conf::BackupHealthConfig,
};

static SERVICE: OnceCell<HealthService> = OnceCell::const_new();

pub async fn get_service() -> Result<&'static HealthService, String> {
    SERVICE
        .get_or_try_init(|| async {
            let service = HealthService::new(conf::get()?.backup_health.clone()).await?;
            let recovery = super::maintenance::startup(&service, Utc::now()).await?;
            for error in recovery.errors {
                eprintln!("[HEALTH] {error}");
            }
            Ok::<_, String>(service)
        })
        .await
}

struct Run {
    view: StdMutex<BackupHealthExecution>,
    data: Mutex<RunData>,
    cancelled: AtomicBool,
    changed: Notify,
}

struct RunData {
    execution: BackupHealthExecution,
    provenance: Option<RestoredDirectory>,
    compose: Option<HealthCompose>,
    session: Option<DiagnosticSession>,
}

#[derive(Default)]
struct Registry {
    runs: HashMap<String, Arc<Run>>,
    // ERROR does not prove a stop. Keep its reservation until stop is confirmed.
    reservations: HashMap<String, String>,
}

pub struct HealthService {
    config: BackupHealthConfig,
    repository: Arc<ExecutionRepository>,
    registry: StdMutex<Registry>,
    admission_errors: Vec<String>,
}

impl HealthService {
    pub async fn new(config: BackupHealthConfig) -> Result<Self, String> {
        let repository = Arc::new(ExecutionRepository::new(&config.data_root));
        let (records, admission_errors) = blocking({
            let repository = repository.clone();
            move || repository.list_available().map_err(|e| e.to_string())
        })
        .await?;
        let service = Self {
            config,
            repository,
            registry: StdMutex::new(Registry::default()),
            admission_errors,
        };
        for record in records {
            let execution = record.execution;
            let mut registry = service.registry.lock().unwrap();
            if matches!(
                execution.state,
                BackupHealthState::Starting | BackupHealthState::Running
            ) || (execution.state == BackupHealthState::Error
                && execution.project.is_some()
                && execution.cleanup.state != HealthCleanupState::Completed)
            {
                registry
                    .reservations
                    .insert(execution.run_id.clone(), execution.definition.id.clone());
            }
            registry.runs.insert(
                execution.run_id.clone(),
                Arc::new(Run {
                    view: StdMutex::new(execution.clone()),
                    data: Mutex::new(RunData {
                        execution,
                        provenance: record.restore_provenance,
                        compose: None,
                        session: None,
                    }),
                    cancelled: AtomicBool::new(false),
                    changed: Notify::new(),
                }),
            );
        }
        Ok(service)
    }

    pub fn config(&self) -> &BackupHealthConfig {
        &self.config
    }
    pub fn repository(&self) -> &ExecutionRepository {
        &self.repository
    }

    pub async fn create(
        &self,
        path: &Path,
        mode: BackupHealthMode,
    ) -> Result<BackupHealthExecution, String> {
        let path = path.to_owned();
        let resolved = blocking(move || definition::load(path).map_err(|e| e.to_string())).await?;
        self.create_resolved(resolved, mode).await
    }

    async fn create_resolved(
        &self,
        resolved: ResolvedHealthDefinition,
        mode: BackupHealthMode,
    ) -> Result<BackupHealthExecution, String> {
        let run_id = Uuid::new_v4().to_string();
        let execution = BackupHealthExecution {
            restore_dir: self.config.restore_root.join(&run_id),
            run_id: run_id.clone(),
            definition: resolved.definition,
            definition_path: resolved.definition_path,
            compose_path: resolved.compose_path,
            mode,
            state: BackupHealthState::Created,
            diagnosis: DiagnosticSession::new(String::new(), vec![], EvidencePolicy::default())
                .diagnosis,
            created_at: Utc::now().to_rfc3339(),
            started_at: None,
            finished_at: None,
            artifact: None,
            compose_checksum: None,
            project: None,
            services: vec![],
            resources: vec![],
            cleanup: HealthCleanup {
                state: HealthCleanupState::Pending,
                errors: vec![],
            },
            report_path: None,
        };
        let data = RunData {
            execution: execution.clone(),
            provenance: None,
            compose: None,
            session: None,
        };
        self.persist(&data).await?;
        self.registry.lock().unwrap().runs.insert(
            run_id,
            Arc::new(Run {
                view: StdMutex::new(execution.clone()),
                data: Mutex::new(data),
                cancelled: AtomicBool::new(false),
                changed: Notify::new(),
            }),
        );
        Ok(execution)
    }

    pub async fn start<F>(
        &self,
        run_id: &str,
        enqueue: F,
    ) -> Result<(BackupHealthExecution, String), String>
    where
        F: FnOnce(&str) -> Result<String, String>,
    {
        let run = self.find(run_id)?;
        let mut data = run.data.lock().await;
        if data.execution.state != BackupHealthState::Created
            || run.cancelled.load(Ordering::SeqCst)
        {
            return Err("Health start requires CREATED".into());
        }
        self.reserve(&data.execution)?;
        data.execution.state = BackupHealthState::Starting;
        data.execution.started_at = Some(Utc::now().to_rfc3339());
        if let Err(error) = self.persist(&data).await {
            data.execution.state = BackupHealthState::Created;
            data.execution.started_at = None;
            self.release(run_id);
            *run.view.lock().unwrap() = data.execution.clone();
            return Err(error);
        }
        match enqueue(run_id) {
            Ok(queue_id) => Ok((data.execution.clone(), queue_id)),
            Err(error) => {
                data.execution.state = BackupHealthState::Created;
                data.execution.started_at = None;
                data.execution
                    .diagnosis
                    .anomalies
                    .push(format!("admission failed: {error}"));
                let rollback = self.persist(&data).await;
                self.release(run_id);
                rollback
                    .map_err(|rollback| format!("{error}; rollback persistence: {rollback}"))?;
                Err(error)
            }
        }
    }

    pub async fn run<F>(
        &self,
        path: &Path,
        enqueue: F,
    ) -> Result<(BackupHealthExecution, String), String>
    where
        F: FnOnce(&str) -> Result<String, String>,
    {
        let execution = self.create(path, BackupHealthMode::Automatic).await?;
        self.start(&execution.run_id, enqueue).await
    }

    /// Execute an already reserved run. Never re-admit or enqueue it here.
    pub async fn execute(&self, run_id: &str) -> Result<(), String> {
        let run = self.find(run_id)?;
        let mut data = run.data.lock().await;
        if run.cancelled.load(Ordering::SeqCst)
            || data.execution.state != BackupHealthState::Starting
        {
            return Ok(());
        }
        let result = self.prepare(&run, &mut data).await;
        if let Err(error) = result {
            let mut session = data.session.take().unwrap_or_else(|| {
                DiagnosticSession::new(String::new(), vec![], EvidencePolicy::default())
            });
            data.execution.diagnosis = session.fail(&error, &Utc::now().to_rfc3339());
            data.session = Some(session);
            data.execution.state = BackupHealthState::Error;
            return self.close(&mut data, true, None).await;
        }
        if run.cancelled.load(Ordering::SeqCst) {
            return Ok(());
        }
        data.execution.state = BackupHealthState::Running;
        if let Err(error) = self.persist(&data).await {
            data.execution
                .diagnosis
                .anomalies
                .push(format!("running persistence: {error}"));
            data.execution.state = BackupHealthState::Error;
            self.close(&mut data, true, None).await?;
            return Err(error);
        }
        if data.execution.mode == BackupHealthMode::Manual {
            return Ok(());
        }
        let mut session = data.session.take().expect("prepared diagnostic session");
        tokio::select! {
            result = session.diagnose(self.timeout()) => { data.execution.diagnosis = match result {Ok(diagnosis) => diagnosis, Err(error) => session.fail(&error, &Utc::now().to_rfc3339())}; }
            _ = run.changed.notified() => {
                data.execution.diagnosis = session.evaluate(Err("cancelled"), EvaluationPhase::RequestedStop, &Utc::now().to_rfc3339());
            }
        }
        data.session = Some(session);
        self.close(&mut data, true, None).await
    }

    async fn prepare(&self, run: &Run, data: &mut RunData) -> Result<(), String> {
        let reference = data.execution.definition.backup.reference.clone();
        let version = data.execution.definition.backup.version.clone();
        let artifact = blocking(move || {
            BackupService::resolve_artifact(&reference, &version).map_err(|e| e.to_string())
        })
        .await?;
        data.execution.artifact = Some(artifact.clone());
        self.persist(data).await?;
        if run.cancelled.load(Ordering::SeqCst) {
            return Ok(());
        }
        let root = self.config.restore_root.clone();
        let destination = data.execution.restore_dir.clone();
        let restored = tokio::task::spawn_blocking(move || {
            std::fs::create_dir_all(root).map_err(|source| restore::RestoreError {
                source: Box::new(source.into()),
                partial: None,
            })?;
            restore::restore(&artifact, &destination)
        })
        .await
        .map_err(|e| e.to_string())?;
        match restored {
            Ok(provenance) => {
                data.execution.restore_dir = provenance.path.clone();
                data.provenance = Some(provenance);
            }
            Err(error) => {
                let reason = error.to_string();
                data.provenance = error.partial;
                self.persist(data).await?;
                return Err(reason);
            }
        }
        self.persist(data).await?;
        if run.cancelled.load(Ordering::SeqCst) {
            return Ok(());
        }
        let mut compose = HealthCompose::prepare(
            &data.execution.run_id,
            &data.execution.compose_path,
            &data.execution.restore_dir,
            self.timeout(),
        )
        .await?;
        data.execution.compose_path = compose.configuration.file.clone();
        data.execution.compose_checksum = Some(compose.configuration.checksum.clone());
        data.execution.services = compose.services();
        let result = compose.create().await;
        data.execution.project = compose.project.clone();
        data.execution.resources = compose.resources.clone();
        data.session = Some(DiagnosticSession::new(
            format!("kida-bh-{}", data.execution.run_id),
            data.execution.services.clone(),
            EvidencePolicy::default(),
        ));
        data.compose = Some(compose);
        self.persist(data).await?;
        result?;
        if run.cancelled.load(Ordering::SeqCst) {
            return Ok(());
        }
        data.compose.as_ref().unwrap().start().await
    }

    pub async fn get(&self, run_id: &str) -> Result<BackupHealthExecution, String> {
        let run = self.find(run_id)?;
        let Ok(mut data) = run.data.try_lock() else {
            return Ok(run.view.lock().unwrap().clone());
        };
        if data.execution.state == BackupHealthState::Running
            && let Some(mut session) = data.session.take()
        {
            let project = data
                .execution
                .project
                .as_ref()
                .expect("running project")
                .project
                .clone();
            let observation =
                DockerService::diagnose_compose_project(&project, self.timeout()).await;
            data.execution.diagnosis = session.evaluate(
                observation.as_ref().map_err(String::as_str),
                EvaluationPhase::Observing,
                &Utc::now().to_rfc3339(),
            );
            data.session = Some(session);
            self.persist(&data).await?;
        }
        Ok(data.execution.clone())
    }

    pub async fn records(&self) -> Result<Vec<HealthHistoryRecord>, String> {
        let repository = self.repository.clone();
        blocking(move || {
            repository
                .list_available()
                .map(|(records, _)| records)
                .map_err(|e| e.to_string())
        })
        .await
    }

    pub async fn list(&self) -> Result<Vec<HealthHistoryRecord>, String> {
        let repository = self.repository.clone();
        blocking(move || repository.list().map_err(|e| e.to_string())).await
    }

    pub async fn stop(&self, run_id: &str) -> Result<BackupHealthExecution, String> {
        self.end(run_id, false, None).await
    }
    pub async fn delete(&self, run_id: &str) -> Result<BackupHealthExecution, String> {
        self.end(run_id, true, None).await
    }
    pub async fn interrupt(&self, run_id: &str, now: DateTime<Utc>) -> Result<(), String> {
        self.end(run_id, true, Some(now)).await.map(|_| ())
    }

    async fn end(
        &self,
        run_id: &str,
        remove: bool,
        interrupted: Option<DateTime<Utc>>,
    ) -> Result<BackupHealthExecution, String> {
        let run = self.find(run_id)?;
        run.cancelled.store(true, Ordering::SeqCst);
        run.changed.notify_one();
        let mut data = run.data.lock().await;
        if interrupted.is_some() {
            data.execution
                .diagnosis
                .anomalies
                .push("execution interrupted by CORE restart".into());
            data.execution.state = BackupHealthState::Error;
        }
        if let Some(mut session) = data.session.take() {
            data.execution.diagnosis = session.evaluate(
                Err("stop"),
                if interrupted.is_some() {
                    EvaluationPhase::Interrupted
                } else {
                    EvaluationPhase::RequestedStop
                },
                &Utc::now().to_rfc3339(),
            );
            data.session = Some(session);
        }
        if !data.execution.diagnosis.complete {
            if !matches!(
                data.execution.diagnosis.result,
                BackupHealthResult::Failed | BackupHealthResult::Unhealthy
            ) {
                data.execution.diagnosis.result = BackupHealthResult::Unknown;
            }
            data.execution.diagnosis.complete = true;
            data.execution.diagnosis.summary = if interrupted.is_some() {
                "evaluation interrupted"
            } else {
                "evaluation ended by requested stop"
            }
            .into();
        }
        self.close(&mut data, remove, interrupted).await?;
        Ok(data.execution.clone())
    }

    async fn close(
        &self,
        data: &mut RunData,
        remove: bool,
        now: Option<DateTime<Utc>>,
    ) -> Result<(), String> {
        if data.execution.cleanup.state == HealthCleanupState::Completed {
            return Ok(());
        }
        let mut errors = vec![];
        // Removal is ownership-checked and never stops running containers. This
        // also recognizes an already completed Docker cleanup after a crash.
        let mut removed = data.execution.project.is_none();
        if remove && let Some(project) = &data.execution.project {
            removed = DockerService::compose_remove(project, self.timeout())
                .await
                .is_ok_and(|report| report.completed);
        }
        let stopped = if removed && remove {
            true
        } else if let Some(project) = &data.execution.project {
            let mut options = ComposeOptions::new(&project.project, &data.execution.compose_path);
            options.expected_owner = Some(project.owner.clone());
            options.timeout = self.timeout();
            options.variables.insert(
                "KIDA_RESTORE_DIR".into(),
                data.execution.restore_dir.to_string_lossy().into_owned(),
            );
            match DockerService::compose_stop(&options).await {
                Ok(()) => true,
                Err(error) => {
                    errors.push(error);
                    false
                }
            }
        } else {
            true
        };
        if stopped {
            self.release(&data.execution.run_id);
            if data.execution.state != BackupHealthState::Error {
                data.execution.state = BackupHealthState::Stopped;
            }
        } else {
            data.execution.state = BackupHealthState::Error;
        }
        if remove && stopped {
            if !removed && let Some(project) = &data.execution.project {
                match DockerService::compose_remove(project, self.timeout()).await {
                    Ok(report) => {
                        removed = report.completed;
                        errors.extend(report.errors);
                        errors.extend(report.failed.into_iter().map(|row| row.reason));
                        if !removed {
                            errors.push("owned Docker resources still await cleanup".into());
                        }
                    }
                    Err(error) => errors.push(error),
                }
            }
            // Never delete data still referenced by resources awaiting removal.
            if removed
                && errors.is_empty()
                && let Some(provenance) = data.provenance.clone()
            {
                let root = self.config.restore_root.clone();
                let id = data.execution.run_id.clone();
                if let Err(error) =
                    blocking(move || restore::remove_owned(&root, &id, &provenance)).await
                {
                    errors.push(error);
                }
            }
        }
        if remove && data.provenance.is_none() {
            let path = data.execution.restore_dir.clone();
            let unknown = blocking(move || match std::fs::symlink_metadata(path) {
                Ok(_) => Ok(true),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
                Err(error) => Err(error.to_string()),
            })
            .await;
            match unknown {
                Ok(false) => (),
                Ok(true) => {
                    errors.push("restore directory lacks creation provenance; preserved".into())
                }
                Err(error) => errors.push(error),
            }
        }
        data.execution
            .finished_at
            .get_or_insert_with(|| now.unwrap_or_else(Utc::now).to_rfc3339());
        data.execution.cleanup = HealthCleanup {
            state: if !errors.is_empty() {
                HealthCleanupState::Error
            } else if remove {
                HealthCleanupState::Completed
            } else {
                HealthCleanupState::Pending
            },
            errors,
        };
        if data.execution.cleanup.state != HealthCleanupState::Pending {
            data.execution.report_path = Some(
                self.config
                    .data_root
                    .join("reports")
                    .join(format!("{}.md", data.execution.run_id)),
            );
        }
        self.persist(data).await
    }

    pub async fn report_list(&self) -> Result<Vec<String>, String> {
        let repository = self.repository.clone();
        blocking(move || repository.report_list().map_err(|e| e.to_string())).await
    }
    pub async fn report_get(&self, id: &str) -> Result<String, String> {
        let run = self.find(id)?;
        let _data = run.data.lock().await;
        let repository = self.repository.clone();
        let id = id.to_owned();
        blocking(move || repository.report_get(&id).map_err(|e| e.to_string())).await
    }
    pub async fn report_delete(&self, id: &str) -> Result<(), String> {
        let run = self.find(id)?;
        let _data = run.data.lock().await;
        let repository = self.repository.clone();
        let id = id.to_owned();
        blocking(move || repository.report_delete(&id).map_err(|e| e.to_string())).await
    }

    pub async fn forget(&self, run_id: &str, cutoff: DateTime<Utc>) -> Result<bool, String> {
        let run = self.find(run_id)?;
        let _data = run.data.lock().await;
        let repository = self.repository.clone();
        let id = run_id.to_owned();
        let removed = blocking(move || {
            repository
                .prune(&id, cutoff.fixed_offset())
                .map_err(|e| e.to_string())
        })
        .await?;
        if removed {
            self.registry.lock().unwrap().runs.remove(run_id);
        }
        Ok(removed)
    }

    async fn persist(&self, data: &RunData) -> Result<(), String> {
        if let Ok(run) = self.find(&data.execution.run_id) {
            *run.view.lock().unwrap() = data.execution.clone();
        }
        let repository = self.repository.clone();
        let snapshot = data.execution.clone();
        let provenance = data.provenance.clone();
        blocking(move || {
            if snapshot.finished_at.is_some()
                && snapshot.cleanup.state != HealthCleanupState::Pending
            {
                repository.finish(&snapshot, provenance.as_ref())
            } else {
                repository.save(&snapshot, provenance.as_ref())
            }
            .map_err(|e| e.to_string())
        })
        .await
    }

    fn find(&self, id: &str) -> Result<Arc<Run>, String> {
        self.registry
            .lock()
            .unwrap()
            .runs
            .get(id)
            .cloned()
            .ok_or_else(|| "Health run not found".into())
    }
    fn reserve(&self, execution: &BackupHealthExecution) -> Result<(), String> {
        if !self.admission_errors.is_empty() {
            return Err("Health admission blocked by unreadable execution history".into());
        }
        let mut registry = self.registry.lock().unwrap();
        if registry
            .reservations
            .values()
            .any(|id| id == &execution.definition.id)
        {
            return Err("Health definition already active".into());
        }
        if registry.reservations.len() >= self.config.max_active_runs {
            return Err("Health active run limit reached".into());
        }
        registry
            .reservations
            .insert(execution.run_id.clone(), execution.definition.id.clone());
        Ok(())
    }
    fn release(&self, id: &str) {
        self.registry.lock().unwrap().reservations.remove(id);
    }
    fn timeout(&self) -> Duration {
        Duration::from_secs(self.config.health_timeout_seconds)
    }
}

async fn blocking<T: Send + 'static>(
    operation: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(operation)
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
#[path = "service_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "service_lifecycle_tests.rs"]
mod lifecycle_tests;
