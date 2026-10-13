use crate::{
    features::scheduler::manager::SchedulerManager,
    infrastructure::comm::protocol::{CommandRequest, CommandResponse},
};

pub async fn exec(request: CommandRequest, manager: &SchedulerManager) -> CommandResponse {
    super::response(request.id, manager.list())
}
