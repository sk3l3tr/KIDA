use crate::{
    features::scheduler::{manager::SchedulerManager, model::NewSchedule},
    infrastructure::comm::protocol::{CommandRequest, CommandResponse},
};

pub async fn exec(request: CommandRequest, manager: &SchedulerManager) -> CommandResponse {
    let result = serde_json::from_value::<NewSchedule>(request.params)
        .map_err(|error| format!("invalid scheduler.add params: {error}"))
        .and_then(|input| manager.add(input));

    super::response(request.id, result)
}
