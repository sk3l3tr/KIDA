use serde_json::json;

use crate::comm::protocol::{CommandRequest, CommandResponse, CommandStatus};

use crate::system::ShutdownService;

pub async fn exec(request: CommandRequest) -> CommandResponse {
    let when = request
        .params
        .get("when")
        .and_then(|value| value.as_str())
        .unwrap_or("+1");

    match ShutdownService::shutdown(when) {
        Ok(result) => CommandResponse {
            id: request.id,
            status: CommandStatus::Ok,
            data: Some(json!({
                "scheduled": result.scheduled,
                "when": result.when,
            })),
            error: None,
        },

        Err(error) => CommandResponse {
            id: request.id,
            status: CommandStatus::Error,
            data: None,
            error: Some(error),
        },
    }
}
