use crate::{
    comm::protocol::{CommandRequest, CommandResponse, CommandStatus},
    exec::commands::{
        self, docker_containers_list, system_health, system_info, system_reboot, system_shutdown,
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

        _ => CommandResponse {
            id: request.id,
            status: CommandStatus::Error,
            data: None,
            error: Some(format!("Unknown command: {}", request.command)),
        },
    }
}
