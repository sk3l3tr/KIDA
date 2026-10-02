use crate::{
    comm::protocol::{CommandRequest, CommandResponse, CommandStatus},
    exec::commands,
};

pub async fn execute(request: CommandRequest) -> CommandResponse {
    match request.command.as_str() {
        "health" => commands::health(request).await,

        _ => CommandResponse {
            id: request.id,
            status: CommandStatus::Error,
            data: None,
            error: Some(format!("Unknown command: {}", request.command)),
        },
    }
}
