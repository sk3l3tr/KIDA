mod mapper;
pub mod model;
mod wizard;

use crate::{cli::CreateParameters, input::error::InputError};
use model::NewBackupJob;

pub fn wizard(
    reader: &mut impl std::io::BufRead,
    writer: &mut impl std::io::Write,
) -> Result<NewBackupJob, InputError> {
    wizard::wizard(reader, writer)
}

pub fn map(parameters: CreateParameters) -> Result<NewBackupJob, InputError> {
    mapper::from_parameters(parameters)
}
