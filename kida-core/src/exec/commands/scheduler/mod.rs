pub mod scheduler_add;
pub mod scheduler_delete;
pub mod scheduler_list;

use serde_json::Value;

use crate::infrastructure::comm::protocol::{CommandResponse, CommandStatus};

fn response(id: String, result: Result<Value, String>) -> CommandResponse {
    match result {
        Ok(data) => CommandResponse {
            id,
            status: CommandStatus::Ok,
            data: Some(data),
            error: None,
        },
        Err(error) => CommandResponse {
            id,
            status: CommandStatus::Error,
            data: None,
            error: Some(error),
        },
    }
}

#[cfg(test)]
pub(crate) mod tests;
