pub mod scheduler;

use std::process::ExitCode;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Serialize, Deserialize)]
pub struct CommandRequest {
    pub id: String,
    pub command: String,

    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CommandResponse {
    pub id: String,
    pub status: CommandStatus,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum CommandStatus {
    Ok,
    Error,
}

pub struct ResponseResult {
    pub stdout: Option<String>,
    pub stderr: Option<String>,
    pub exit_code: ExitCode,
}
