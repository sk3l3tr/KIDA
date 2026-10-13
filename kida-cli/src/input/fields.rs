use std::io::{BufRead, Write};

use serde_json::{Value, json};

use super::error::InputError;

pub struct Field {
    pub name: &'static str,
    pub kind: Kind,
}

pub enum Kind {
    String,
    Bool,
    U32,
    Json,
    Choice(&'static [&'static str]),
    Default(Box<Kind>, Value),
    Optional(Box<Kind>),
    List(Box<Kind>, usize),
    Object(Vec<Field>),
}

pub fn ask(
    kind: &Kind,
    path: &str,
    reader: &mut impl BufRead,
    writer: &mut impl Write,
) -> Result<Value, InputError> {
    match kind {
        Kind::Object(fields) => {
            let mut object = serde_json::Map::new();
            for field in fields {
                let value = ask(
                    &field.kind,
                    &format!("{path}.{}", field.name),
                    reader,
                    writer,
                )?;
                if !matches!(field.kind, Kind::Optional(_)) || !value.is_null() {
                    object.insert(field.name.into(), value);
                }
            }
            Ok(Value::Object(object))
        }
        Kind::Optional(inner) => {
            let enabled = scalar(
                &Kind::Bool,
                &format!("Include {path}?"),
                Some(&json!(false)),
                reader,
                writer,
            )?;
            if enabled == true {
                ask(inner, path, reader, writer)
            } else {
                Ok(Value::Null)
            }
        }
        Kind::List(inner, minimum) => {
            let count = loop {
                let value = scalar(
                    &Kind::U32,
                    &format!("{path} count (minimum {minimum})"),
                    Some(&json!(minimum)),
                    reader,
                    writer,
                )?;
                let count = value.as_u64().unwrap() as usize;
                if count >= *minimum {
                    break count;
                }
                writeln!(writer, "Expected at least {minimum} elements")
                    .map_err(|e| InputError::new(path, e))?;
            };
            (0..count)
                .map(|index| ask(inner, &format!("{path}[{index}]"), reader, writer))
                .collect::<Result<Vec<_>, _>>()
                .map(Value::Array)
        }
        Kind::Default(inner, default) => scalar(inner, path, Some(default), reader, writer),
        _ => scalar(kind, path, None, reader, writer),
    }
}

fn scalar(
    kind: &Kind,
    path: &str,
    default: Option<&Value>,
    reader: &mut impl BufRead,
    writer: &mut impl Write,
) -> Result<Value, InputError> {
    loop {
        write!(writer, "{path}").map_err(|e| InputError::new(path, e))?;
        if let Some(default) = default {
            write!(writer, " [{default}]").map_err(|e| InputError::new(path, e))?;
        }
        if let Kind::Choice(choices) = kind {
            write!(writer, " ({})", choices.join(", ")).map_err(|e| InputError::new(path, e))?;
        }
        write!(writer, ": ")
            .and_then(|_| writer.flush())
            .map_err(|e| InputError::new(path, e))?;
        let mut bytes = Vec::new();
        loop {
            let buffer = reader
                .fill_buf()
                .map_err(|e| InputError::new(path, format!("cancelled: {e}")))?;
            if buffer.is_empty() {
                break;
            }
            let newline = buffer.iter().position(|byte| *byte == b'\n');
            let count = newline.map_or(buffer.len(), |index| index + 1);
            bytes.extend_from_slice(&buffer[..count]);
            reader.consume(count);
            if newline.is_some() {
                break;
            }
        }
        let mut line = String::from_utf8(bytes).map_err(|e| InputError::new(path, e))?;
        if line.is_empty() {
            return Err(InputError::new(path, "cancelled (EOF)"));
        }
        if line.ends_with('\n') {
            line.pop();
            if line.ends_with('\r') {
                line.pop();
            }
        }
        if line.contains('\u{3}') {
            return Err(InputError::new(path, "cancelled (interrupt)"));
        }
        if line.is_empty()
            && let Some(default) = default
        {
            return Ok(default.clone());
        }
        let value = match kind {
            Kind::String => Some(json!(line)),
            Kind::Bool => line.parse::<bool>().ok().map(|v| json!(v)),
            Kind::U32 => line.parse::<u32>().ok().map(|v| json!(v)),
            Kind::Json => serde_json::from_str(&line).ok(),
            Kind::Choice(choices) => choices.contains(&line.as_str()).then(|| json!(line)),
            _ => unreachable!("scalar field required"),
        };
        if let Some(value) = value {
            return Ok(value);
        }
        writeln!(writer, "Invalid value for {path}; try again.")
            .map_err(|e| InputError::new(path, e))?;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn corrects_json_and_u32_and_preserves_crlf_string_content() {
        let definition = Kind::Object(vec![
            Field {
                name: "json",
                kind: Kind::Json,
            },
            Field {
                name: "count",
                kind: Kind::U32,
            },
            Field {
                name: "text",
                kind: Kind::String,
            },
        ]);
        let mut prompts = Vec::new();
        let result = ask(
            &definition,
            "test",
            &mut "{\n[null,true,3]\n-1\n4294967296\n0\n  literal = value  \r\n".as_bytes(),
            &mut prompts,
        )
        .unwrap();
        assert_eq!(
            result,
            json!({"json":[null,true,3],"count":0,"text":"  literal = value  "})
        );
        assert_eq!(
            String::from_utf8(prompts)
                .unwrap()
                .matches("try again")
                .count(),
            3
        );
    }
}
