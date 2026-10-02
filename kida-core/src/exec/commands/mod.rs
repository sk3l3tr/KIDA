pub mod docker_containers_list;
pub mod system_health;
pub mod system_info;
pub mod system_reboot;
pub mod system_shutdown;

use crate::comm::protocol::{CommandRequest, CommandResponse, CommandStatus};

pub async fn health(request: CommandRequest) -> CommandResponse {
    CommandResponse {
        id: request.id,
        status: CommandStatus::Ok,
        data: None,
        error: None,
    }
}
