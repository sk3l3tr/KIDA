use std::io::{BufRead, Write};

use serde::Serialize;

use super::{
    error::InputError,
    fields::{Kind, ask, ask_validated},
};

#[derive(Debug, Serialize)]
pub struct PowerCycle {
    #[serde(flatten)]
    wake: WakeMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    shutdown_time: Option<String>,
}

fn validate_time(time: &str, field: &str) -> Result<(), InputError> {
    let bytes = time.as_bytes();
    if bytes.len() != 5
        || bytes[2] != b':'
        || ![bytes[0], bytes[1], bytes[3], bytes[4]]
            .iter()
            .all(u8::is_ascii_digit)
        || &time[..2] > "23"
        || &time[3..] > "59"
    {
        return Err(InputError::new(
            field,
            "expected a valid 24-hour HH:MM time",
        ));
    }
    Ok(())
}

pub fn prepare(
    time: Option<String>,
    seconds: Option<u64>,
    shutdown_time: Option<String>,
    interactive: bool,
    reader: &mut impl BufRead,
    writer: &mut impl Write,
) -> Result<PowerCycle, InputError> {
    if let Some(time) = &shutdown_time {
        validate_time(time, "shutdown_time")?;
    }
    let wake = prepare_wake(time, seconds, interactive, reader, writer)?;
    Ok(PowerCycle {
        wake,
        shutdown_time,
    })
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
enum WakeMode {
    Time { wake_time: String },
    After { wake_after_seconds: u64 },
}

fn validate(time: Option<String>, seconds: Option<u64>) -> Result<WakeMode, InputError> {
    match (time, seconds) {
        (Some(wake_time), None) => {
            validate_time(&wake_time, "wake_time")?;
            Ok(WakeMode::Time { wake_time })
        }
        (None, Some(wake_after_seconds)) if wake_after_seconds >= 120 => {
            Ok(WakeMode::After { wake_after_seconds })
        }
        (None, Some(_)) => Err(InputError::new(
            "wake_after_seconds",
            "minimum is 120 seconds",
        )),
        _ => Err(InputError::new(
            "powercicle",
            "specify exactly one wake mode",
        )),
    }
}

fn prepare_wake(
    time: Option<String>,
    seconds: Option<u64>,
    interactive: bool,
    reader: &mut impl BufRead,
    writer: &mut impl Write,
) -> Result<WakeMode, InputError> {
    if time.is_some() || seconds.is_some() {
        return validate(time, seconds);
    }
    if !interactive {
        return Err(InputError::new(
            "wizard",
            "an interactive terminal is required",
        ));
    }
    let mode = ask(
        &Kind::Choice(&["time", "after"]),
        "Wake mode",
        reader,
        writer,
    )?;
    if mode == "time" {
        ask_validated(
            &Kind::String,
            "Wake time (HH:MM, server local timezone)",
            reader,
            writer,
            |value| validate(Some(value.as_str().unwrap().into()), None),
        )
    } else {
        ask_validated(
            &Kind::U64,
            "Seconds until wake (minimum 120)",
            reader,
            writer,
            |value| validate(None, value.as_u64()),
        )
    }
}
