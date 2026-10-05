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

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::{
        cli::{ContainerCommand, ContainersCommand, DockerCommand},
        protocol::CommandRequest,
    };

    #[test]
    fn maps_containers_list() {
        let request = CommandRequest::from(DockerCommand::Containers {
            command: ContainersCommand::List,
        });

        assert_eq!(request.command, "docker.containers.list");
        assert_eq!(request.params, json!({}));
        assert!(!request.id.is_empty());
    }

    #[test]
    fn maps_every_container_command() {
        let cases = [
            (
                ContainerCommand::Start {
                    container: "web".into(),
                },
                "docker.container.start",
                "web",
            ),
            (
                ContainerCommand::Stop {
                    container: "abc123".into(),
                },
                "docker.container.stop",
                "abc123",
            ),
            (
                ContainerCommand::Restart {
                    container: "api".into(),
                },
                "docker.container.restart",
                "api",
            ),
            (
                ContainerCommand::Delete {
                    container: "old-db".into(),
                },
                "docker.container.delete",
                "old-db",
            ),
        ];

        for (command, expected_command, expected_container) in cases {
            let request = CommandRequest::from(command);

            assert_eq!(request.command, expected_command);
            assert_eq!(request.params, json!({ "container": expected_container }));
            assert!(!request.id.is_empty());
        }
    }
}
