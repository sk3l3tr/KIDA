use serde_json::Value;
use std::env;

use crate::protocol::CommandRequest;

pub enum ParseResult {
    Request(CommandRequest),
    Help,
    MissingCommand,
}

pub fn parse() -> ParseResult {
    let mut args = env::args().skip(1);

    let Some(command) = args.next() else {
        return ParseResult::MissingCommand;
    };

    if command == "--help" || command == "-h" {
        return ParseResult::Help;
    }

    let params: Vec<Value> = args.map(Value::String).collect();

    ParseResult::Request(CommandRequest {
        id: generate_request_id(),
        command,
        params: Value::Array(params),
    })
}

fn generate_request_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};

    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
        .to_string()
}
