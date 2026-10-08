use crate::protocol::CommandResponse;
use crate::renderer::error::RenderError;

pub fn health(_response: &CommandResponse) -> Result<String, RenderError> {
    Ok("KIDA is responding.".to_string())
}
