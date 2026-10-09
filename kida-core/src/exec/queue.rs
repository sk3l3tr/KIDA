use tokio::sync::mpsc::{self, error::TrySendError};
use uuid::Uuid;

use crate::comm::protocol::CommandRequest;

const QUEUE_CAPACITY: usize = 16;

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
        let (sender, receiver) = mpsc::channel(QUEUE_CAPACITY);

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

