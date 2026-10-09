use std::future::Future;
use tokio::sync::mpsc;

use crate::{
    comm::protocol::{CommandRequest, CommandResponse, CommandStatus},
    exec::{
        commands::backup::backup_run,
        queue::QueuedCommand,
    },
};

pub async fn run(receiver: mpsc::Receiver<QueuedCommand>) {
    run_with_handler(receiver, backup_run::exec).await;
}

async fn run_with_handler<F, Fut>(
    mut receiver: mpsc::Receiver<QueuedCommand>,
    handler: F,
)
where
    F: Fn(CommandRequest) -> Fut,
    Fut: Future<Output = CommandResponse> + Send + 'static,
{
    while let Some(task) = receiver.recv().await {
        let QueuedCommand {
            execution_id,
            request,
        } = task;

        println!(
            "[QUEUE] Starting execution {} ({})",
            execution_id, request.command
        );

        let result = match request.command.as_str() {
            "backup.run" => tokio::spawn(handler(request)).await,

            command => {
                eprintln!(
                    "[QUEUE] Unsupported command: {} ({})",
                    command, execution_id
                );
                continue;
            }
        };

        match result {
            Ok(response) => match response.status {
                CommandStatus::Ok => {
                    println!("[QUEUE] Execution completed: {}", execution_id);
                }

                CommandStatus::Error => {
                    eprintln!(
                        "[QUEUE] Execution failed: {} - {}",
                        execution_id,
                        response.error.as_deref().unwrap_or("Unknown error")
                    );
                }
            },

            Err(error) if error.is_panic() => {
                eprintln!(
                    "[QUEUE] Execution panicked: {} - {}",
                    execution_id, error
                );
            }

            Err(error) => {
                eprintln!(
                    "[QUEUE] Execution task failed: {} - {}",
                    execution_id, error
                );
            }
        }
    }

    println!("[QUEUE] Worker stopped: channel closed");
}

