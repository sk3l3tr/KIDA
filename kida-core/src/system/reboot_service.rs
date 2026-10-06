use std::process::Command;

#[derive(Debug)]
pub struct RebootResult {
    pub scheduled: bool,
    pub when: String,
}

pub struct RebootService;

impl RebootService {
    pub fn reboot(when: &str) -> Result<RebootResult, String> {
        if !is_valid_when(when) {
            return Err(format!("Invalid reboot time: {when}"));
        }

        let output = Command::new("shutdown")
            .arg("--reboot")
            .arg(when)
            .output()
            .map_err(|error| format!("Failed to execute reboot: {error}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

            return Err(if stderr.is_empty() {
                format!("shutdown exited with {}", output.status)
            } else {
                stderr
            });
        }

        Ok(RebootResult {
            scheduled: true,
            when: when.to_string(),
        })
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
