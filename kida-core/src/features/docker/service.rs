use std::{collections::BTreeMap, process::Command};

use serde_json::Value;

use super::{
    ComposeProject, ComposeService, ComposeVersion, DockerContainer, DockerContainers,
    DockerNetwork, DockerPort,
};

pub struct DockerService;

impl DockerService {
    /// Validates a lifecycle project identifier without normalizing it or invoking Docker.
    pub fn validate_compose_project_name(name: &str) -> Result<(), String> {
        let valid_start = name
            .bytes()
            .next()
            .is_some_and(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit());
        let valid_chars = name.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'_' | b'-')
        });

        if !valid_start || !valid_chars {
            return Err(
                "Invalid Compose project identifier: expected [a-z0-9][a-z0-9_-]*".to_string(),
            );
        }

        Ok(())
    }

    pub fn compose_version() -> Result<ComposeVersion, String> {
        let output = Command::new("docker")
            .args(["compose", "version", "--short"])
            .output()
            .map_err(|e| format!("Cannot execute docker compose version: {e}"))?;

        if !output.status.success() {
            return Err(command_error(
                "docker compose version failed",
                &output.stderr,
            ));
        }

        let version = String::from_utf8(output.stdout)
            .map_err(|e| format!("Invalid docker compose version output: {e}"))?
            .trim()
            .to_string();

        if version.is_empty() {
            return Err("Docker Compose returned an empty version".to_string());
        }

        Ok(ComposeVersion { version })
    }

    pub fn compose_projects() -> Result<Vec<ComposeProject>, String> {
        let ids = get_container_ids(&["--filter", "label=com.docker.compose.project"])?;
        Ok(map_compose_projects(&inspect_containers(&ids)?))
    }

    pub fn compose_project(name: &str) -> Result<ComposeProject, String> {
        let name = name.trim();
        if name.is_empty() {
            return Err("Compose project cannot be empty".to_string());
        }

        let filter = format!("label=com.docker.compose.project={name}");
        let ids = get_container_ids(&["--filter", &filter])?;
        map_compose_projects(&inspect_containers(&ids)?)
            .into_iter()
            .find(|project| project.name == name)
            .ok_or_else(|| format!("Compose project '{name}' not found"))
    }

    pub fn start(container: &str) -> Result<(), String> {
        run_container_action("start", container)
    }

    pub fn stop(container: &str) -> Result<(), String> {
        run_container_action("stop", container)
    }

    pub fn restart(container: &str) -> Result<(), String> {
        run_container_action("restart", container)
    }

    pub fn delete(container: &str) -> Result<(), String> {
        run_container_action("rm", container)
    }

    pub fn list() -> Result<DockerContainers, String> {
        let ids = get_container_ids(&[])?;
        let inspected = inspect_containers(&ids)?;
        let containers: Vec<DockerContainer> = inspected.iter().map(map_container).collect();

        let running = containers
            .iter()
            .filter(|container| container.online)
            .count();

        Ok(DockerContainers {
            total: containers.len(),
            running,
            containers,
        })
    }
}

fn run_container_action(action: &str, container: &str) -> Result<(), String> {
    let container = container.trim();

    if container.is_empty() {
        return Err("Container cannot be empty".to_string());
    }

    let output = Command::new("docker")
        .args([action, container])
        .output()
        .map_err(|e| format!("Cannot execute docker {action}: {e}"))?;

    if !output.status.success() {
        return Err(command_error(
            &format!("docker {action} failed for '{container}'"),
            &output.stderr,
        ));
    }

    Ok(())
}

fn get_container_ids(filters: &[&str]) -> Result<Vec<String>, String> {
    let output = Command::new("docker")
        .args(["ps", "-aq"])
        .args(filters)
        .output()
        .map_err(|e| format!("Cannot execute docker ps: {e}"))?;

    if !output.status.success() {
        return Err(command_error("docker ps failed", &output.stderr));
    }

    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(ToOwned::to_owned)
        .collect())
}

fn inspect_containers(ids: &[String]) -> Result<Vec<Value>, String> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }

    let output = Command::new("docker")
        .arg("inspect")
        .args(ids)
        .output()
        .map_err(|e| format!("Cannot execute docker inspect: {e}"))?;

    if !output.status.success() {
        return Err(command_error("docker inspect failed", &output.stderr));
    }

    serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Cannot parse docker inspect output: {e}"))
}

