use std::process::Command;

use serde_json::{Value, json};

use crate::comm::protocol::{CommandRequest, CommandResponse, CommandStatus};

pub async fn exec(request: CommandRequest) -> CommandResponse {
    match collect_containers() {
        Ok(containers) => CommandResponse {
            id: request.id,
            status: CommandStatus::Ok,
            data: Some(json!({
                "total": containers.len(),
                "running": containers
                    .iter()
                    .filter(|container| {
                        container
                            .get("online")
                            .and_then(Value::as_bool)
                            .unwrap_or(false)
                    })
                    .count(),
                "containers": containers,
            })),
            error: None,
        },

        Err(error) => CommandResponse {
            id: request.id,
            status: CommandStatus::Error,
            data: None,
            error: Some(error),
        },
    }
}

fn collect_containers() -> Result<Vec<Value>, String> {
    let ids = get_container_ids()?;

    if ids.is_empty() {
        return Ok(Vec::new());
    }

    let output = Command::new("docker")
        .arg("inspect")
        .args(&ids)
        .output()
        .map_err(|e| format!("Cannot execute docker inspect: {e}"))?;

    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr);

        return Err(format!("docker inspect failed: {}", error.trim()));
    }

    let inspected: Vec<Value> = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Cannot parse docker inspect output: {e}"))?;

    Ok(inspected.iter().map(map_container).collect())
}

fn get_container_ids() -> Result<Vec<String>, String> {
    let output = Command::new("docker")
        .args(["ps", "-aq"])
        .output()
        .map_err(|e| format!("Cannot execute docker ps: {e}"))?;

    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr);

        return Err(format!("docker ps failed: {}", error.trim()));
    }

    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(ToOwned::to_owned)
        .collect())
}

fn map_container(container: &Value) -> Value {
    let state = container.get("State").unwrap_or(&Value::Null);
    let config = container.get("Config").unwrap_or(&Value::Null);
    let host_config = container.get("HostConfig").unwrap_or(&Value::Null);
    let network_settings = container.get("NetworkSettings").unwrap_or(&Value::Null);

    let name = container
        .get("Name")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .trim_start_matches('/')
        .to_string();

    let status = state
        .get("Status")
        .and_then(Value::as_str)
        .unwrap_or("unknown");

    let online = state
        .get("Running")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    let health = state
        .get("Health")
        .and_then(|health| health.get("Status"))
        .and_then(Value::as_str);

    let image = config
        .get("Image")
        .and_then(Value::as_str)
        .unwrap_or("unknown");

    let restart_policy = host_config
        .get("RestartPolicy")
        .and_then(|policy| policy.get("Name"))
        .and_then(Value::as_str);

    json!({
        "id": container
            .get("Id")
            .and_then(Value::as_str)
            .unwrap_or(""),

        "name": name,
        "image": image,

        "online": online,
        "status": status,
        "health": health,

        "started_at": state
            .get("StartedAt")
            .and_then(Value::as_str),

        "finished_at": state
            .get("FinishedAt")
            .and_then(Value::as_str),

        "exit_code": state
            .get("ExitCode")
            .and_then(Value::as_i64),

        "restart_count": container
            .get("RestartCount")
            .and_then(Value::as_u64)
            .unwrap_or(0),

        "restart_policy": restart_policy,

        "ports": collect_ports(network_settings),

        "networks": collect_networks(network_settings),
    })
}

fn collect_ports(network_settings: &Value) -> Vec<Value> {
    let Some(ports) = network_settings.get("Ports").and_then(Value::as_object) else {
        return Vec::new();
    };

    let mut result = Vec::new();

    for (container_port, bindings) in ports {
        let (port, protocol) = parse_port(container_port);

        match bindings {
            Value::Array(bindings) => {
                for binding in bindings {
                    result.push(json!({
                        "container_port": port,
                        "protocol": protocol,

                        "host_ip": binding
                            .get("HostIp")
                            .and_then(Value::as_str),

                        "host_port": binding
                            .get("HostPort")
                            .and_then(Value::as_str),
                    }));
                }
            }

            // Docker puede exponer un puerto internamente sin
            // publicarlo en ninguna interfaz del host.
            Value::Null => {
                result.push(json!({
                    "container_port": port,
                    "protocol": protocol,
                    "host_ip": null,
                    "host_port": null,
                }));
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

fn collect_networks(network_settings: &Value) -> Vec<Value> {
    let Some(networks) = network_settings.get("Networks").and_then(Value::as_object) else {
        return Vec::new();
    };

    networks
        .iter()
        .map(|(name, network)| {
            json!({
                "name": name,

                "ip_address": network
                    .get("IPAddress")
                    .and_then(Value::as_str),

                "gateway": network
                    .get("Gateway")
                    .and_then(Value::as_str),

                "mac_address": network
                    .get("MacAddress")
                    .and_then(Value::as_str),
            })
        })
        .collect()
}
