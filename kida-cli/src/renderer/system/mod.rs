mod health;
mod info;
mod power;

pub(super) use power::{power_cycle, wake_capabilities};

use crate::{
    protocol::command::CommandResponse,
    renderer::{
        error::RenderError,
        json::{boolean, data, string},
    },
};

pub(super) fn info(response: &CommandResponse) -> Result<String, RenderError> {
    info::info(response)
}

pub(super) fn health(response: &CommandResponse) -> Result<String, RenderError> {
    health::health(response)
}

pub(super) fn shutdown(response: &CommandResponse) -> Result<String, RenderError> {
    schedule(response, "Shutdown")
}

pub(super) fn reboot(response: &CommandResponse) -> Result<String, RenderError> {
    schedule(response, "Reboot")
}

fn schedule(response: &CommandResponse, action: &str) -> Result<String, RenderError> {
    let data = data(response)?;
    if !boolean(data, "scheduled", "data.scheduled")? {
        return Err(RenderError::invalid("data.scheduled", "true"));
    }
    let when = string(data, "when", "data.when")?;
    Ok(format!("{action} scheduled for {when}."))
}

#[cfg(test)]
pub(crate) mod tests;
