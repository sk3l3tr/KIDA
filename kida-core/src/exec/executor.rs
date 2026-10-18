use serde_json::json;
use std::sync::OnceLock;
use tokio::sync::mpsc;

use crate::{
    exec::{
        catalog::{self, CommandKind, SchedulerCommand},
        commands::{
            self,
            backup::config::{backup_create, backup_delete, backup_list},
            docker::{
                docker_compose_project_inspect, docker_compose_projects_list,
                docker_compose_version, docker_container_delete, docker_container_restart,
                docker_container_start, docker_container_stop, docker_containers_list,
            },
            sys::{
                system_health, system_info, system_power_cycle, system_reboot, system_shutdown,
                system_wake_capabilities,
            },
        },
        queue::{CommandQueue, QueueError, QueuedCommand},
    },
    infrastructure::comm::protocol::{CommandRequest, CommandResponse, CommandStatus},
};

static QUEUE: OnceLock<CommandQueue> = OnceLock::new();

pub fn init_queue() -> Result<mpsc::Receiver<QueuedCommand>, &'static str> {
    let (queue, receiver) = CommandQueue::new();

    QUEUE
        .set(queue)
        .map_err(|_| "Command queue already initialized")?;

    Ok(receiver)
}

pub fn command_queue() -> Result<CommandQueue, &'static str> {
    QUEUE.get().cloned().ok_or("Command queue not initialized")
}

pub fn is_registered(command: &str) -> bool {
    catalog::resolve(command).is_some()
}

pub(crate) fn is_schedulable(command: &str, internal: bool) -> bool {
    is_registered(command) || (internal && is_health_maintenance(command))
}

fn is_health_maintenance(command: &str) -> bool {
    matches!(command, "backup.health.expire" | "backup.health.retain")
}

pub async fn execute(request: CommandRequest) -> CommandResponse {
    match request.command.as_str() {
        "backup.run" => enqueue(request),
        _ => execute_now(request).await,
    }
}

pub async fn execute_now(request: CommandRequest) -> CommandResponse {
    let Some(command) = catalog::resolve(&request.command) else {
        return CommandResponse {
            id: request.id,
            status: CommandStatus::Error,
            data: None,
            error: Some(format!("Unknown command: {}", request.command)),
        };
    };

    match command {
        CommandKind::SystemInfo => system_info::exec(request).await,
        CommandKind::SystemHealth => system_health::exec(request).await,
        CommandKind::SystemShutdown => system_shutdown::exec(request).await,
        CommandKind::SystemReboot => system_reboot::exec(request).await,
        CommandKind::SystemWakeCapabilities => system_wake_capabilities::exec(request).await,
        CommandKind::SystemPowerCycle => system_power_cycle::exec(request).await,

        CommandKind::DockerComposeVersion => docker_compose_version::exec(request).await,
        CommandKind::DockerComposeProjectsList => docker_compose_projects_list::exec(request).await,
        CommandKind::DockerComposeProjectInspect => {
            docker_compose_project_inspect::exec(request).await
        }

        CommandKind::DockerContainersList => docker_containers_list::exec(request).await,
        CommandKind::DockerContainerStop => docker_container_stop::exec(request).await,
        CommandKind::DockerContainerStart => docker_container_start::exec(request).await,
        CommandKind::DockerContainerRestart => docker_container_restart::exec(request).await,
        CommandKind::DockerContainerDelete => docker_container_delete::exec(request).await,

        CommandKind::BackupConfigList => backup_list::exec(request).await,
        CommandKind::BackupConfigCreate => backup_create::exec(request).await,
        CommandKind::BackupConfigDelete => backup_delete::exec(request).await,
        CommandKind::BackupRun => commands::backup::backup_run::exec(request).await,

        CommandKind::Scheduler(command) => {
            let manager = match crate::features::scheduler::runtime::manager() {
                Ok(manager) => manager,
                Err(error) => {
                    return CommandResponse {
                        id: request.id,
                        status: CommandStatus::Error,
                        data: None,
                        error: Some(error),
                    };
                }
            };

            match command {
                SchedulerCommand::Add => {
                    commands::scheduler::scheduler_add::exec(request, manager).await
                }
                SchedulerCommand::List => {
                    commands::scheduler::scheduler_list::exec(request, manager).await
                }
                SchedulerCommand::Delete => {
                    commands::scheduler::scheduler_delete::exec(request, manager).await
                }
            }
        }
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
