use serde_json::Value;

use crate::protocol::CommandResponse;

use super::{
    RenderError, array, boolean, data, nullable_i64, nullable_string, nullable_u64, string,
    u64_value, value_object,
};

pub(super) fn container_action(response: &CommandResponse) -> Result<String, RenderError> {
    let data = data(response)?;
    let container = string(data, "container", "data.container")?;
    let status = string(data, "status", "data.status")?;
    Ok(format!("Container {container} is {status}."))
}

pub(super) fn containers_list(response: &CommandResponse) -> Result<String, RenderError> {
    let data = data(response)?;
    let total = u64_value(data, "total", "data.total")?;
    let running = u64_value(data, "running", "data.running")?;
    let containers = array(data, "containers", "data.containers")?;

    if containers.is_empty() {
        return Ok(format!(
            "Containers: {total} total, {running} running\nNo containers found."
        ));
    }

    let mut rows = Vec::with_capacity(containers.len());
    for (index, value) in containers.iter().enumerate() {
        let path = format!("data.containers[{index}]");
        let container = value_object(value, &path)?;
        let id = string(container, "id", &format!("{path}.id"))?;
        let name = string(container, "name", &format!("{path}.name"))?;
        let image = string(container, "image", &format!("{path}.image"))?;
        boolean(container, "online", &format!("{path}.online"))?;
        let status = string(container, "status", &format!("{path}.status"))?;
        let health =
            nullable_string(container, "health", &format!("{path}.health"))?.unwrap_or("—");
        nullable_string(container, "started_at", &format!("{path}.started_at"))?;
        nullable_string(container, "finished_at", &format!("{path}.finished_at"))?;
        nullable_i64(container, "exit_code", &format!("{path}.exit_code"))?;
        u64_value(container, "restart_count", &format!("{path}.restart_count"))?;
        nullable_string(
            container,
            "restart_policy",
            &format!("{path}.restart_policy"),
        )?;
        let ports = array(container, "ports", &format!("{path}.ports"))?;
        let ports = render_ports(ports, &format!("{path}.ports"))?;
        validate_networks(
            array(container, "networks", &format!("{path}.networks"))?,
            &format!("{path}.networks"),
        )?;

        rows.push(vec![
            id.chars().take(12).collect(),
            name.to_string(),
            image.to_string(),
            status.to_string(),
            health.to_string(),
            ports,
        ]);
    }

    Ok(format!(
        "Containers: {total} total, {running} running\n{}",
        table(&["ID", "NAME", "IMAGE", "STATUS", "HEALTH", "PORTS"], &rows)
    ))
}

fn render_ports(ports: &[Value], path: &str) -> Result<String, RenderError> {
    if ports.is_empty() {
        return Ok("—".to_string());
    }

    let mut output = Vec::with_capacity(ports.len());
    for (index, value) in ports.iter().enumerate() {
        let item_path = format!("{path}[{index}]");
        let port = value_object(value, &item_path)?;
        let container_port = nullable_u64(
            port,
            "container_port",
            &format!("{item_path}.container_port"),
        )?;
        if container_port.is_some_and(|value| value > u16::MAX.into()) {
            return Err(RenderError::invalid(
                &format!("{item_path}.container_port"),
                "a valid port number or null",
            ));
        }
        let container_port =
            container_port.map_or_else(|| "unknown".to_string(), |value| value.to_string());
        let protocol = string(port, "protocol", &format!("{item_path}.protocol"))?;
        let host_ip = nullable_string(port, "host_ip", &format!("{item_path}.host_ip"))?;
        let host_port = nullable_string(port, "host_port", &format!("{item_path}.host_port"))?;

        let destination = format!("{container_port}/{protocol}");
        output.push(match (host_ip, host_port) {
            (Some(ip), Some(port)) => format!("{ip}:{port}->{destination}"),
            (None, Some(port)) => format!("{port}->{destination}"),
            _ => destination,
        });
    }

    Ok(output.join(", "))
}

