use crate::protocol::CommandResponse;
use crate::renderer::docker::validator::{render_ports, validate_networks};
use crate::renderer::format::table;
use crate::renderer::{
    RenderError,
    json::{array, boolean, data, nullable_i64, nullable_string, string, u64_value, value_object},
};

pub fn container_action(response: &CommandResponse) -> Result<String, RenderError> {
    let data = data(response)?;
    let container = string(data, "container", "data.container")?;
    let status = string(data, "status", "data.status")?;
    Ok(format!("Container {container} is {status}."))
}

pub fn containers_list(response: &CommandResponse) -> Result<String, RenderError> {
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
