use super::model::{PowerCycleRequest, PowerCycleResult, WakeCapabilities};
use chrono::{DateTime, LocalResult, TimeDelta, TimeZone, Timelike, Utc};
use std::{fs, io::ErrorKind, process::Command};

#[derive(Debug)]
pub struct PowerResult {
    pub scheduled: bool,
    pub when: String,
}

pub struct SystemPower;

impl SystemPower {
    pub fn shutdown(when: &str) -> Result<PowerResult, String> {
        execute("--poweroff", "shutdown", when)
    }

    pub fn reboot(when: &str) -> Result<PowerResult, String> {
        execute("--reboot", "reboot", when)
    }

    pub fn power_cycle(params: serde_json::Value) -> Result<PowerCycleResult, String> {
        let now = chrono::Local::now();

        let result = PowerCycleRequest::try_from(params).and_then(|request| {
            Self::power_cycle_with(&request, &now, Self::program_rtc_alarm, Self::shutdown)
        });

        if let Err(error) = &result {
            eprintln!("[SYSTEM] Power cycle error: {error}");
        }

        result
    }

    pub(crate) fn power_cycle_with<Tz: TimeZone>(
        request: &PowerCycleRequest,
        now: &DateTime<Tz>,
        program_alarm: impl FnOnce(&DateTime<Utc>) -> Result<(), String>,
        request_shutdown: impl FnOnce(&str) -> Result<PowerResult, String>,
    ) -> Result<PowerCycleResult, String> {
        let wake_at = Self::calculate_wake_at(request, now)?;
        let local_wake_at = wake_at.with_timezone(&now.timezone()).to_rfc3339();

        program_alarm(&wake_at)?;

        let shutdown = request_shutdown("+1")
            .map_err(|error| format!("Shutdown failed: {error}. An RTC alarm may remain active"))?;

        if !shutdown.scheduled {
            return Err("Shutdown was not accepted; an RTC alarm may remain active".to_string());
        }

        Ok(PowerCycleResult {
            wake_at: local_wake_at,
            shutdown_scheduled: true,
            s5_wake_status: "unverified",
        })
    }

    pub(crate) fn program_rtc_alarm(wake_at: &DateTime<Utc>) -> Result<(), String> {
        let result = (|| {
            if wake_at.timestamp_subsec_nanos() != 0 {
                return Err("Wake timestamp must use whole seconds".to_string());
            }

            if *wake_at <= Utc::now() {
                return Err("Wake timestamp must be in the future".to_string());
            }

            let capabilities = Self::wake_capabilities();

            if capabilities.rtcwake_available != Some(true) {
                return Err("rtcwake availability is not confirmed".to_string());
            }

            if capabilities.rtc_device.as_deref() != Some("rtc0")
                || capabilities.rtc_alarm_available != Some(true)
            {
                return Err("RTC rtc0 alarm capability is not confirmed".to_string());
            }

            fs::File::open("/dev/rtc0")
                .map_err(|error| format!("Cannot access /dev/rtc0: {error}"))?;

            let output = Command::new("rtcwake")
                .env("LC_ALL", "C")
                .args(["-m", "no", "-t"])
                .arg(wake_at.timestamp().to_string())
                .output()
                .map_err(|error| format!("Failed to execute rtcwake: {error}"))?;

            let stderr = String::from_utf8_lossy(&output.stderr);
            let stderr = stderr.trim();

            if !output.status.success() {
                return Err(format!(
                    "rtcwake failed with {}: {stderr}. \
                 An RTC alarm may remain active; shutdown was not requested",
                    output.status,
                ));
            }

            if !stderr.is_empty() {
                eprintln!("[SYSTEM] rtcwake warning: {stderr}");
            }

            let verification = (|| {
                let stdout = std::str::from_utf8(&output.stdout)
                    .map_err(|error| format!("Invalid rtcwake output: {error}"))?;

                let alarm = fs::read_to_string("/sys/class/rtc/rtc0/wakealarm")
                    .map_err(|error| format!("Cannot read configured RTC alarm: {error}"))?;

                verify_rtc_alarm(stdout, &alarm)
            })();

            verification.map_err(|error| {
                format!("{error}. An RTC alarm may remain active; shutdown was not requested")
            })
        })();

        if let Err(error) = &result {
            eprintln!("[SYSTEM] RTC programming error: {error}");
        }

        result
    }

