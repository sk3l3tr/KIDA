use std::{collections::HashSet, fmt::Display, str::FromStr};

use super::error::InputError;

pub fn apply_indexed<T, V>(
    items: &mut [T],
    assignments: &[String],
    field: &str,
    set: impl Fn(&mut T, V),
) -> Result<(), InputError>
where
    V: FromStr,
    V::Err: Display,
{
    let mut assigned = HashSet::new();

    for assignment in assignments {
        let (index, value) = assignment
            .split_once('=')
            .ok_or_else(|| InputError::new(field, "expected INDEX=VALUE"))?;

        let index = index
            .parse::<usize>()
            .map_err(|error| InputError::new(field, error))?;

        let context = format!("{field}[{index}]");
        let item = items
            .get_mut(index)
            .ok_or_else(|| InputError::new(&context, "index does not exist"))?;

        if !assigned.insert(index) {
            return Err(InputError::new(&context, "duplicate assignment"));
        }

        let value = value
            .parse::<V>()
            .map_err(|error| InputError::new(&context, error))?;

        set(item, value);
    }

    Ok(())
}
