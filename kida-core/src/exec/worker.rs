use std::{collections::HashMap, future::Future, sync::Arc};
use tokio::{
    sync::{Mutex, Semaphore, mpsc},
    task::{JoinError, JoinSet},
};

use crate::{
    conf,
    exec::{executor, queue::QueuedCommand},
    infrastructure::comm::protocol::{CommandRequest, CommandResponse, CommandStatus},
};

pub async fn run(receiver: mpsc::Receiver<QueuedCommand>) {
    run_with_handler(receiver, executor::execute_now).await;
}

pub async fn run_with_handler<F, Fut>(receiver: mpsc::Receiver<QueuedCommand>, handler: F)
where
    F: Fn(CommandRequest) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = CommandResponse> + Send + 'static,
{
    let queue = &conf::get().expect("configuration not initialized").queue;
    run_with_limits(
        receiver,
        handler,
        queue.max_concurrent_jobs,
        queue.capacity + queue.max_concurrent_jobs,
    )
    .await;
}

pub(super) async fn run_with_limits<F, Fut>(
    mut receiver: mpsc::Receiver<QueuedCommand>,
    handler: F,
    max_concurrent_jobs: usize,
    max_admitted_jobs: usize,
) where
    F: Fn(CommandRequest) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = CommandResponse> + Send + 'static,
{
    let handler = Arc::new(handler);
    let capacity = Arc::new(Semaphore::new(max_concurrent_jobs));
    let backup = Arc::new(Mutex::new(()));
    let mut tasks = JoinSet::new();
    let mut executions = HashMap::new();
    let mut closed = false;

    while !closed || !tasks.is_empty() {
        tokio::select! {
            task = receiver.recv(), if !closed && tasks.len() < max_admitted_jobs => {
                let Some(QueuedCommand { execution_id, request }) = task else {
                    closed = true;
                    continue;
                };
                let handler = handler.clone();
                let capacity = capacity.clone();
                let backup = backup.clone();
                let id = execution_id.clone();

                let task = tasks.spawn(async move {
                    // Waiting backups must not occupy execution capacity.
                    let _backup = if request.command == "backup.run" {
                        Some(backup.lock().await)
                    } else {
                        None
                    };
                    let _permit = capacity.acquire().await.expect("worker semaphore closed");
                    println!("[QUEUE] Starting execution {} ({})", id, request.command);
                    handler(request).await
                });
                executions.insert(task.id(), execution_id);
            }
            Some(result) = tasks.join_next_with_id(), if !tasks.is_empty() => {
                let task_id = match &result {
                    Ok((id, _)) => *id,
                    Err(error) => error.id(),
                };
                let execution_id = executions.remove(&task_id).expect("unknown execution task");
                report_result(&execution_id, result.map(|(_, response)| response));
            }
        }
    }

    println!("[QUEUE] Worker stopped: channel closed");
}

fn report_result(execution_id: &str, result: Result<CommandResponse, JoinError>) {
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
            eprintln!("[QUEUE] Execution panicked: {} - {}", execution_id, error);
        }
        Err(error) => {
            eprintln!(
                "[QUEUE] Execution task failed: {} - {}",
                execution_id, error
            );
        }
    }
}