fn validate_networks(networks: &[Value], path: &str) -> Result<(), RenderError> {
    for (index, value) in networks.iter().enumerate() {
        let item_path = format!("{path}[{index}]");
        let network = value_object(value, &item_path)?;
        string(network, "name", &format!("{item_path}.name"))?;
        nullable_string(network, "ip_address", &format!("{item_path}.ip_address"))?;
        nullable_string(network, "gateway", &format!("{item_path}.gateway"))?;
        nullable_string(network, "mac_address", &format!("{item_path}.mac_address"))?;
    }
    Ok(())
}

fn table(headers: &[&str], rows: &[Vec<String>]) -> String {
    let widths: Vec<_> = headers
        .iter()
        .enumerate()
        .map(|(column, header)| {
            rows.iter()
                .map(|row| row[column].chars().count())
                .max()
                .unwrap_or(0)
                .max(header.len())
        })
        .collect();

    let format_row = |row: &[String]| {
        row.iter()
            .enumerate()
            .map(|(column, value)| format!("{value:<width$}", width = widths[column]))
            .collect::<Vec<_>>()
            .join("  ")
            .trim_end()
            .to_string()
    };

    let headers = headers
        .iter()
        .map(|value| (*value).to_string())
        .collect::<Vec<_>>();
    let mut output = vec![format_row(&headers)];
    output.extend(rows.iter().map(|row| format_row(row)));
    output.join("\n")
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::protocol::CommandStatus;

    fn response(data: Option<Value>) -> CommandResponse {
        CommandResponse {
            id: "1".into(),
            status: CommandStatus::Ok,
            data,
            error: None,
        }
    }

    #[test]
    fn renders_an_empty_container_list() {
        let output = containers_list(&response(Some(json!({
            "total": 0,
            "running": 0,
            "containers": []
        }))))
        .unwrap();

        assert_eq!(
            output,
            "Containers: 0 total, 0 running\nNo containers found."
        );
    }

    #[test]
    fn renders_multiple_containers_and_ports() {
        let data = json!({
            "total": 2,
            "running": 1,
            "containers": [
                {
                    "id": "1234567890abcdef", "name": "web", "image": "nginx:latest",
                    "online": true, "status": "running", "health": "healthy",
                    "started_at": "today", "finished_at": null, "exit_code": 0,
                    "restart_count": 0, "restart_policy": "always",
                    "ports": [
                        {"container_port": 80, "protocol": "tcp", "host_ip": "0.0.0.0", "host_port": "8080"},
                        {"container_port": 443, "protocol": "tcp", "host_ip": null, "host_port": null}
                    ],
                    "networks": []
                },
                {
                    "id": "fedcba9876543210", "name": "worker", "image": "worker:v1",
                    "online": false, "status": "exited", "health": null,
                    "started_at": null, "finished_at": "today", "exit_code": 1,
                    "restart_count": 2, "restart_policy": null, "ports": [], "networks": []
                }
            ]
        });

        let output = containers_list(&response(Some(data))).unwrap();

        assert!(output.contains("Containers: 2 total, 1 running"));
        assert!(output.contains("1234567890ab  web"));
        assert!(output.contains("0.0.0.0:8080->80/tcp, 443/tcp"));
        assert!(output.contains("fedcba987654  worker"));
        assert!(output.lines().any(|line| {
            line.contains("fedcba987654") && line.contains("exited") && line.contains('—')
        }));
    }

    #[test]
    fn renders_all_four_action_contracts() {
        for (status, expected) in [
            ("running", "Container web is running."),
            ("stopped", "Container web is stopped."),
            ("restarted", "Container web is restarted."),
            ("deleted", "Container web is deleted."),
        ] {
            let response = response(Some(json!({"container": "web", "status": status})));
            assert_eq!(container_action(&response).unwrap(), expected);
        }
    }

    #[test]
    fn rejects_missing_data_fields_and_wrong_types() {
        assert!(containers_list(&response(None)).is_err());
        assert!(
            containers_list(&response(Some(
                json!({"total": 0, "running": "none", "containers": []})
            )))
            .is_err()
        );
        assert!(container_action(&response(Some(json!({"container": "web"})))).is_err());
    }
}
