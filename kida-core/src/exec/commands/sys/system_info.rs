use serde_json::to_value;

use crate::features::system::SystemCollector;
use crate::infrastructure::comm::protocol::{CommandRequest, CommandResponse, CommandStatus};

pub async fn exec(request: CommandRequest) -> CommandResponse {
    super::super::run_blocking(request, exec_blocking).await
}

fn exec_blocking(request: CommandRequest) -> CommandResponse {
    let info = SystemCollector::info();

    CommandResponse {
        id: request.id,
        status: CommandStatus::Ok,
        data: Some(to_value(info).unwrap()),
        error: None,
    }
}
