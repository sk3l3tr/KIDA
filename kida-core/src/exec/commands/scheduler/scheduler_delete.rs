use serde::Deserialize;

use crate::{
    comm::protocol::{CommandRequest, CommandResponse},
    scheduler::manager::SchedulerManager,
};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DeleteParams {
    id: String,
}

pub async fn exec(request: CommandRequest, manager: &SchedulerManager) -> CommandResponse {
    let result = serde_json::from_value::<DeleteParams>(request.params)
        .map_err(|error| format!("invalid scheduler.delete params: {error}"))
        .and_then(|input| manager.delete(&input.id));

    super::response(request.id, result)
}
