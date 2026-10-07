use serde_json::json;

use crate::{
    cli::{ContainerCommand, ContainersCommand, DockerCommand},
    protocol::CommandRequest,
};

use super::{empty_params, request};

impl From<DockerCommand> for CommandRequest {
    fn from(command: DockerCommand) -> Self {
        match command {
            DockerCommand::Containers { command } => command.into(),
            DockerCommand::Container { command } => command.into(),
        }
    }
}

impl From<ContainersCommand> for CommandRequest {
    fn from(command: ContainersCommand) -> Self {
        match command {
            ContainersCommand::List => request("docker.containers.list", empty_params()),
        }
    }
}

impl From<ContainerCommand> for CommandRequest {
    fn from(command: ContainerCommand) -> Self {
        let (command, container) = match command {
            ContainerCommand::Start { container } => ("docker.container.start", container),
            ContainerCommand::Stop { container } => ("docker.container.stop", container),
            ContainerCommand::Restart { container } => ("docker.container.restart", container),
            ContainerCommand::Delete { container } => ("docker.container.delete", container),
        };

        request(command, json!({ "container": container }))
    }
}
