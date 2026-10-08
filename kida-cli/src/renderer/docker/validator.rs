use serde_json::Value;

use crate::renderer::{
    RenderError,
    json::{nullable_string, nullable_u64, string, value_object},
};

pub(super) fn render_ports(ports: &[Value], path: &str) -> Result<String, RenderError> {
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

pub(super) fn validate_networks(networks: &[Value], path: &str) -> Result<(), RenderError> {
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
