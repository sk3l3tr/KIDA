use crate::protocol::CommandResponse;
use crate::renderer::{
    RenderError,
    format::{format_number, table},
    json::{array, boolean, data, nullable_number, number, string, value_object},
};

pub(super) fn health(response: &CommandResponse) -> Result<String, RenderError> {
    let data = data(response)?;
    let overall = string(data, "overall", "data.overall")?;
    let sensors = array(data, "sensors", "data.sensors")?;

    if sensors.is_empty() {
        return Ok(format!(
            "Overall health: {overall}\nNo hardware sensors found."
        ));
    }

    let mut rows = Vec::with_capacity(sensors.len());
    for (index, value) in sensors.iter().enumerate() {
        let path = format!("data.sensors[{index}]");
        let sensor = value_object(value, &path)?;
        let kind = string(sensor, "type", &format!("{path}.type"))?;
        let device = string(sensor, "device", &format!("{path}.device"))?;
        let label = string(sensor, "label", &format!("{path}.label"))?;
        let value = number(sensor, "value", &format!("{path}.value"))?;
        let unit = string(sensor, "unit", &format!("{path}.unit"))?;
        let status = string(sensor, "status", &format!("{path}.status"))?;
        let alarm = boolean(sensor, "alarm", &format!("{path}.alarm"))?;

        let limits = match kind {
            "temperature" => {
                let max = nullable_number(sensor, "max", &format!("{path}.max"))?;
                let critical = nullable_number(sensor, "critical", &format!("{path}.critical"))?;
                let mut limits = Vec::new();
                if let Some(max) = max {
                    limits.push(format!("max {} {unit}", format_number(max)));
                }
                if let Some(critical) = critical {
                    limits.push(format!("critical {} {unit}", format_number(critical)));
                }
                if alarm {
                    limits.push("alarm".to_string());
                }
                if limits.is_empty() {
                    "—".to_string()
                } else {
                    limits.join(", ")
                }
            }
            "fan" => {
                let fault = boolean(sensor, "fault", &format!("{path}.fault"))?;
                match (alarm, fault) {
                    (false, false) => "—".to_string(),
                    (true, false) => "alarm".to_string(),
                    (false, true) => "fault".to_string(),
                    (true, true) => "alarm, fault".to_string(),
                }
            }
            _ => {
                return Err(RenderError::invalid(
                    &format!("{path}.type"),
                    "`temperature` or `fan`",
                ));
            }
        };

        rows.push(vec![
            device.to_string(),
            label.to_string(),
            format!("{} {unit}", format_number(value)),
            status.to_string(),
            limits,
        ]);
    }

    Ok(format!(
        "Overall health: {overall}\n{}",
        table(&["DEVICE", "SENSOR", "VALUE", "STATUS", "LIMITS"], &rows)
    ))
}
