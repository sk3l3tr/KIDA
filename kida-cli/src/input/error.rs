use std::fmt;

#[derive(Debug)]
pub struct InputError {
    context: String,
    message: String,
}

impl InputError {
    pub fn new(context: impl Into<String>, message: impl fmt::Display) -> Self {
        Self {
            context: context.into(),
            message: message.to_string(),
        }
    }
}

impl fmt::Display for InputError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.context, self.message)
    }
}

impl std::error::Error for InputError {}