pub(super) fn map_compose_projects(inspected: &[Value]) -> Vec<ComposeProject> {
    let mut projects: BTreeMap<String, BTreeMap<Option<String>, Vec<DockerContainer>>> =
        BTreeMap::new();

    for container in inspected {
        let labels = &container["Config"]["Labels"];
        let Some(project) = labels["com.docker.compose.project"]
            .as_str()
            .filter(|name| !name.trim().is_empty())
        else {
            continue;
        };
        let service = labels["com.docker.compose.service"]
            .as_str()
            .filter(|name| !name.trim().is_empty())
            .map(ToOwned::to_owned);

        projects
            .entry(project.to_string())
            .or_default()
            .entry(service)
            .or_default()
            .push(map_container(container));
    }

    projects
        .into_iter()
        .map(|(name, services)| ComposeProject {
            name,
            services: services
                .into_iter()
                .map(|(name, mut containers)| {
                    containers.sort_by(|a, b| a.id.cmp(&b.id));
                    ComposeService { name, containers }
                })
                .collect(),
        })
        .collect()
}

fn map_container(container: &Value) -> DockerContainer {
    let state = container.get("State").unwrap_or(&Value::Null);
    let config = container.get("Config").unwrap_or(&Value::Null);
    let host_config = container.get("HostConfig").unwrap_or(&Value::Null);
    let network_settings = container.get("NetworkSettings").unwrap_or(&Value::Null);

    DockerContainer {
        id: container
            .get("Id")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),

        name: container
            .get("Name")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .trim_start_matches('/')
            .to_string(),

        image: config
            .get("Image")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string(),

        online: state
            .get("Running")
            .and_then(Value::as_bool)
            .unwrap_or(false),

        status: state
            .get("Status")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string(),

        health: state
            .get("Health")
            .and_then(|health| health.get("Status"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),

        started_at: state
            .get("StartedAt")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),

        finished_at: state
            .get("FinishedAt")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),

        exit_code: state.get("ExitCode").and_then(Value::as_i64),

        restart_count: container
            .get("RestartCount")
            .and_then(Value::as_u64)
            .unwrap_or(0),

        restart_policy: host_config
            .get("RestartPolicy")
            .and_then(|policy| policy.get("Name"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),

        ports: collect_ports(network_settings),

        networks: collect_networks(network_settings),
    }
}

fn collect_ports(network_settings: &Value) -> Vec<DockerPort> {
    let Some(ports) = network_settings.get("Ports").and_then(Value::as_object) else {
        return Vec::new();
    };

    let mut result = Vec::new();

    for (container_port, bindings) in ports {
        let (port, protocol) = parse_port(container_port);

        match bindings {
            Value::Array(bindings) => {
                for binding in bindings {
                    result.push(DockerPort {
                        container_port: port,
                        protocol: protocol.to_string(),

                        host_ip: binding
                            .get("HostIp")
                            .and_then(Value::as_str)
                            .map(ToOwned::to_owned),

                        host_port: binding
                            .get("HostPort")
                            .and_then(Value::as_str)
                            .map(ToOwned::to_owned),
                    });
                }
            }

            Value::Null => {
                result.push(DockerPort {
                    container_port: port,
                    protocol: protocol.to_string(),
                    host_ip: None,
                    host_port: None,
                });
            }

            _ => {}
        }
    }

    result
}

fn parse_port(value: &str) -> (Option<u16>, &str) {
    let mut parts = value.splitn(2, '/');

    let port = parts.next().and_then(|value| value.parse::<u16>().ok());

    let protocol = parts.next().unwrap_or("tcp");

    (port, protocol)
}

fn collect_networks(network_settings: &Value) -> Vec<DockerNetwork> {
    let Some(networks) = network_settings.get("Networks").and_then(Value::as_object) else {
        return Vec::new();
    };

    networks
        .iter()
        .map(|(name, network)| DockerNetwork {
            name: name.clone(),

            ip_address: network
                .get("IPAddress")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned),

            gateway: network
                .get("Gateway")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned),

            mac_address: network
                .get("MacAddress")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned),
        })
        .collect()
}

fn command_error(prefix: &str, stderr: &[u8]) -> String {
    let error = String::from_utf8_lossy(stderr).trim().to_string();

    if error.is_empty() {
        prefix.to_string()
    } else {
        format!("{prefix}: {error}")
    }
}
