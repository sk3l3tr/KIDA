use crate::protocol::CommandResponse;
use crate::renderer::{
    RenderError,
    json::{data, string},
};

pub fn run(response: &CommandResponse) -> Result<String, RenderError> {
    let data = data(response)?;
    let state = string(data, "state", "data.state")?;
    if state != "QUEUED" {
        return Err(RenderError::invalid("data.state", "the string `QUEUED`"));
    }

    let execution_id = string(data, "execution_id", "data.execution_id")?;
    Ok(format!("Backup queued (Execution ID: {execution_id})."))
}
