use serde_json::json;
use std::sync::OnceLock;
use tokio::sync::mpsc;

use crate::{
    comm::protocol::{CommandRequest, CommandResponse, CommandStatus},
    exec::{
        queue::{CommandQueue, QueuedCommand, QueueError},
        commands::{
            self,
            backup::config::{backup_create, backup_delete, backup_list},
            docker::{
                docker_container_delete, docker_container_restart,
                docker_container_start, docker_container_stop,
                docker_containers_list,
            },
            sys::{system_health, system_info, system_reboot, system_shutdown},
        },
    },
};

static QUEUE: OnceLock<CommandQueue> = OnceLock::new();

pub fn init_queue() -> Result<mpsc::Receiver<QueuedCommand>, &'static str> {
    let (queue, receiver) = CommandQueue::new();

    QUEUE
        .set(queue)
        .map_err(|_| "Command queue already initialized")?;

    Ok(receiver)
}

pub async fn execute(request: CommandRequest) -> CommandResponse {
    match request.command.as_str() {
        "health" => commands::health(request).await,

        "system.info" => system_info::exec(request).await,
        "system.health" => system_health::exec(request).await,
        "system.shutdown" => system_shutdown::exec(request).await,
        "system.reboot" => system_reboot::exec(request).await,

        "docker.containers.list" => docker_containers_list::exec(request).await,
        "docker.container.stop" => docker_container_stop::exec(request).await,
        "docker.container.start" => docker_container_start::exec(request).await,
        "docker.container.restart" => docker_container_restart::exec(request).await,
        "docker.container.delete" => docker_container_delete::exec(request).await,

        "backup.config.list" => backup_list::exec(request).await,
        "backup.config.create" => backup_create::exec(request).await,
        "backup.config.delete" => backup_delete::exec(request).await,

        // Comandos encolados
        "backup.run" => enqueue(request),

        _ => CommandResponse {
            id: request.id,
            status: CommandStatus::Error,
            data: None,
            error: Some(format!("Unknown command: {}", request.command)),
        },
    }
}

fn enqueue(request: CommandRequest) -> CommandResponse {
    let id = request.id.clone();

    let Some(queue) = QUEUE.get() else {
        return CommandResponse {
            id,
            status: CommandStatus::Error,
            data: None,
            error: Some("Command queue not initialized".to_string()),
        };
    };

    match queue.enqueue(request) {
        Ok(execution_id) => CommandResponse {
            id,
            status: CommandStatus::Ok,
            data: Some(json!({
                "state": "QUEUED",
                "execution_id": execution_id,
            })),
            error: None,
        },

        Err(error) => {
            let message = match error {
                QueueError::Full => "Execution queue is full",
                QueueError::Closed => "Execution queue is closed",
            };

            CommandResponse {
                id,
                status: CommandStatus::Error,
                data: None,
                error: Some(message.to_string()),
            }
        }
    }
}

// Se mantiene SIN CAMBIOS
pub async fn execute_lifecycle(request: CommandRequest) -> CommandResponse {
    match request.command.as_str() {
        "docker.container.stop" => docker_container_stop::exec(request).await,
        "docker.container.start" => docker_container_start::exec(request).await,
        "docker.container.restart" => docker_container_restart::exec(request).await,

        _ => CommandResponse {
            id: request.id,
            status: CommandStatus::Error,
            data: None,
            error: Some(format!(
                "Command not allowed in backup lifecycle: {}",
                request.command
            )),
        },
    }
}
