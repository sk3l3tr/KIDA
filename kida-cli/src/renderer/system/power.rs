use crate::{
    protocol::command::CommandResponse,
    renderer::{
        error::RenderError,
        json::{array, boolean, data, field, nullable_string, string},
    },
};

fn s5_status(data: &serde_json::Map<String, serde_json::Value>) -> Result<(), RenderError> {
    if string(data, "s5_wake_status", "data.s5_wake_status")? != "unverified" {
        return Err(RenderError::invalid("data.s5_wake_status", "unverified"));
    }
    Ok(())
}

pub(in crate::renderer) fn power_cycle(response: &CommandResponse) -> Result<String, RenderError> {
    let data = data(response)?;
    if !boolean(data, "shutdown_scheduled", "data.shutdown_scheduled")? {
        return Err(RenderError::invalid("data.shutdown_scheduled", "true"));
    }
    let wake_at = string(data, "wake_at", "data.wake_at")?;
    s5_status(data)?;
    let shutdown = if data.contains_key("shutdown_at") {
        format!(
            "Shutdown scheduled for {}.",
            string(data, "shutdown_at", "data.shutdown_at")?
        )
    } else {
        "Shutdown scheduled in one minute.".to_string()
    };
    Ok(format!(
        "{shutdown}\nRTC wake scheduled for {wake_at}.\nWarning: Wake from S5 is unverified; physical power-on is not guaranteed."
    ))
}

pub(in crate::renderer) fn wake_capabilities(
    response: &CommandResponse,
) -> Result<String, RenderError> {
    let data = data(response)?;
    let device = nullable_string(data, "rtc_device", "data.rtc_device")?.unwrap_or("Unknown");
    let availability = |key: &str| -> Result<&str, RenderError> {
        match field(data, key, &format!("data.{key}"))? {
            serde_json::Value::Null => Ok("Unknown"),
            serde_json::Value::Bool(true) => Ok("Yes"),
            serde_json::Value::Bool(false) => Ok("No"),
            _ => Err(RenderError::invalid(
                &format!("data.{key}"),
                "a boolean or null",
            )),
        }
    };
    let rtcwake = availability("rtcwake_available")?;
    let alarm = availability("rtc_alarm_available")?;
    s5_status(data)?;
    let mut output = format!(
        "RTC device: {device}\nrtcwake available: {rtcwake}\nRTC alarm available: {alarm}\nWake from S5: Unverified"
    );
    for (index, warning) in array(data, "warnings", "data.warnings")?.iter().enumerate() {
        let warning = warning
            .as_str()
            .ok_or_else(|| RenderError::invalid(&format!("data.warnings[{index}]"), "a string"))?;
        output.push_str(&format!("\nWarning: {warning}"));
    }
    Ok(output)
}
