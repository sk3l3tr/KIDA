use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct ComposeVersion {
    pub version: String,
}

/// An observed project in the current Docker daemon, not a KIDA ownership claim.
#[derive(Debug, Serialize)]
pub struct ComposeProject {
    pub name: String,
    pub services: Vec<ComposeService>,
}

#[derive(Debug, Serialize)]
pub struct ComposeService {
    pub name: Option<String>,
    pub containers: Vec<DockerContainer>,
}

#[derive(Debug, Serialize)]
pub struct DockerContainers {
    pub total: usize,
    pub running: usize,
    pub containers: Vec<DockerContainer>,
}

#[derive(Debug, Serialize)]
pub struct DockerContainer {
    pub id: String,
    pub name: String,
    pub image: String,

    pub online: bool,
    pub status: String,
    pub health: Option<String>,

    pub started_at: Option<String>,
    pub finished_at: Option<String>,

    pub exit_code: Option<i64>,
    pub restart_count: u64,
    pub restart_policy: Option<String>,

    pub ports: Vec<DockerPort>,
    pub networks: Vec<DockerNetwork>,
}

#[derive(Debug, Serialize)]
pub struct DockerPort {
    pub container_port: Option<u16>,
    pub protocol: String,
    pub host_ip: Option<String>,
    pub host_port: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct DockerNetwork {
    pub name: String,
    pub ip_address: Option<String>,
    pub gateway: Option<String>,
    pub mac_address: Option<String>,
}

/// Current Docker observations, not a history. Exit codes do not establish OOM.
#[derive(Debug, Serialize)]
#[cfg_attr(
    not(test),
    allow(
        dead_code,
        reason = "Docker diagnostic type retained for production integration; covered by tests"
    )
)]
pub struct ContainerDiagnostics {
    pub container: DockerContainer,
    pub oom_killed: Option<bool>,
    pub docker_error: Option<String>,
}

#[derive(Debug, Serialize)]
#[cfg_attr(
    not(test),
    allow(
        dead_code,
        reason = "Docker diagnostic type retained for production integration; covered by tests"
    )
)]
pub struct ComposeContainerDiagnostics {
    pub service: Option<String>,
    pub diagnostics: ContainerDiagnostics,
}

#[derive(Debug, Serialize)]
#[cfg_attr(
    not(test),
    allow(
        dead_code,
        reason = "Docker diagnostic type retained for production integration; covered by tests"
    )
)]
pub struct ContainerDiagnosticError {
    pub id: String,
    pub error: String,
}

/// Only containers currently enumerated by Docker; undeployed services are unknown.
#[derive(Debug, Serialize)]
#[cfg_attr(
    not(test),
    allow(
        dead_code,
        reason = "Docker diagnostic type retained for production integration; covered by tests"
    )
)]
pub struct ComposeDiagnostics {
    pub project: String,
    pub containers: Vec<ComposeContainerDiagnostics>,
    pub errors: Vec<ContainerDiagnosticError>,
}

/// Raw, bounded output. Callers must handle potentially sensitive content carefully.
#[derive(Debug, Serialize)]
#[cfg_attr(
    not(test),
    allow(
        dead_code,
        reason = "Docker diagnostic type retained for production integration; covered by tests"
    )
)]
pub struct ContainerLogs {
    pub container: String,
    pub tail: u32,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub warning: String,
}
