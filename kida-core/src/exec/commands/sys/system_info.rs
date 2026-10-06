use serde_json::to_value;

use crate::comm::protocol::{CommandRequest, CommandResponse, CommandStatus};
use crate::system::SystemInfoService;

pub async fn exec(request: CommandRequest) -> CommandResponse {
    let info = SystemInfoService::info();

    CommandResponse {
        id: request.id,
        status: CommandStatus::Ok,
        data: Some(to_value(info).unwrap()),
        error: None,
    }
}
