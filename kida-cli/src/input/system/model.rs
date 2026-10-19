use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct PowerCycle {
    #[serde(flatten)]
    pub wake: WakeMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shutdown_time: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum WakeMode {
    Time { wake_time: String },
    After { wake_after_seconds: u64 },
}
