use serde_json::json;

use crate::comm::protocol::{CommandRequest, CommandResponse, CommandStatus};
use crate::system::SystemCollectorService;

pub async fn exec(request: CommandRequest) -> CommandResponse {
    match SystemCollectorService::collect_hwmon() {
        Ok(sensors) => CommandResponse {
            id: request.id,
            status: CommandStatus::Ok,
            data: Some(json!({
                "overall": SystemCollectorService::calculate_overall_status(&sensors),
                "sensors": sensors,
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
