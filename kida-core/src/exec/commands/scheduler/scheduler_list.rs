use crate::{
    comm::protocol::{CommandRequest, CommandResponse},
    scheduler::manager::SchedulerManager,
};

pub async fn exec(request: CommandRequest, manager: &SchedulerManager) -> CommandResponse {
    super::response(request.id, manager.list())
}
