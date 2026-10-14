use serde_json::json;

use crate::features::system::SystemPower;
use crate::infrastructure::comm::protocol::{CommandRequest, CommandResponse, CommandStatus};

pub async fn exec(request: CommandRequest) -> CommandResponse {
    if !request
        .params
        .as_object()
        .is_some_and(|params| params.is_empty())
    {
        let error = "system.wake_capabilities params must be an empty object".to_string();
        eprintln!("[SYSTEM] Request {}: {error}", request.id);

        return CommandResponse {
            id: request.id,
            status: CommandStatus::Error,
            data: None,
            error: Some(error),
        };
    }

    CommandResponse {
        id: request.id,
        status: CommandStatus::Ok,
        data: Some(json!(SystemPower::wake_capabilities())),
        error: None,
    }
}
