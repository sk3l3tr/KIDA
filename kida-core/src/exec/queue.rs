use tokio::sync::mpsc::{self, error::TrySendError};
use uuid::Uuid;

use crate::conf;
use crate::infrastructure::comm::protocol::CommandRequest;

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
