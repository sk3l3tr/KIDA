use serde_json::json;

use crate::{
    cli::{ContainerCommand, ContainersCommand, DockerCommand},
    protocol::CommandRequest,
};

use super::{empty_params, request};

pub(super) fn map(command: DockerCommand) -> CommandRequest {
    match command {
        DockerCommand::Containers { command } => map_containers(command),
        DockerCommand::Container { command } => map_container(command),
    }
}

fn map_containers(command: ContainersCommand) -> CommandRequest {
    match command {
        ContainersCommand::List => request("docker.containers.list", empty_params()),
    }
}

fn map_container(command: ContainerCommand) -> CommandRequest {
    let (command, container) = match command {
        ContainerCommand::Start { container } => ("docker.container.start", container),
        ContainerCommand::Stop { container } => ("docker.container.stop", container),
        ContainerCommand::Restart { container } => ("docker.container.restart", container),
        ContainerCommand::Delete { container } => ("docker.container.delete", container),
    };

    request(command, json!({ "container": container }))
}
