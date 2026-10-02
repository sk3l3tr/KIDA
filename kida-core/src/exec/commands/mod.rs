use crate::comm::protocol::{CommandRequest, CommandResponse, CommandStatus};

pub async fn health(request: CommandRequest) -> CommandResponse {
    CommandResponse {
        id: request.id,
        status: CommandStatus::Ok,
        data: None,
        error: None,
    }
}
