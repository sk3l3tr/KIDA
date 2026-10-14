use serde_json::json;

use crate::features::system::SystemPower;
use crate::infrastructure::comm::protocol::{CommandRequest, CommandResponse, CommandStatus};

pub async fn exec(request: CommandRequest) -> CommandResponse {
    match SystemPower::power_cycle(request.params) {
        Ok(result) => CommandResponse {
            id: request.id,
            status: CommandStatus::Ok,
            data: Some(json!(result)),
            error: None,
        },

        Err(error) => {
            eprintln!("[SYSTEM] Request {}: {error}", request.id);

            CommandResponse {
                id: request.id,
                status: CommandStatus::Error,
                data: None,
                error: Some(error),
            }
        }
    }
}
