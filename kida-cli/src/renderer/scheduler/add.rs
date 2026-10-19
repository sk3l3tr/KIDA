use crate::{
    protocol::command::CommandResponse,
    renderer::{error::RenderError, scheduler::helpers::confirmation},
};

pub fn add(response: &CommandResponse) -> Result<String, RenderError> {
    confirmation(response, "added")
}
