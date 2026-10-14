use std::io::{BufRead, Write};

use serde::Serialize;

use super::{
    error::InputError,
    fields::{Kind, ask},
};

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum PowerCycle {
    Time { wake_time: String },
    After { wake_after_seconds: u64 },
}

fn validate(time: Option<String>, seconds: Option<u64>) -> Result<PowerCycle, InputError> {
    match (time, seconds) {
        (Some(wake_time), None) => {
            let bytes = wake_time.as_bytes();
            if bytes.len() != 5
                || bytes[2] != b':'
                || ![bytes[0], bytes[1], bytes[3], bytes[4]]
                    .iter()
                    .all(u8::is_ascii_digit)
                || &wake_time[..2] > "23"
                || &wake_time[3..] > "59"
            {
                return Err(InputError::new(
                    "wake_time",
                    "expected a valid 24-hour HH:MM time",
                ));
            }
            Ok(PowerCycle::Time { wake_time })
        }
        (None, Some(wake_after_seconds)) if wake_after_seconds >= 120 => {
            Ok(PowerCycle::After { wake_after_seconds })
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

pub fn prepare(
    time: Option<String>,
    seconds: Option<u64>,
    interactive: bool,
    reader: &mut impl BufRead,
    writer: &mut impl Write,
) -> Result<PowerCycle, InputError> {
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
    loop {
        let result = if mode == "time" {
            let value = ask(
                &Kind::String,
                "Wake time (HH:MM, server local timezone)",
                reader,
                writer,
            )?;
            validate(Some(value.as_str().unwrap().into()), None)
        } else {
            let value = ask(
                &Kind::U64,
                "Seconds until wake (minimum 120)",
                reader,
                writer,
            )?;
            validate(None, value.as_u64())
        };
        match result {
            Ok(value) => return Ok(value),
            Err(error) => writeln!(writer, "{error}; try again.")
                .map_err(|e| InputError::new("powercicle", e))?,
        }
    }
}
