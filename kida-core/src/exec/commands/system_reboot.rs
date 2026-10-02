use std::process::Command;

use serde_json::json;

use crate::comm::protocol::{CommandRequest, CommandResponse, CommandStatus};

pub async fn exec(request: CommandRequest) -> CommandResponse {
    let when = request
        .params
        .get("when")
        .and_then(|value| value.as_str())
        .unwrap_or("+1");

    if !is_valid_when(when) {
        return CommandResponse {
            id: request.id,
            status: CommandStatus::Error,
            data: None,
            error: Some(format!("Invalid reboot time: {when}")),
        };
    }

    match Command::new("shutdown").arg("--reboot").arg(when).output() {
        Ok(output) if output.status.success() => CommandResponse {
            id: request.id,
            status: CommandStatus::Ok,
            data: Some(json!({
                "scheduled": true,
                "when": when
            })),
            error: None,
        },

        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

            CommandResponse {
                id: request.id,
                status: CommandStatus::Error,
                data: None,
                error: Some(if stderr.is_empty() {
                    format!("shutdown exited with {}", output.status)
                } else {
                    stderr
                }),
            }
        }

        Err(error) => CommandResponse {
            id: request.id,
            status: CommandStatus::Error,
            data: None,
            error: Some(format!("Failed to execute reboot: {error}")),
        },
    }
}

fn is_valid_when(value: &str) -> bool {
    if value == "now" {
        return true;
    }

    if let Some(minutes) = value.strip_prefix('+') {
        return !minutes.is_empty() && minutes.chars().all(|c| c.is_ascii_digit());
    }

    is_valid_time(value)
}

fn is_valid_time(value: &str) -> bool {
    let Some((hours, minutes)) = value.split_once(':') else {
        return false;
    };

    let Ok(hours) = hours.parse::<u8>() else {
        return false;
    };

    let Ok(minutes) = minutes.parse::<u8>() else {
        return false;
    };

    hours <= 23 && minutes <= 59
}
