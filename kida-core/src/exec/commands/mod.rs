pub mod backup;
pub mod docker;
pub mod scheduler;
pub mod sys;

use crate::infrastructure::comm::protocol::{CommandRequest, CommandResponse, CommandStatus};

pub async fn health(request: CommandRequest) -> CommandResponse {
    CommandResponse {
        id: request.id,
        status: CommandStatus::Ok,
        data: None,
        error: None,
    }
}
