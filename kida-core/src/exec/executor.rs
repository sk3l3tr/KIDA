use crate::{
    comm::protocol::{CommandRequest, CommandResponse, CommandStatus},
    exec::commands::{
        self,
        docker::{docker_container_start, docker_container_stop, docker_containers_list},
        sys::{system_health, system_info, system_reboot, system_shutdown},
    },
};

pub async fn execute(request: CommandRequest) -> CommandResponse {
    match request.command.as_str() {
        "health" => commands::health(request).await,

        "system.info" => system_info::exec(request).await,
        "system.health" => system_health::exec(request).await,
        "system.shutdown" => system_shutdown::exec(request).await,
        "system.reboot" => system_reboot::exec(request).await,

        "docker.containers.list" => docker_containers_list::exec(request).await,
        "docker.container.stop" => docker_container_stop::exec(request).await,
        "docker.container.start" => docker_container_start::exec(request).await,

        _ => CommandResponse {
            id: request.id,
            status: CommandStatus::Error,
            data: None,
            error: Some(format!("Unknown command: {}", request.command)),
        },
    }
}
