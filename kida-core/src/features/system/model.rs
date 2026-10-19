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

#[derive(Debug, PartialEq, Eq)]
pub struct PowerCycleRequest {
    pub wake: WakeRequest,
    pub shutdown_time: Option<chrono::NaiveTime>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum WakeRequest {
    WakeTime(chrono::NaiveTime),
    WakeAfterSeconds(u64),
}

impl TryFrom<serde_json::Value> for PowerCycleRequest {
    type Error = String;

    fn try_from(params: serde_json::Value) -> Result<Self, Self::Error> {
        let params = params
            .as_object()
            .ok_or_else(|| "power_cycle params must be an object".to_string())?;

        if params.keys().any(|key| {
            !matches!(
                key.as_str(),
                "wake_time" | "wake_after_seconds" | "shutdown_time"
            )
        }) {
            return Err("Unknown power_cycle parameter".to_string());
        }
        if params.contains_key("wake_time") == params.contains_key("wake_after_seconds") {
            return Err("Specify exactly one of wake_time or wake_after_seconds".to_string());
        }

        let shutdown_time = params
            .get("shutdown_time")
            .map(|value| parse_power_time(value, "shutdown_time"))
            .transpose()?;

        if let Some(value) = params.get("wake_time") {
            return Ok(Self {
                wake: WakeRequest::WakeTime(parse_power_time(value, "wake_time")?),
                shutdown_time,
            });
        }

        if let Some(value) = params.get("wake_after_seconds") {
            let seconds = value
                .as_u64()
                .ok_or_else(|| "wake_after_seconds must be a positive integer".to_string())?;

            if seconds < 120 {
                return Err("Wake must be at least 120 seconds after execution".to_string());
            }

            return Ok(Self {
                wake: WakeRequest::WakeAfterSeconds(seconds),
                shutdown_time,
            });
        }

        Err("Unknown power_cycle parameter".to_string())
    }
}

fn parse_power_time(value: &serde_json::Value, name: &str) -> Result<chrono::NaiveTime, String> {
    let value = value
        .as_str()
        .ok_or_else(|| format!("{name} must be a string in HH:MM format"))?;
    let bytes = value.as_bytes();
    if bytes.len() != 5
        || bytes[2] != b':'
        || ![bytes[0], bytes[1], bytes[3], bytes[4]]
            .iter()
            .all(u8::is_ascii_digit)
    {
        return Err(format!("{name} must use HH:MM format"));
    }
    chrono::NaiveTime::parse_from_str(value, "%H:%M")
        .map_err(|_| format!("{name} must be a valid 24-hour time"))
}

#[derive(Debug, Serialize)]
pub struct WakeCapabilities {
    pub rtc_device: Option<String>,
    pub rtcwake_available: Option<bool>,
    pub rtc_alarm_available: Option<bool>,
    pub s5_wake_status: &'static str,
    pub warnings: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct PowerCycleResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shutdown_at: Option<String>,
    pub wake_at: String,
    pub shutdown_scheduled: bool,
    pub s5_wake_status: &'static str,
}
