pub mod model;

mod mapper;
mod wizard;

use crate::{cli::AddParameters, input::error::InputError};
use model::NewSchedule;

pub fn map(p: AddParameters) -> Result<NewSchedule, InputError> {
    mapper::from_parameters(p)
}

pub fn wizard(
    reader: &mut impl std::io::BufRead,
    writer: &mut impl std::io::Write,
) -> Result<NewSchedule, InputError> {
    wizard::wizard(reader, writer)
}
