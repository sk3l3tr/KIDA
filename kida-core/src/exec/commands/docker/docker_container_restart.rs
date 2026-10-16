use crate::{
    features::docker::DockerService,
    infrastructure::comm::protocol::{CommandRequest, CommandResponse},
};

pub async fn exec(request: CommandRequest) -> CommandResponse {
    super::container_action(request, DockerService::restart, "restarted").await
}
