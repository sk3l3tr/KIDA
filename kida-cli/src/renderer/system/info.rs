use crate::protocol::CommandResponse;
use crate::renderer::{
    RenderError,
    format::{format_bytes, unknown},
    json::{
        array, boolean, data, nullable_string, nullable_u64, object, string, u64_value,
        value_object,
    },
};

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
