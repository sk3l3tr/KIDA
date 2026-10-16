use std::{collections::BTreeSet, future::Future, time::Duration};

use super::{
    evidence::EvidencePolicy,
    model::{
        BackupHealthResult as ResultKind, HealthDiagnosis, HealthEvidence, HealthService,
        HealthServiceDiagnosis,
    },
};
use crate::features::docker::{ComposeDiagnostics, ContainerLogs, DockerService};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum EvaluationPhase {
    Observing,
    TimedOut,
    Interrupted,
    RequestedStop,
}

pub struct DiagnosticSession {
    project: String,
    expected: Vec<HealthService>,
    pub diagnosis: HealthDiagnosis,
    policy: EvidencePolicy,
    fatal: bool,
    incidents: BTreeSet<String>,
}

impl DiagnosticSession {
    pub fn new(project: String, expected: Vec<HealthService>, policy: EvidencePolicy) -> Self {
        Self {
            project,
            expected,
            policy,
            fatal: false,
            incidents: BTreeSet::new(),
            diagnosis: HealthDiagnosis {
                result: ResultKind::Unknown,
                summary: "evaluation pending".into(),
                complete: false,
                services: vec![],
                anomalies: vec![],
                evidence: vec![],
            },
        }
    }

    /// Preparation/restoration/Compose failures are definitive independently of Docker.
    pub fn fail(&mut self, reason: &str, observed_at: &str) -> HealthDiagnosis {
        self.fatal = true;
        self.diagnosis.result = ResultKind::Failed;
        self.diagnosis.complete = true;
        self.diagnosis.summary = self.policy.text(reason);
        self.record(observed_at, None, None, reason, None);
        self.diagnosis.clone()
    }

    pub fn evaluate(
        &mut self,
        observation: Result<&ComposeDiagnostics, &str>,
        phase: EvaluationPhase,
        observed_at: &str,
    ) -> HealthDiagnosis {
        if self.fatal {
            return self.diagnosis.clone();
        }
        if matches!(
            phase,
            EvaluationPhase::Interrupted | EvaluationPhase::RequestedStop
        ) {
            let reason = if phase == EvaluationPhase::RequestedStop {
                "evaluation ended by requested stop"
            } else {
                "evaluation interrupted"
            };
            // An inconclusive evaluation already has UNKNOWN. Keep completed
            // evaluations valid when KIDA deliberately stops the containers.
            self.diagnosis.summary = reason.into();
            self.diagnosis.complete = true;
            self.record(observed_at, None, None, reason, None);
            return self.diagnosis.clone();
        }
        let snapshot = observation
            .ok()
            .filter(|snapshot| snapshot.project == self.project);
        let mut uncertain = snapshot.is_none();
        if let Some(snapshot) = snapshot {
            let mut seen = BTreeSet::new();
            uncertain |= !snapshot.errors.is_empty()
                || snapshot.containers.iter().any(|row| {
                    !seen.insert(&row.diagnostics.container.id)
                        || !self
                            .expected
                            .iter()
                            .any(|service| Some(&service.name) == row.service.as_ref())
                });
        }
        let mut services = Vec::new();
        for expected in &self.expected {
            let mut results = Vec::new();
            let mut reasons = Vec::new();
            let rows: Vec<_> = snapshot
                .into_iter()
                .flat_map(|snapshot| &snapshot.containers)
                .filter(|row| row.service.as_deref() == Some(&expected.name))
                .collect();
            if expected.replicas == 0 {
                results.push(ResultKind::Unknown);
                reasons.push("service has zero expected replicas".into());
            } else if rows.len() < expected.replicas as usize {
                results.push(if uncertain {
                    ResultKind::Unknown
                } else {
                    ResultKind::Failed
                });
                reasons.push("required replicas missing or not inspected".into());
            } else if rows.len() > expected.replicas as usize {
                results.push(ResultKind::Unknown);
                reasons.push("unexpected replica count".into());
            }
            for row in rows {
                let diagnostic = &row.diagnostics;
                let container = &diagnostic.container;
                let restart = container.restart_count > 0 || diagnostic.oom_killed == Some(true);
                if restart {
                    self.incidents.insert(expected.name.clone());
                    let anomaly = self.policy.text(&format!(
                        "{} / {}: restarts={}, OOMKilled={:?}",
                        expected.name, container.id, container.restart_count, diagnostic.oom_killed
                    ));
                    if self.diagnosis.anomalies.len() < 128
                        && !self.diagnosis.anomalies.contains(&anomaly)
                    {
                        self.diagnosis.anomalies.push(anomaly);
                    }
                }
                let result = if matches!(container.status.as_str(), "exited" | "dead")
                    || diagnostic
                        .docker_error
                        .as_ref()
                        .is_some_and(|error| !error.is_empty())
                {
                    reasons.push(self.policy.text(&format!(
                        "{}: unexpected termination or Docker error (exit={:?})",
                        container.id, container.exit_code
                    )));
                    ResultKind::Failed
                } else if !container.online || container.status != "running" {
                    reasons.push("container is not currently operational".into());
                    ResultKind::Unknown
                } else {
                    match container.health.as_deref() {
                        Some("unhealthy") => {
                            reasons.push("required healthcheck is unhealthy".into());
                            ResultKind::Unhealthy
                        }
                        Some("healthy") => ResultKind::Healthy,
                        _ => {
                            reasons.push("required healthcheck is absent or pending".into());
                            ResultKind::Unknown
                        }
                    }
                };
                results.push(result);
            }
            if self.diagnosis.services.iter().any(|service| {
                service.service == expected.name && service.result == ResultKind::Failed
            }) {
                results.push(ResultKind::Failed);
                reasons.push("previously observed definitive failure".into());
            }
            let mut result = aggregate(results);
            if result == ResultKind::Healthy && self.incidents.contains(&expected.name) {
                result = ResultKind::Degraded;
                reasons.push("restarts or recovered OOM previously observed".into());
            }
            services.push(HealthServiceDiagnosis {
                service: expected.name.clone(),
                result,
                reasons,
            });
        }
        let extra = uncertain.then_some(ResultKind::Unknown);
        let result = aggregate(services.iter().map(|service| service.result).chain(extra));
        self.diagnosis.services = services;
        self.diagnosis.result = result;
        self.diagnosis.complete =
            phase == EvaluationPhase::TimedOut || result != ResultKind::Unknown;
        self.diagnosis.summary = match phase {
            EvaluationPhase::TimedOut => "diagnostic timeout reached".into(),
            _ => format!("technical result: {result:?}"),
        };
        if uncertain {
            let reason = observation
                .err()
                .unwrap_or("partial, unexpected or mismatched Docker observations");
            self.record(observed_at, None, None, reason, None);
            if let Some(snapshot) = snapshot {
                for error in &snapshot.errors {
                    self.record(observed_at, None, Some(&error.id), &error.error, None);
                }
            }
        }
        self.diagnosis.clone()
    }

