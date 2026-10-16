// Command identifiers are resolved here; the executor dispatches exhaustively on these types.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CommandKind {
    SystemInfo,
    SystemHealth,
    SystemShutdown,
    SystemReboot,
    SystemWakeCapabilities,
    SystemPowerCycle,
    DockerComposeVersion,
    DockerComposeProjectsList,
    DockerComposeProjectInspect,
    DockerContainersList,
    DockerContainerStop,
    DockerContainerStart,
    DockerContainerRestart,
    DockerContainerDelete,
    BackupConfigList,
    BackupConfigCreate,
    BackupConfigDelete,
    BackupRun,
    Scheduler(SchedulerCommand),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SchedulerCommand {
    Add,
    List,
    Delete,
}

pub(crate) fn resolve(command: &str) -> Option<CommandKind> {
    Some(match command {
        "system.info" => CommandKind::SystemInfo,
        "system.health" => CommandKind::SystemHealth,
        "system.shutdown" => CommandKind::SystemShutdown,
        "system.reboot" => CommandKind::SystemReboot,
        "system.wake_capabilities" => CommandKind::SystemWakeCapabilities,
        "system.power_cycle" => CommandKind::SystemPowerCycle,
        "docker.compose.version" => CommandKind::DockerComposeVersion,
        "docker.compose.projects.list" => CommandKind::DockerComposeProjectsList,
        "docker.compose.project.inspect" => CommandKind::DockerComposeProjectInspect,
        "docker.containers.list" => CommandKind::DockerContainersList,
        "docker.container.stop" => CommandKind::DockerContainerStop,
        "docker.container.start" => CommandKind::DockerContainerStart,
        "docker.container.restart" => CommandKind::DockerContainerRestart,
        "docker.container.delete" => CommandKind::DockerContainerDelete,
        "backup.config.list" => CommandKind::BackupConfigList,
        "backup.config.create" => CommandKind::BackupConfigCreate,
        "backup.config.delete" => CommandKind::BackupConfigDelete,
        "backup.run" => CommandKind::BackupRun,
        "scheduler.add" => CommandKind::Scheduler(SchedulerCommand::Add),
        "scheduler.list" => CommandKind::Scheduler(SchedulerCommand::List),
        "scheduler.delete" => CommandKind::Scheduler(SchedulerCommand::Delete),
        _ => return None,
    })
}
