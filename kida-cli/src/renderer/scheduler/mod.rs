use crate::{protocol::command::CommandResponse, renderer::error::RenderError};

mod scheduler;

pub fn add(response: &CommandResponse) -> Result<String, RenderError> {
    scheduler::add(response)
}

pub fn delete(response: &CommandResponse) -> Result<String, RenderError> {
    scheduler::delete(response)
}

pub fn list(response: &CommandResponse) -> Result<String, RenderError> {
    scheduler::list(response)
}