    pub(crate) fn calculate_wake_at<Tz: TimeZone>(
        request: &PowerCycleRequest,
        now: &DateTime<Tz>,
    ) -> Result<DateTime<Utc>, String> {
        let now_utc = now.with_timezone(&Utc);

        let wake_at = match request {
            PowerCycleRequest::WakeAfterSeconds(seconds) => {
                let duration = i64::try_from(*seconds)
                    .ok()
                    .and_then(TimeDelta::try_seconds)
                    .ok_or_else(|| "wake_after_seconds is out of range".to_string())?;

                now_utc
                    .checked_add_signed(duration)
                    .ok_or_else(|| "Wake date is out of range".to_string())?
            }

            PowerCycleRequest::WakeTime(time) => {
                let timezone = now.timezone();
                let mut date = now.date_naive();

                loop {
                    let candidates = match timezone.from_local_datetime(&date.and_time(*time)) {
                        LocalResult::Single(candidate) => {
                            [Some(candidate.with_timezone(&Utc)), None]
                        }
                        LocalResult::Ambiguous(first, second) => [
                            Some(first.with_timezone(&Utc)),
                            Some(second.with_timezone(&Utc)),
                        ],
                        LocalResult::None => [None, None],
                    };

                    if let Some(candidate) = candidates
                        .into_iter()
                        .flatten()
                        .filter(|candidate| *candidate > now_utc)
                        .min()
                    {
                        break candidate;
                    }

                    date = date
                        .succ_opt()
                        .ok_or_else(|| "Wake date is out of range".to_string())?;
                }
            }
        };

        if wake_at.signed_duration_since(now_utc) < TimeDelta::seconds(120) {
            return Err("Wake must be at least 120 seconds after execution".to_string());
        }

        // RTC alarms use whole seconds. Round upward to preserve the minimum margin.
        let wake_at = if wake_at.timestamp_subsec_nanos() == 0 {
            wake_at
        } else {
            wake_at
                .checked_add_signed(TimeDelta::seconds(1))
                .and_then(|date| date.with_nanosecond(0))
                .ok_or_else(|| "Wake date is out of range".to_string())?
        };

        Ok(wake_at)
    }

    pub fn wake_capabilities() -> WakeCapabilities {
        let mut warnings = vec![
            "Wake from S5 requires a physical test; RTC detection does not verify it.".to_string(),
        ];

        let rtcwake_available = match Command::new("rtcwake").arg("--version").output() {
            Ok(output) if output.status.success() => Some(true),
            Ok(output) => {
                warnings.push(format!(
                    "Cannot confirm rtcwake availability: {}: {}",
                    output.status,
                    String::from_utf8_lossy(&output.stderr).trim(),
                ));
                None
            }
            Err(error) => {
                warnings.push(format!("Cannot execute rtcwake: {error}"));
                if error.kind() == ErrorKind::NotFound {
                    Some(false)
                } else {
                    None
                }
            }
        };

        let rtc_device = match fs::read_to_string("/sys/class/rtc/rtc0/name") {
            Ok(_) => Some("rtc0".to_string()),
            Err(error) => {
                warnings.push(format!("Cannot inspect RTC rtc0: {error}"));
                None
            }
        };

        let rtc_alarm_available = if rtc_device.is_some() {
            match fs::read_to_string("/sys/class/rtc/rtc0/wakealarm") {
                Ok(_) => Some(true),
                Err(error) => {
                    warnings.push(format!("Cannot read RTC wakealarm: {error}"));
                    if error.kind() == ErrorKind::NotFound {
                        Some(false)
                    } else {
                        None
                    }
                }
            }
        } else {
            None
        };

        if rtc_device.is_some() {
            if let Err(error) = fs::File::open("/dev/rtc0") {
                warnings.push(format!("Cannot open /dev/rtc0 for reading: {error}"));
            }
        }

        warnings.push(
            "Read-only diagnosis does not verify permission to program an RTC alarm.".to_string(),
        );

        for warning in &warnings {
            eprintln!("[SYSTEM] Wake capabilities warning: {warning}");
        }

        WakeCapabilities {
            rtc_device,
            rtcwake_available,
            rtc_alarm_available,
            s5_wake_status: "unverified",
            warnings,
        }
    }
}

pub(crate) fn verify_rtc_alarm(rtcwake_stdout: &str, wakealarm: &str) -> Result<(), String> {
    let mut dates = rtcwake_stdout
        .lines()
        .filter_map(|line| line.strip_prefix("rtcwake: wakeup using /dev/rtc0 at "));

    let date = dates
        .next()
        .ok_or_else(|| "Cannot identify the RTC alarm programmed by rtcwake".to_string())?;

    if dates.next().is_some() {
        return Err("Ambiguous rtcwake alarm output".to_string());
    }

    let programmed = chrono::NaiveDateTime::parse_from_str(date.trim(), "%a %b %e %H:%M:%S %Y")
        .map_err(|error| format!("Cannot parse programmed RTC alarm: {error}"))?;

    // sysfs encodes the RTC calendar as epoch seconds, without timezone conversion.
    let expected = programmed.and_utc().timestamp();

    let wakealarm = wakealarm.trim();
    if wakealarm.is_empty() {
        return Err("RTC alarm is not enabled".to_string());
    }

    let actual = wakealarm
        .parse::<i64>()
        .map_err(|error| format!("Cannot parse RTC wakealarm: {error}"))?;

    if actual != expected {
        return Err(format!(
            "RTC alarm mismatch: expected {expected}, read {actual}"
        ));
    }

    Ok(())
}

fn execute(action: &str, action_name: &str, when: &str) -> Result<PowerResult, String> {
    if !is_valid_when(when) {
        return Err(format!("Invalid {action_name} time: {when}"));
    }

    let output = Command::new("shutdown")
        .arg(action)
        .arg(when)
        .output()
        .map_err(|error| format!("Failed to execute {action_name}: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

        return Err(if stderr.is_empty() {
            format!("shutdown exited with {}", output.status)
        } else {
            stderr
        });
    }

    Ok(PowerResult {
        scheduled: true,
        when: when.to_string(),
    })
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
