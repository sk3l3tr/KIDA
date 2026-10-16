use serde::Deserialize;

use crate::{
    features::scheduler::{manager::SchedulerManager, model::ScheduleOriginFilter},
    infrastructure::comm::protocol::{CommandRequest, CommandResponse},
};

#[derive(Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct ListParams {
    #[serde(default)]
    origin: ScheduleOriginFilter,
}

pub async fn exec(request: CommandRequest, manager: &SchedulerManager) -> CommandResponse {
    let manager = manager.clone();
    super::super::run_blocking(request, move |request| exec_blocking(request, &manager)).await
}

fn exec_blocking(request: CommandRequest, manager: &SchedulerManager) -> CommandResponse {
    let result = if request.params.is_null() {
        Ok(ListParams::default())
    } else if !request.params.is_object() {
        Err("invalid scheduler.list params: expected an object or null".to_string())
    } else {
        serde_json::from_value::<ListParams>(request.params)
            .map_err(|error| format!("invalid scheduler.list params: {error}"))
    }
    .and_then(|params| manager.list_by_origin(params.origin));
    super::response(request.id, result)
}