    pub fn capture_logs(&mut self, observed_at: &str, service: Option<&str>, logs: &ContainerLogs) {
        match self.policy.logs(logs) {
            Ok(excerpt) => self.record(
                observed_at,
                service,
                Some(&logs.container),
                "Docker log evidence; no semantic interpretation",
                Some(excerpt),
            ),
            Err(reason) => self.record(observed_at, service, Some(&logs.container), reason, None),
        }
    }

    fn record(
        &mut self,
        observed_at: &str,
        service: Option<&str>,
        container: Option<&str>,
        description: &str,
        logs: Option<String>,
    ) {
        if self.diagnosis.evidence.len() < 128 {
            self.diagnosis.evidence.push(HealthEvidence {
                observed_at: observed_at.into(),
                service: service.map(|value| self.policy.text(value)),
                container_id: container.map(|value| self.policy.text(value)),
                description: self.policy.text(description),
                logs,
            });
        }
    }

    /// One deadline covers observation futures and polling. 07 owns cancellation and lifecycle.
    pub async fn observe_until<F, Fut>(
        &mut self,
        timeout: Duration,
        interval: Duration,
        mut observe: F,
    ) -> Result<HealthDiagnosis, String>
    where
        F: FnMut(Duration) -> Fut,
        Fut: Future<Output = Result<ComposeDiagnostics, String>>,
    {
        if timeout.is_zero() || interval.is_zero() {
            return Err("diagnostic timeout and interval must be positive".into());
        }
        if self.fatal {
            return Ok(self.diagnosis.clone());
        }
        let deadline = tokio::time::Instant::now()
            .checked_add(timeout)
            .ok_or("diagnostic timeout too large")?;
        loop {
            let now = tokio::time::Instant::now();
            if now >= deadline {
                return Ok(self.finish_timeout("diagnostic timeout reached"));
            }
            let observed = tokio::time::timeout_at(deadline, observe(deadline - now)).await;
            let result = match observed {
                Ok(ref observation) => self.evaluate(
                    observation.as_ref().map_err(String::as_str),
                    EvaluationPhase::Observing,
                    &chrono::Utc::now().to_rfc3339(),
                ),
                Err(_) => return Ok(self.finish_timeout("Docker observation timed out")),
            };
            if result.complete {
                return Ok(result);
            }
            tokio::time::sleep(
                interval.min(deadline.saturating_duration_since(tokio::time::Instant::now())),
            )
            .await;
        }
    }

    fn finish_timeout(&mut self, reason: &str) -> HealthDiagnosis {
        self.diagnosis.complete = true;
        self.diagnosis.summary = reason.into();
        self.record(&chrono::Utc::now().to_rfc3339(), None, None, reason, None);
        self.diagnosis.clone()
    }

    pub async fn diagnose(&mut self, timeout: Duration) -> Result<HealthDiagnosis, String> {
        let project = self.project.clone();
        self.observe_until(timeout, Duration::from_secs(1), move |budget| {
            let project = project.clone();
            async move { DockerService::diagnose_compose_project(&project, budget).await }
        })
        .await
    }
}

pub fn aggregate(results: impl IntoIterator<Item = ResultKind>) -> ResultKind {
    results
        .into_iter()
        .max_by_key(|result| match result {
            ResultKind::Failed => 5,
            ResultKind::Unhealthy => 4,
            ResultKind::Unknown => 3,
            ResultKind::Degraded => 2,
            ResultKind::Healthy => 1,
        })
        .unwrap_or(ResultKind::Unknown)
}

#[cfg(test)]
#[path = "diagnosis_tests.rs"]
mod tests;
