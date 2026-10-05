use crate::protocol::CommandResponse;

use super::{
    RenderError, array, boolean, data, nullable_number, nullable_string, nullable_u64, number,
    object, string, u64_value, value_object,
};

pub(super) fn health(_response: &CommandResponse) -> Result<String, RenderError> {
    Ok("KIDA is responding.".to_string())
}

pub(super) fn info(response: &CommandResponse) -> Result<String, RenderError> {
    let data = data(response)?;
    let hostname = unknown(nullable_string(data, "hostname", "data.hostname")?);
    let architecture = unknown(nullable_string(data, "architecture", "data.architecture")?);

    let os = object(data, "os", "data.os")?;
    let os_name = unknown(nullable_string(os, "name", "data.os.name")?);
    let os_version = unknown(nullable_string(os, "version", "data.os.version")?);
    let os_long = unknown(nullable_string(os, "long_version", "data.os.long_version")?);

    let kernel = object(data, "kernel", "data.kernel")?;
    let kernel_version = unknown(nullable_string(kernel, "version", "data.kernel.version")?);
    let kernel_long = unknown(nullable_string(
        kernel,
        "long_version",
        "data.kernel.long_version",
    )?);

    let hardware = object(data, "hardware", "data.hardware")?;
    let model = unknown(nullable_string(hardware, "model", "data.hardware.model")?);
    let vendor = unknown(nullable_string(hardware, "vendor", "data.hardware.vendor")?);

    let cpu = object(data, "cpu", "data.cpu")?;
    let cpu_brand = unknown(nullable_string(cpu, "brand", "data.cpu.brand")?);
    let cpu_vendor = unknown(nullable_string(cpu, "vendor", "data.cpu.vendor")?);
    let logical_cores = u64_value(cpu, "logical_cores", "data.cpu.logical_cores")?;
    let physical_cores = nullable_u64(cpu, "physical_cores", "data.cpu.physical_cores")?
        .map_or_else(|| "unknown".to_string(), |value| value.to_string());

    let memory = object(data, "memory", "data.memory")?;
    let total = u64_value(memory, "total_bytes", "data.memory.total_bytes")?;
    let available = u64_value(memory, "available_bytes", "data.memory.available_bytes")?;
    let used = u64_value(memory, "used_bytes", "data.memory.used_bytes")?;

    let graphics = array(data, "graphics", "data.graphics")?;
    let mut graphics_lines = Vec::with_capacity(graphics.len().max(1));
    if graphics.is_empty() {
        graphics_lines.push("  unknown".to_string());
    } else {
        for (index, value) in graphics.iter().enumerate() {
            let value = value.as_str().ok_or_else(|| {
                RenderError::invalid(&format!("data.graphics[{index}]"), "a string")
            })?;
            graphics_lines.push(format!("  {value}"));
        }
    }

    let disks = array(data, "disks", "data.disks")?;
    let mut disk_lines = Vec::with_capacity(disks.len().max(1));
    if disks.is_empty() {
        disk_lines.push("  No disks found.".to_string());
    } else {
        for (index, value) in disks.iter().enumerate() {
            let path = format!("data.disks[{index}]");
            let disk = value_object(value, &path)?;
            let name = string(disk, "name", &format!("{path}.name"))?;
            let mount = string(disk, "mount_point", &format!("{path}.mount_point"))?;
            let fs = string(disk, "file_system", &format!("{path}.file_system"))?;
            let total = u64_value(disk, "total_bytes", &format!("{path}.total_bytes"))?;
            let available = u64_value(disk, "available_bytes", &format!("{path}.available_bytes"))?;
            let removable = boolean(disk, "removable", &format!("{path}.removable"))?;
            disk_lines.push(format!(
                "  {name} at {mount} ({fs}) — {} total, {} available{}",
                format_bytes(total),
                format_bytes(available),
                if removable { ", removable" } else { "" }
            ));
        }
    }

    Ok(format!(
        "System\n  Hostname: {hostname}\n  OS: {os_long} (name: {os_name}, version: {os_version})\n  Kernel: {kernel_long} (version: {kernel_version})\n  Architecture: {architecture}\n\nHardware\n  Vendor: {vendor}\n  Model: {model}\n\nCPU\n  Brand: {cpu_brand}\n  Vendor: {cpu_vendor}\n  Cores: {physical_cores} physical, {logical_cores} logical\n\nMemory\n  Total: {}\n  Used: {}\n  Available: {}\n\nGraphics\n{}\n\nDisks\n{}",
        format_bytes(total),
        format_bytes(used),
        format_bytes(available),
        graphics_lines.join("\n"),
        disk_lines.join("\n")
    ))
}

pub(super) fn system_health(response: &CommandResponse) -> Result<String, RenderError> {
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

fn unknown(value: Option<&str>) -> &str {
    value.unwrap_or("unknown")
}

fn format_number(value: f64) -> String {
    if value.fract() == 0.0 {
        format!("{value:.0}")
    } else {
        format!("{value:.1}")
    }
}

fn format_bytes(bytes: u64) -> String {
    const UNITS: [&str; 6] = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }

    if unit == 0 {
        format!("{bytes} B")
    } else {
        format!("{value:.2} {}", UNITS[unit])
    }
}

