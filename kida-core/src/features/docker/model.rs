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
