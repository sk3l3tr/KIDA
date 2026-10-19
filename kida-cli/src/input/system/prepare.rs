use std::io::{BufRead, Write};

use super::{
    model::{PowerCycle, WakeMode},
    validate::{validate, validate_time},
};
use crate::input::{
    error::InputError,
    fields::{Kind, ask, ask_validated},
};

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
