use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct SystemInfo {
    pub hostname: Option<String>,
    pub os: OsInfo,
    pub kernel: KernelInfo,
    pub architecture: String,
    pub hardware: HardwareInfo,
    pub cpu: CpuInfo,
    pub memory: MemoryInfo,
    pub graphics: Vec<String>,
    pub disks: Vec<DiskInfo>,
}

#[derive(Debug, Serialize)]
pub struct OsInfo {
    pub name: Option<String>,
    pub version: Option<String>,
    pub long_version: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct KernelInfo {
    pub version: Option<String>,
    pub long_version: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct HardwareInfo {
    pub model: Option<String>,
    pub vendor: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CpuInfo {
    pub brand: Option<String>,
    pub vendor: Option<String>,
    pub logical_cores: usize,
    pub physical_cores: Option<usize>,
}

#[derive(Debug, Serialize)]
pub struct MemoryInfo {
    pub total_bytes: u64,
    pub available_bytes: u64,
    pub used_bytes: u64,
}

#[derive(Debug, Serialize)]
pub struct DiskInfo {
    pub name: String,
    pub mount_point: String,
    pub file_system: String,
    pub total_bytes: u64,
    pub available_bytes: u64,
    pub removable: bool,
}
