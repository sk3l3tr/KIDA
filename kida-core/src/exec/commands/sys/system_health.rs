use serde_json::json;

use crate::comm::protocol::{CommandRequest, CommandResponse, CommandStatus};
use crate::system::SystemCollector;

pub async fn exec(request: CommandRequest) -> CommandResponse {
    match SystemCollector::collect_hwmon() {
        Ok(sensors) => CommandResponse {
            id: request.id,
            status: CommandStatus::Ok,
            data: Some(json!({
                "overall": SystemCollector::calculate_overall_status(&sensors),
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
