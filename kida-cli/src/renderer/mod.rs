mod backup;
mod docker;
mod scheduler;
mod system;

mod error;
mod format;
mod json;

use serde_json::Value;

use crate::protocol::CommandResponse;
use error::RenderError;

type Renderer = fn(&CommandResponse) -> Result<String, RenderError>;

const RENDERERS: &[(&str, Renderer)] = &[
    ("system.power_cycle", system::power_cycle),
    ("system.wake_capabilities", system::wake_capabilities),
    ("scheduler.add", scheduler::add),
    ("scheduler.list", scheduler::list),
    ("scheduler.delete", scheduler::delete),
    ("system.info", system::info),
    ("system.health", system::health),
    ("system.shutdown", system::shutdown),
    ("system.reboot", system::reboot),
    ("docker.containers.list", docker::container::containers_list),
    (
        "docker.container.start",
        docker::container::container_action,
    ),
    ("docker.container.stop", docker::container::container_action),
    (
        "docker.container.restart",
        docker::container::container_action,
    ),
    (
        "docker.container.delete",
        docker::container::container_action,
    ),
    ("backup.config.create", backup::config::create),
    ("backup.config.delete", backup::config::delete),
    ("backup.config.list", backup::config::list),
    ("backup.run", backup::run::run),
];

pub fn render(command: &str, response: &CommandResponse) -> Result<String, RenderError> {
    match renderer_for(command) {
        Some(renderer) => renderer(response),
        None => serde_json::to_string_pretty(response.data.as_ref().unwrap_or(&Value::Null))
            .map_err(|error| RenderError(format!("cannot serialize response data: {error}"))),
    }
}

fn renderer_for(command: &str) -> Option<Renderer> {
    RENDERERS
        .iter()
        .find(|(id, _)| *id == command)
        .map(|(_, renderer)| *renderer)
}

#[cfg(test)]
pub(crate) mod tests;
