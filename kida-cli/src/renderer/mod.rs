mod backup;
mod docker;
mod system;

use std::fmt;

use serde_json::{Map, Value};

use crate::protocol::CommandResponse;

type Renderer = fn(&CommandResponse) -> Result<String, RenderError>;

const RENDERERS: &[(&str, Renderer)] = &[
    ("health", system::health),
    ("system.info", system::info),
    ("system.health", system::system_health),
    ("system.shutdown", system::shutdown),
    ("system.reboot", system::reboot),
    ("docker.containers.list", docker::containers_list),
    ("docker.container.start", docker::container_action),
    ("docker.container.stop", docker::container_action),
    ("docker.container.restart", docker::container_action),
    ("docker.container.delete", docker::container_action),
];

#[derive(Debug, PartialEq, Eq)]
pub struct RenderError(String);

impl RenderError {
    fn missing(path: &str) -> Self {
        Self(format!("missing required field `{path}`"))
    }

    fn invalid(path: &str, expected: &str) -> Self {
        Self(format!("field `{path}` must be {expected}"))
    }
}

impl fmt::Display for RenderError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

pub fn render(command: &str, response: &CommandResponse) -> Result<String, RenderError> {
    match renderer_for(command) {
        Some(renderer) => renderer(response),
        None => serde_json::to_string_pretty(response.data.as_ref().unwrap_or(&Value::Null))
            .map_err(|error| RenderError(format!("cannot serialize response data: {error}"))),
    }
}

fn renderer_for(command: &str) -> Option<Renderer> {
    RENDERERS
        .iter()
        .find(|(id, _)| *id == command)
        .map(|(_, renderer)| *renderer)
}

fn data(response: &CommandResponse) -> Result<&Map<String, Value>, RenderError> {
    response
        .data
        .as_ref()
        .ok_or_else(|| RenderError::missing("data"))?
        .as_object()
        .ok_or_else(|| RenderError::invalid("data", "an object"))
}

fn field<'a>(
    object: &'a Map<String, Value>,
    key: &str,
    path: &str,
) -> Result<&'a Value, RenderError> {
    object.get(key).ok_or_else(|| RenderError::missing(path))
}

fn object<'a>(
    object: &'a Map<String, Value>,
    key: &str,
    path: &str,
) -> Result<&'a Map<String, Value>, RenderError> {
    field(object, key, path)?
        .as_object()
        .ok_or_else(|| RenderError::invalid(path, "an object"))
}

fn array<'a>(
    object: &'a Map<String, Value>,
    key: &str,
    path: &str,
) -> Result<&'a [Value], RenderError> {
    field(object, key, path)?
        .as_array()
        .map(Vec::as_slice)
        .ok_or_else(|| RenderError::invalid(path, "an array"))
}

fn string<'a>(
    object: &'a Map<String, Value>,
    key: &str,
    path: &str,
) -> Result<&'a str, RenderError> {
    field(object, key, path)?
        .as_str()
        .ok_or_else(|| RenderError::invalid(path, "a string"))
}

fn nullable_string<'a>(
    object: &'a Map<String, Value>,
    key: &str,
    path: &str,
) -> Result<Option<&'a str>, RenderError> {
    let value = field(object, key, path)?;
    if value.is_null() {
        Ok(None)
    } else {
        value
            .as_str()
            .map(Some)
            .ok_or_else(|| RenderError::invalid(path, "a string or null"))
    }
}

fn boolean(object: &Map<String, Value>, key: &str, path: &str) -> Result<bool, RenderError> {
    field(object, key, path)?
        .as_bool()
        .ok_or_else(|| RenderError::invalid(path, "a boolean"))
}

fn u64_value(object: &Map<String, Value>, key: &str, path: &str) -> Result<u64, RenderError> {
    field(object, key, path)?
        .as_u64()
        .ok_or_else(|| RenderError::invalid(path, "a non-negative integer"))
}

fn nullable_u64(
    object: &Map<String, Value>,
    key: &str,
    path: &str,
) -> Result<Option<u64>, RenderError> {
    let value = field(object, key, path)?;
    if value.is_null() {
        Ok(None)
    } else {
        value
            .as_u64()
            .map(Some)
            .ok_or_else(|| RenderError::invalid(path, "a non-negative integer or null"))
    }
}

fn nullable_i64(
    object: &Map<String, Value>,
    key: &str,
    path: &str,
) -> Result<Option<i64>, RenderError> {
    let value = field(object, key, path)?;
    if value.is_null() {
        Ok(None)
    } else {
        value
            .as_i64()
            .map(Some)
            .ok_or_else(|| RenderError::invalid(path, "an integer or null"))
    }
}

fn number(object: &Map<String, Value>, key: &str, path: &str) -> Result<f64, RenderError> {
    field(object, key, path)?
        .as_f64()
        .ok_or_else(|| RenderError::invalid(path, "a number"))
}

fn nullable_number(
    object: &Map<String, Value>,
    key: &str,
    path: &str,
) -> Result<Option<f64>, RenderError> {
    let value = field(object, key, path)?;
    if value.is_null() {
        Ok(None)
    } else {
        value
            .as_f64()
            .map(Some)
            .ok_or_else(|| RenderError::invalid(path, "a number or null"))
    }
}

fn value_object<'a>(value: &'a Value, path: &str) -> Result<&'a Map<String, Value>, RenderError> {
    value
        .as_object()
        .ok_or_else(|| RenderError::invalid(path, "an object"))
}
