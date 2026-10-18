use tokio::sync::mpsc::{self, error::TrySendError};
use uuid::Uuid;

use crate::conf;
use crate::infrastructure::comm::protocol::CommandRequest;

#[derive(Debug, Clone, Default)]
pub(crate) enum ExecutionContext {
    #[default]
    Public,
    InternalSchedule,
    HealthRun(String),
}

pub struct QueuedCommand {
    pub execution_id: String,
    pub request: CommandRequest,
    pub(crate) context: ExecutionContext,
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
        self.enqueue_with_context(request, ExecutionContext::Public)
    }

    pub(crate) fn enqueue_scheduled(
        &self,
        request: CommandRequest,
        internal: bool,
    ) -> Result<String, QueueError> {
        self.enqueue_with_context(
            request,
            if internal {
                ExecutionContext::InternalSchedule
            } else {
                ExecutionContext::Public
            },
        )
    }

    pub(crate) fn enqueue_health(
        &self,
        request: CommandRequest,
        run_id: &str,
    ) -> Result<String, QueueError> {
        self.enqueue_with_context(request, ExecutionContext::HealthRun(run_id.into()))
    }

    fn enqueue_with_context(
        &self,
        request: CommandRequest,
        context: ExecutionContext,
    ) -> Result<String, QueueError> {
        let execution_id = Uuid::new_v4().to_string();

        let task = QueuedCommand {
            execution_id: execution_id.clone(),
            request,
            context,
        };

        self.sender.try_send(task).map_err(|error| match error {
            TrySendError::Full(_) => QueueError::Full,
            TrySendError::Closed(_) => QueueError::Closed,
        })?;

        Ok(execution_id)
    }
}
