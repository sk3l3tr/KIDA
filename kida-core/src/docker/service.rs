use std::process::Command;

use serde_json::Value;

use super::model::{DockerContainer, DockerContainers, DockerNetwork, DockerPort};

pub struct DockerService;

impl DockerService {
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
        let ids = get_container_ids()?;

        if ids.is_empty() {
            return Ok(DockerContainers {
                total: 0,
                running: 0,
                containers: Vec::new(),
            });
        }

        let output = Command::new("docker")
            .arg("inspect")
            .args(&ids)
            .output()
            .map_err(|e| format!("Cannot execute docker inspect: {e}"))?;

        if !output.status.success() {
            return Err(command_error("docker inspect failed", &output.stderr));
        }

        let inspected: Vec<Value> = serde_json::from_slice(&output.stdout)
            .map_err(|e| format!("Cannot parse docker inspect output: {e}"))?;

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

fn get_container_ids() -> Result<Vec<String>, String> {
    let output = Command::new("docker")
        .args(["ps", "-aq"])
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
