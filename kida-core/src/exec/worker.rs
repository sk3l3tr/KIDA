use tokio::sync::mpsc;

use crate::{
    comm::protocol::CommandStatus,
    exec::{
        commands::backup::backup_run,
        queue::QueuedCommand,
    },
};

pub async fn run(mut receiver: mpsc::Receiver<QueuedCommand>) {
    while let Some(task) = receiver.recv().await {
        let QueuedCommand {
            execution_id,
            request,
        } = task;

        println!(
            "[QUEUE] Starting execution {} ({})",
            execution_id, request.command
        );

        let response = match request.command.as_str() {
            "backup.run" => backup_run::exec(request).await,

            command => {
                eprintln!(
                    "[QUEUE] Unsupported command: {} ({})",
                    command, execution_id
                );
                continue;
            }
        };

        match response.status {
            CommandStatus::Ok => {
                println!(
                    "[QUEUE] Execution completed: {}",
                    execution_id
                );
            }

            CommandStatus::Error => {
                eprintln!(
                    "[QUEUE] Execution failed: {} - {}",
                    execution_id,
                    response.error.as_deref().unwrap_or("Unknown error")
                );
            }
        }
    }

    println!("[QUEUE] Worker stopped: channel closed");
}
