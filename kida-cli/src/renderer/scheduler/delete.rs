use crate::{
    protocol::command::CommandResponse,
    renderer::{error::RenderError, scheduler::helpers::confirmation},
};

pub fn delete(response: &CommandResponse) -> Result<String, RenderError> {
    confirmation(response, "deleted")
}
