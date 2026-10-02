use std::fs;
use std::process::Command;

use serde_json::json;
use sysinfo::{Disks, System};

use crate::comm::protocol::{CommandRequest, CommandResponse, CommandStatus};

pub async fn exec(request: CommandRequest) -> CommandResponse {
    let mut system = System::new_all();
    system.refresh_all();

    let disks = Disks::new_with_refreshed_list();

    let disks = disks
        .list()
        .iter()
        .map(|disk| {
            json!({
                "name": disk.name().to_string_lossy(),
                "mount_point": disk.mount_point().to_string_lossy(),
                "file_system": disk.file_system().to_string_lossy(),
                "total_bytes": disk.total_space(),
                "available_bytes": disk.available_space(),
                "removable": disk.is_removable(),
            })
        })
        .collect::<Vec<_>>();

    let cpu = system.cpus().first();

    let data = json!({
        "hostname": System::host_name(),

        "os": {
            "name": System::name(),
            "version": System::os_version(),
            "long_version": System::long_os_version(),
        },

        "kernel": {
            "version": System::kernel_version(),
            "long_version": System::kernel_long_version(),
        },

        "architecture": System::cpu_arch(),

        "hardware": {
            "model": read_trimmed("/sys/devices/virtual/dmi/id/product_name"),
            "vendor": read_trimmed("/sys/devices/virtual/dmi/id/sys_vendor"),
        },

        "cpu": {
            "brand": cpu.map(|cpu| cpu.brand()),
            "vendor": cpu.map(|cpu| cpu.vendor_id()),
            "logical_cores": system.cpus().len(),
            "physical_cores": System::physical_core_count(),
        },

        "memory": {
            "total_bytes": system.total_memory(),
            "available_bytes": system.available_memory(),
            "used_bytes": system.used_memory(),
        },

        "graphics": get_graphics(),

        "disks": disks,
    });

    CommandResponse {
        id: request.id,
        status: CommandStatus::Ok,
        data: Some(data),
        error: None,
    }
}

fn read_trimmed(path: &str) -> Option<String> {
    fs::read_to_string(path)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn get_graphics() -> Vec<String> {
    let output = Command::new("lspci").arg("-mm").output().ok();

    let Some(output) = output else {
        return Vec::new();
    };

    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter(|line| {
            line.contains("VGA compatible controller")
                || line.contains("3D controller")
                || line.contains("Display controller")
        })
        .map(str::to_string)
        .collect()
}
