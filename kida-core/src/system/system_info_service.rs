use std::fs;
use std::process::Command;

use sysinfo::{Disks, System};

use super::model::*;

pub struct SystemInfoService;

impl SystemInfoService {
    pub fn info() -> SystemInfo {
        let mut system = System::new_all();
        system.refresh_all();

        let disks = Disks::new_with_refreshed_list()
            .list()
            .iter()
            .map(|disk| DiskInfo {
                name: disk.name().to_string_lossy().into_owned(),
                mount_point: disk.mount_point().to_string_lossy().into_owned(),
                file_system: disk.file_system().to_string_lossy().into_owned(),
                total_bytes: disk.total_space(),
                available_bytes: disk.available_space(),
                removable: disk.is_removable(),
            })
            .collect();

        let cpu = system.cpus().first();

        SystemInfo {
            hostname: System::host_name(),

            os: OsInfo {
                name: System::name(),
                version: System::os_version(),
                long_version: System::long_os_version(),
            },

            kernel: KernelInfo {
                version: System::kernel_version(),
                long_version: Some(System::kernel_long_version()),
            },

            architecture: System::cpu_arch(),

            hardware: HardwareInfo {
                model: read_trimmed("/sys/devices/virtual/dmi/id/product_name"),
                vendor: read_trimmed("/sys/devices/virtual/dmi/id/sys_vendor"),
            },

            cpu: CpuInfo {
                brand: cpu.map(|cpu| cpu.brand().to_string()),
                vendor: cpu.map(|cpu| cpu.vendor_id().to_string()),
                logical_cores: system.cpus().len(),
                physical_cores: System::physical_core_count(),
            },

            memory: MemoryInfo {
                total_bytes: system.total_memory(),
                available_bytes: system.available_memory(),
                used_bytes: system.used_memory(),
            },

            graphics: get_graphics(),

            disks,
        }
    }
}

fn read_trimmed(path: &str) -> Option<String> {
    fs::read_to_string(path)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn get_graphics() -> Vec<String> {
    let Some(output) = Command::new("lspci").arg("-mm").output().ok() else {
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
