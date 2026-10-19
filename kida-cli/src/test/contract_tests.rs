use crate::{
    input::scheduler::NewSchedule,
    protocol::command::{CommandRequest, CommandResponse, CommandStatus},
};

use serde_json::{Value, json};

use super::handlers::{protocol_fixture, scheduler_fixture};

#[test]
fn shared_protocol_contract() {
    let fixture = protocol_fixture();
    for case in fixture["requests"].as_array().unwrap() {
        let request: CommandRequest = serde_json::from_value(case["wire"].clone()).unwrap();
        assert_eq!(request.id, "request");
        assert_eq!(request.command, "scheduler.list");
        assert_eq!(request.params, case["params"], "{case}");
        assert_eq!(
            serde_json::to_value(request).unwrap(),
            json!({
                "id":"request", "command":"scheduler.list", "params":case["params"]
            })
        );
    }
    for case in fixture["responses"].as_array().unwrap() {
        let response: CommandResponse = serde_json::from_value(case["wire"].clone()).unwrap();
        assert_eq!(response.id, "request");
        match case["wire"]["status"].as_str().unwrap() {
            "OK" => assert!(matches!(response.status, CommandStatus::Ok)),
            "ERROR" => assert!(matches!(response.status, CommandStatus::Error)),
            status => panic!("unexpected fixture status: {status}"),
        }
        assert_eq!(serde_json::to_value(response).unwrap(), case["serialized"]);
    }
    for wire in fixture["invalid_requests"].as_array().unwrap() {
        assert!(
            serde_json::from_value::<CommandRequest>(wire.clone()).is_err(),
            "{wire}"
        );
    }
    for wire in fixture["invalid_responses"].as_array().unwrap() {
        assert!(
            serde_json::from_value::<CommandResponse>(wire.clone()).is_err(),
            "{wire}"
        );
    }
}

#[test]
fn shared_scheduler_input_contract() {
    let fixture = scheduler_fixture();
    for case in fixture["cases"].as_array().unwrap() {
        let input: NewSchedule = serde_json::from_value(case["input"].clone()).unwrap();
        assert_eq!(
            serde_json::to_value(input).unwrap(),
            case["normalized_input"],
            "{}",
            case["name"]
        );
    }
    for input in fixture["invalid_inputs"].as_array().unwrap() {
        assert!(
            serde_json::from_value::<NewSchedule>(input.clone()).is_err(),
            "{input}"
        );
    }
    // Structural decoding deliberately leaves semantic validation to the service.
    for input in fixture["semantic_inputs"].as_array().unwrap() {
        assert!(
            serde_json::from_value::<NewSchedule>(input.clone()).is_ok(),
            "{input}"
        );
    }
}

#[test]
fn scheduler_renderers_match_shared_responses() {
    let fixture = scheduler_fixture();
    for case in fixture["cases"].as_array().unwrap() {
        for (command, response_key, text_key) in [
            ("scheduler.add", "added", "add_text"),
            ("scheduler.list", "listed", "list_text"),
            ("scheduler.delete", "deleted", "delete_text"),
        ] {
            let response = serde_json::from_value(case[response_key].clone()).unwrap();
            assert_eq!(
                crate::renderer::render(command, &response).unwrap(),
                case[text_key].as_str().unwrap()
            );
            let result = crate::handle_response(command, &response);
            assert_eq!(result.stdout.as_deref(), case[text_key].as_str());
            assert!(result.stderr.is_none());
            assert_eq!(result.exit_code, std::process::ExitCode::SUCCESS);

            let entry = if command == "scheduler.list" {
                "/data/0"
            } else {
                "/data"
            };
            let mut required = vec!["id", "origin", "command", "params", "schedule"];
            if command == "scheduler.list" {
                required.push("next_enqueue_at");
            }
            for key in required {
                let mut wire = case[response_key].clone();
                wire.pointer_mut(entry)
                    .unwrap()
                    .as_object_mut()
                    .unwrap()
                    .remove(key);
                assert_missing_response_field(
                    command,
                    wire,
                    &format!(
                        "{}.{key}",
                        if command == "scheduler.list" {
                            "data[0]"
                        } else {
                            "data"
                        }
                    ),
                );
            }
            if case["input"]["schedule"]["type"] == "cron" {
                let mut wire = case[response_key].clone();
                wire.pointer_mut(entry).unwrap()["schedule"]
                    .as_object_mut()
                    .unwrap()
                    .remove("timezone");
                assert_missing_response_field(
                    command,
                    wire,
                    if command == "scheduler.list" {
                        "data[0].schedule.timezone"
                    } else {
                        "data.schedule.timezone"
                    },
                );
            }
        }
    }
    let empty = serde_json::from_value(fixture["empty"].clone()).unwrap();
    assert_eq!(
        crate::renderer::render("scheduler.list", &empty).unwrap(),
        fixture["empty_text"].as_str().unwrap()
    );
}

fn assert_missing_response_field(command: &str, wire: Value, path: &str) {
    let response = serde_json::from_value(wire).unwrap();
    let error = crate::renderer::render(command, &response).unwrap_err();
    assert_eq!(
        error.to_string(),
        format!("missing required field `{path}`")
    );
    let result = crate::handle_response(command, &response);
    assert!(result.stdout.is_none());
    assert_eq!(
        result.stderr.unwrap(),
        format!("Unable to render KIDA response: missing required field `{path}`")
    );
    assert_eq!(result.exit_code, std::process::ExitCode::from(3));
}

#[test]
fn shared_error_envelopes_keep_cli_output_and_exit_codes() {
    for case in protocol_fixture()["responses"].as_array().unwrap() {
        let response: CommandResponse = serde_json::from_value(case["wire"].clone()).unwrap();
        if matches!(response.status, CommandStatus::Error) {
            let result = crate::handle_response("scheduler.add", &response);
            assert!(result.stdout.is_none());
            assert_eq!(
                result.stderr.as_deref(),
                Some(response.error.as_deref().unwrap_or("Command failed."))
            );
            assert_eq!(result.exit_code, std::process::ExitCode::from(1));
        }
    }
}