fn table(headers: &[&str], rows: &[Vec<String>]) -> String {
    let widths: Vec<_> = headers
        .iter()
        .enumerate()
        .map(|(column, header)| {
            rows.iter()
                .map(|row| row[column].chars().count())
                .max()
                .unwrap_or(0)
                .max(header.len())
        })
        .collect();

    let format_row = |row: &[String]| {
        row.iter()
            .enumerate()
            .map(|(column, value)| format!("{value:<width$}", width = widths[column]))
            .collect::<Vec<_>>()
            .join("  ")
            .trim_end()
            .to_string()
    };

    let header = headers
        .iter()
        .map(|value| (*value).to_string())
        .collect::<Vec<_>>();
    let mut output = vec![format_row(&header)];
    output.extend(rows.iter().map(|row| format_row(row)));
    output.join("\n")
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::*;
    use crate::protocol::CommandStatus;

    fn response(data: Option<Value>) -> CommandResponse {
        CommandResponse {
            id: "1".into(),
            status: CommandStatus::Ok,
            data,
            error: None,
        }
    }

    #[test]
    fn renders_health_without_data() {
        assert_eq!(health(&response(None)).unwrap(), "KIDA is responding.");
    }

    #[test]
    fn renders_system_info_with_nullable_values_and_collections() {
        let data = json!({
            "hostname": null,
            "os": {"name": "Linux", "version": null, "long_version": "KIDA Linux 1"},
            "kernel": {"version": "6.12", "long_version": null},
            "architecture": "x86_64",
            "hardware": {"model": null, "vendor": "KIDA"},
            "cpu": {"brand": "Fast CPU", "vendor": null, "logical_cores": 8, "physical_cores": null},
            "memory": {"total_bytes": 1073741824_u64, "available_bytes": 536870912_u64, "used_bytes": 536870912_u64},
            "graphics": ["GPU One", "GPU Two"],
            "disks": [
                {"name": "sda", "mount_point": "/", "file_system": "ext4", "total_bytes": 1099511627776_u64, "available_bytes": 512_u64, "removable": false},
                {"name": "usb", "mount_point": "/media/usb", "file_system": "vfat", "total_bytes": 1024_u64, "available_bytes": 0, "removable": true}
            ]
        });

        let output = info(&response(Some(data.clone()))).unwrap();

        assert!(output.contains("Hostname: unknown"));
        assert!(output.contains("Total: 1.00 GiB"));
        assert!(output.contains("sda at / (ext4) — 1.00 TiB total, 512 B available"));
        assert!(
            output.contains("usb at /media/usb (vfat) — 1.00 KiB total, 0 B available, removable")
        );
        assert!(output.contains("GPU One\n  GPU Two"));

        let mut empty_collections = data;
        empty_collections["graphics"] = json!([]);
        empty_collections["disks"] = json!([]);
        let output = info(&response(Some(empty_collections))).unwrap();
        assert!(output.contains("Graphics\n  unknown"));
        assert!(output.contains("Disks\n  No disks found."));
    }

    #[test]
    fn formats_bytes_in_iec_units() {
        assert_eq!(format_bytes(0), "0 B");
        assert_eq!(format_bytes(1024), "1.00 KiB");
        assert_eq!(format_bytes(1_048_576), "1.00 MiB");
        assert_eq!(format_bytes(1_073_741_824), "1.00 GiB");
    }

    #[test]
    fn renders_multiple_sensor_types_and_limits() {
        let data = json!({
            "overall": "WARNING",
            "sensors": [
                {"type": "temperature", "device": "coretemp", "label": "Package", "value": 61.5, "unit": "C", "max": 80.0, "critical": 100.0, "alarm": false, "status": "OK"},
                {"type": "fan", "device": "nct", "label": "fan1", "value": 900, "unit": "RPM", "alarm": true, "fault": false, "status": "CRITICAL"}
            ]
        });

        let output = system_health(&response(Some(data))).unwrap();

        assert!(output.contains("Overall health: WARNING"));
        assert!(output.contains("coretemp  Package  61.5 C"));
        assert!(output.contains("max 80 C, critical 100 C"));
        assert!(output.contains("nct       fan1     900 RPM  CRITICAL  alarm"));
    }

    #[test]
    fn clearly_reports_an_empty_sensor_collection() {
        let output =
            system_health(&response(Some(json!({"overall": "OK", "sensors": []})))).unwrap();
        assert_eq!(output, "Overall health: OK\nNo hardware sensors found.");
    }

    #[test]
    fn renders_shutdown_and_reboot_using_the_real_time() {
        let response = response(Some(json!({"scheduled": true, "when": "+15"})));
        assert_eq!(shutdown(&response).unwrap(), "Shutdown scheduled for +15.");
        assert_eq!(reboot(&response).unwrap(), "Reboot scheduled for +15.");
    }

    #[test]
    fn rejects_missing_data_wrong_types_and_invalid_confirmation() {
        assert!(info(&response(None)).is_err());
        assert!(system_health(&response(Some(json!({"overall": 1, "sensors": []})))).is_err());
        assert!(shutdown(&response(Some(json!({"scheduled": false, "when": "now"})))).is_err());
        assert!(reboot(&response(Some(json!({"scheduled": true})))).is_err());
    }
}
