use crate::protocol::CommandResponse;
use crate::renderer::error::RenderError;

mod health;

pub(super) fn health(response: &CommandResponse) -> Result<String, RenderError> {
    health::health(response)
}
