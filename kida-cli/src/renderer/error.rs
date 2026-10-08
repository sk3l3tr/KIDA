use std::fmt;

#[derive(Debug, PartialEq, Eq)]
pub struct RenderError(pub String);

impl RenderError {
    pub fn missing(path: &str) -> Self {
        Self(format!("missing required field `{path}`"))
    }

    pub fn invalid(path: &str, expected: &str) -> Self {
        Self(format!("field `{path}` must be {expected}"))
    }
}

impl fmt::Display for RenderError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}
