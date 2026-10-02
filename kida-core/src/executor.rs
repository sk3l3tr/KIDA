use crate::comm::protocol::{CommandRequest, CommandResponse, CommandStatus};

pub async fn execute(request: CommandRequest) -> CommandResponse {
    match request.command.as_str() {
        "health" => health(request).await,

        _ => CommandResponse {
            id: request.id,
            status: CommandStatus::Error,
            data: None,
            error: Some(format!("Unknown command: {}", request.command)),
        },
    }
}

async fn health(request: CommandRequest) -> CommandResponse {
    CommandResponse {
        id: request.id,
        status: CommandStatus::Ok,
        data: None,
        error: None,
    }
}
