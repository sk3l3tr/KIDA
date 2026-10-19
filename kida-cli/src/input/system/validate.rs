use super::model::WakeMode;
use crate::input::error::InputError;

pub fn validate_time(time: &str, field: &str) -> Result<(), InputError> {
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

pub fn validate(time: Option<String>, seconds: Option<u64>) -> Result<WakeMode, InputError> {
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
