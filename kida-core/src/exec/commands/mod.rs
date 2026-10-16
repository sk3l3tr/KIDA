pub mod backup;
pub mod docker;
pub mod scheduler;
pub mod sys;

use crate::infrastructure::comm::protocol::{CommandRequest, CommandResponse, CommandStatus};

async fn run_blocking(
    request: CommandRequest,
    handler: impl FnOnce(CommandRequest) -> CommandResponse + Send + 'static,
) -> CommandResponse {
    let id = request.id.clone();
    let command = request.command.clone();
    match tokio::task::spawn_blocking(move || handler(request)).await {
        Ok(response) => response,
        Err(error) => CommandResponse {
            id,
            status: CommandStatus::Error,
            data: None,
            error: Some(format!("Command task failed for {command}: {error}")),
        },
    }
}

#[cfg(test)]
mod tests;
