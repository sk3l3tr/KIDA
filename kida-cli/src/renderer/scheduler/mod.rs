use crate::{protocol::command::CommandResponse, renderer::error::RenderError};

mod add;
mod delete;
mod helpers;
mod list;

pub fn add(response: &CommandResponse) -> Result<String, RenderError> {
    add::add(response)
}

pub fn delete(response: &CommandResponse) -> Result<String, RenderError> {
    delete::delete(response)
}

pub fn list(response: &CommandResponse) -> Result<String, RenderError> {
    list::list(response)
}
