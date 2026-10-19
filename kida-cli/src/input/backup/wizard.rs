use serde_json::{Value, json};

use super::model::NewBackupJob;
use crate::input::{
    error::InputError,
    fields::{Field, Kind, ask},
};

pub fn wizard(
    reader: &mut impl std::io::BufRead,
    writer: &mut impl std::io::Write,
) -> Result<NewBackupJob, InputError> {
    fn field(name: &'static str, kind: Kind) -> Field {
        Field { name, kind }
    }
    fn optional(kind: Kind) -> Kind {
        Kind::Optional(Box::new(kind))
    }
    fn list(kind: Kind, minimum: usize) -> Kind {
        Kind::List(Box::new(kind), minimum)
    }
    fn default(kind: Kind, value: Value) -> Kind {
        Kind::Default(Box::new(kind), value)
    }
    fn commands() -> Kind {
        list(
            Kind::Object(vec![
                field("command", Kind::String),
                field("params", default(Kind::Json, Value::Null)),
            ]),
            0,
        )
    }
    let definition = Kind::Object(vec![
        field("name", Kind::String),
        field("sources", list(Kind::String, 1)),
        field(
            "targets",
            list(
                Kind::Object(vec![
                    field("path", Kind::String),
                    field("required", default(Kind::Bool, json!(true))),
                    field("filesystem_uuid", optional(Kind::String)),
                ]),
                1,
            ),
        ),
        field(
            "compression",
            default(Kind::Choice(&["tar_zstd"]), json!("tar_zstd")),
        ),
        field(
            "lifecycle",
            optional(Kind::Object(vec![
                field("pre_backup", commands()),
                field("post_backup", commands()),
            ])),
        ),
        field("schedule", optional(Kind::Json)),
        field(
            "retention",
            optional(Kind::Object(vec![
                field("max_age", optional(Kind::String)),
                field("keep_last", optional(Kind::U32)),
                field("protected_restore_points", list(Kind::String, 0)),
            ])),
        ),
    ]);
    serde_json::from_value(ask(&definition, "backup", reader, writer)?)
        .map_err(|error| InputError::new("backup configuration", error))
}
