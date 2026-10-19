use std::io::{BufRead, Write};

use crate::input::{error::InputError, system::model::PowerCycle};

pub mod model;

mod prepare;
mod validate;

pub fn prepare(
    time: Option<String>,
    seconds: Option<u64>,
    shutdown_time: Option<String>,
    interactive: bool,
    reader: &mut impl BufRead,
    writer: &mut impl Write,
) -> Result<PowerCycle, InputError> {
    prepare::prepare(time, seconds, shutdown_time, interactive, reader, writer)
}
