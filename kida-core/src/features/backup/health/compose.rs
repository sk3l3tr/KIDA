use std::{path::Path, time::Duration};

use uuid::Uuid;

use super::model::{HealthResource, HealthService};
use crate::features::docker::{
    ComposeConfiguration, ComposeOptions, DockerService, ManagedProject, RemovalReport,
};

/// Per-run adapter. Lifecycle coordination and persistence belong to its caller.
pub struct HealthCompose {
    options: ComposeOptions,
    pub configuration: ComposeConfiguration,
    pub project: Option<ManagedProject>,
    pub resources: Vec<HealthResource>,
}

impl HealthCompose {
    pub async fn prepare(
        run_id: &str,
        compose: &Path,
        restore_dir: &Path,
        timeout: Duration,
    ) -> Result<Self, String> {
        let id = Uuid::parse_str(run_id).map_err(|error| format!("Health run ID: {error}"))?;
        if !restore_dir.is_absolute() || !restore_dir.is_dir() {
            return Err("Health restore directory must be an existing absolute directory".into());
        }
        let mut options = ComposeOptions::new(format!("kida-bh-{id}"), compose);
        options.timeout = timeout;
        options.require_no_restart = true;
        options.variables.insert(
            "KIDA_RESTORE_DIR".into(),
            restore_dir
                .to_str()
                .ok_or("Health restore directory must be UTF-8")?
                .into(),
        );
        let configuration = DockerService::compose_configuration(&options).await?;
        options.file = configuration.file.clone();
        options.expected_configuration = Some(configuration.clone());
        Ok(Self {
            options,
            configuration,
            project: None,
            resources: vec![],
        })
    }

    pub fn services(&self) -> Vec<HealthService> {
        self.configuration
            .services
            .iter()
            .map(|service| HealthService {
                name: service.name.clone(),
                // Build-only services have no configured image; diagnostics inspects the real image.
                image: service.image.clone().unwrap_or_default(),
                replicas: service.replicas,
            })
            .collect()
    }

    /// Retain identity and captured resources on failure as well as success.
    pub async fn create(&mut self) -> Result<(), String> {
        let result = DockerService::compose_create_tracked(&self.options, &mut self.project).await;
        if let Some(reference) = &self.project {
            self.options.expected_owner = Some(reference.owner.clone());
            let captured =
                DockerService::compose_managed_resources(reference, self.options.timeout).await;
            match captured {
                Ok(resources) => {
                    self.resources = resources
                        .into_iter()
                        .map(|resource| HealthResource {
                            kind: resource.kind,
                            identity: resource.identity,
                        })
                        .collect()
                }
                Err(error) => {
                    return Err(match result {
                        Ok(()) => error,
                        Err(primary) => {
                            format!("{primary}; resource evidence unavailable: {error}")
                        }
                    });
                }
            }
        }
        result
    }

    pub async fn start(&self) -> Result<(), String> {
        self.require_project()?;
        DockerService::compose_start(&self.options).await
    }

    pub async fn stop(&self) -> Result<(), String> {
        self.require_project()?;
        DockerService::compose_stop(&self.options).await
    }

    pub async fn remove(&self) -> Result<RemovalReport, String> {
        DockerService::compose_remove(self.require_project()?, self.options.timeout).await
    }

    fn require_project(&self) -> Result<&ManagedProject, String> {
        self.project
            .as_ref()
            .ok_or_else(|| "Health Compose project has not been created".into())
    }
}

#[cfg(test)]
#[path = "compose_tests.rs"]
mod tests;
