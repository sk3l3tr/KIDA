use serde_json::{Map, Value};

use crate::{protocol::CommandResponse, renderer::error::RenderError};

pub fn data(response: &CommandResponse) -> Result<&Map<String, Value>, RenderError> {
    response
        .data
        .as_ref()
        .ok_or_else(|| RenderError::missing("data"))?
        .as_object()
        .ok_or_else(|| RenderError::invalid("data", "an object"))
}

pub fn field<'a>(
    object: &'a Map<String, Value>,
    key: &str,
    path: &str,
) -> Result<&'a Value, RenderError> {
    object.get(key).ok_or_else(|| RenderError::missing(path))
}

pub fn object<'a>(
    object: &'a Map<String, Value>,
    key: &str,
    path: &str,
) -> Result<&'a Map<String, Value>, RenderError> {
    field(object, key, path)?
        .as_object()
        .ok_or_else(|| RenderError::invalid(path, "an object"))
}

pub fn array<'a>(
    object: &'a Map<String, Value>,
    key: &str,
    path: &str,
) -> Result<&'a [Value], RenderError> {
    field(object, key, path)?
        .as_array()
        .map(Vec::as_slice)
        .ok_or_else(|| RenderError::invalid(path, "an array"))
}

pub fn string<'a>(
    object: &'a Map<String, Value>,
    key: &str,
    path: &str,
) -> Result<&'a str, RenderError> {
    field(object, key, path)?
        .as_str()
        .ok_or_else(|| RenderError::invalid(path, "a string"))
}

pub fn nullable_string<'a>(
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

pub fn boolean(object: &Map<String, Value>, key: &str, path: &str) -> Result<bool, RenderError> {
    field(object, key, path)?
        .as_bool()
        .ok_or_else(|| RenderError::invalid(path, "a boolean"))
}

pub fn u64_value(object: &Map<String, Value>, key: &str, path: &str) -> Result<u64, RenderError> {
    field(object, key, path)?
        .as_u64()
        .ok_or_else(|| RenderError::invalid(path, "a non-negative integer"))
}

pub fn nullable_u64(
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

pub fn nullable_i64(
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

pub fn number(object: &Map<String, Value>, key: &str, path: &str) -> Result<f64, RenderError> {
    field(object, key, path)?
        .as_f64()
        .ok_or_else(|| RenderError::invalid(path, "a number"))
}

pub fn nullable_number(
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

pub fn value_object<'a>(
    value: &'a Value,
    path: &str,
) -> Result<&'a Map<String, Value>, RenderError> {
    value
        .as_object()
        .ok_or_else(|| RenderError::invalid(path, "an object"))
}
