use crate::protocol::CommandResponse;
use crate::renderer::{
    RenderError,
    json::{data, string},
};

pub fn run(response: &CommandResponse) -> Result<String, RenderError> {
    let data = data(response)?;
    let state = string(data, "state", "data.state")?;
    if state != "QUEUED" {
        return Err(RenderError::invalid("data.state", "the string `QUEUED`"));
    }

    let execution_id = string(data, "execution_id", "data.execution_id")?;
    Ok(format!("Backup queued (Execution ID: {execution_id})."))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::protocol::{CommandResponse, CommandStatus};
    use crate::renderer::{RenderError, render};

    use super::run;

    fn response(data: Option<serde_json::Value>) -> CommandResponse {
        CommandResponse {
            id: "request-id".to_string(),
            status: CommandStatus::Ok,
            data,
            error: None,
        }
    }

    #[test]
    fn renders_queued_backup() {
        let response = response(Some(json!({
            "state": "QUEUED",
            "execution_id": "execution-id",
            "future_field": true
        })));

        assert_eq!(
            render("backup.run", &response),
            Ok("Backup queued (Execution ID: execution-id).".to_string())
        );
    }

    #[test]
    fn rejects_missing_data() {
        assert_eq!(run(&response(None)), Err(RenderError::missing("data")));
    }

    #[test]
    fn rejects_non_queued_state() {
        let response = response(Some(json!({
            "state": "RUNNING",
            "execution_id": "execution-id"
        })));

        assert_eq!(
            run(&response),
            Err(RenderError::invalid("data.state", "the string `QUEUED`"))
        );
    }

    #[test]
    fn rejects_missing_execution_id() {
        let response = response(Some(json!({ "state": "QUEUED" })));

        assert_eq!(
            run(&response),
            Err(RenderError::missing("data.execution_id"))
        );
    }

    #[test]
    fn rejects_non_string_execution_id() {
        let response = response(Some(json!({
            "state": "QUEUED",
            "execution_id": 42
        })));

        assert_eq!(
            run(&response),
            Err(RenderError::invalid("data.execution_id", "a string"))
        );
    }
}
