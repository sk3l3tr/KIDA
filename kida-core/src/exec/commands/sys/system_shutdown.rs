use serde_json::json;

use crate::features::system::SystemPower;
use crate::infrastructure::comm::protocol::{CommandRequest, CommandResponse, CommandStatus};

pub async fn exec(request: CommandRequest) -> CommandResponse {
    super::super::run_blocking(request, exec_blocking).await
}

fn exec_blocking(request: CommandRequest) -> CommandResponse {
    let when = request
        .params
        .get("when")
        .and_then(|value| value.as_str())
        .unwrap_or("+1");

    match SystemPower::shutdown(when) {
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
