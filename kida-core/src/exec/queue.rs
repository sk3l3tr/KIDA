use tokio::sync::mpsc::{self, error::TrySendError};
use uuid::Uuid;

use crate::comm::protocol::CommandRequest;
use crate::conf;

pub struct QueuedCommand {
    pub execution_id: String,
    pub request: CommandRequest,
}

#[derive(Clone)]
pub struct CommandQueue {
    sender: mpsc::Sender<QueuedCommand>,
}

#[derive(Debug)]
pub enum QueueError {
    Full,
    Closed,
}

impl CommandQueue {
    pub fn new() -> (Self, mpsc::Receiver<QueuedCommand>) {
        let global_conf = conf::get().expect("configuration not initialized");
        let capacity = global_conf.queue.capacity;

        let (sender, receiver) = mpsc::channel(capacity);

        (Self { sender }, receiver)
    }

    pub fn enqueue(&self, request: CommandRequest) -> Result<String, QueueError> {
        let execution_id = Uuid::new_v4().to_string();

        let task = QueuedCommand {
            execution_id: execution_id.clone(),
            request,
        };

        self.sender.try_send(task).map_err(|error| match error {
            TrySendError::Full(_) => QueueError::Full,
            TrySendError::Closed(_) => QueueError::Closed,
        })?;

        Ok(execution_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn shared_queue_preserves_capacity_fifo_and_arbitrary_commands() {
        let capacity = conf::tests::init_test_config().queue.capacity;
        let (queue, mut receiver) = CommandQueue::new();
        let shared = queue.clone();
        let commands = ["health", "backup.run", "scheduler.list"];
        let mut execution_ids = Vec::new();

        for index in 0..capacity {
            let sender = if index % 2 == 0 { &queue } else { &shared };
            let execution_id = sender
                .enqueue(CommandRequest {
                    id: index.to_string(),
                    command: commands[index % commands.len()].to_string(),
                    params: json!({"position": index, "resource": null}),
                })
                .unwrap();

            execution_ids.push(execution_id);
        }

        assert!(matches!(
            shared.enqueue(CommandRequest {
                id: "discarded".to_string(),
                command: "health".to_string(),
                params: json!(null),
            }),
            Err(QueueError::Full)
        ));

        for (index, execution_id) in execution_ids.iter().enumerate() {
            let queued = receiver.try_recv().unwrap();

            assert_eq!(&queued.execution_id, execution_id);
            assert_eq!(queued.request.id, index.to_string());
            assert_eq!(queued.request.command, commands[index % commands.len()]);
            assert_eq!(
                queued.request.params,
                json!({"position": index, "resource": null})
            );
        }

        assert!(receiver.try_recv().is_err());

        drop(receiver);

        assert!(matches!(
            queue.enqueue(CommandRequest {
                id: "closed".to_string(),
                command: "health".to_string(),
                params: json!(null),
            }),
            Err(QueueError::Closed)
        ));
    }
}
