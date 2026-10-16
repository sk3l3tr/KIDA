use crate::{
    features::scheduler::{model::NewSchedule, service::ScheduleService, time::parse_once},
    infrastructure::comm::protocol::{CommandRequest, CommandResponse, CommandStatus},
};

use serde_json::{Value, json};

fn protocol_fixture() -> Value {
    serde_json::from_str(include_str!("../../tests/fixtures/protocol.json")).unwrap()
}

fn scheduler_fixture() -> Value {
    serde_json::from_str(include_str!("../../tests/fixtures/scheduler.json")).unwrap()
}

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
fn scheduler_service_matches_shared_responses() {
    let fixture = scheduler_fixture();
    let now = parse_once(fixture["now"].as_str().unwrap()).unwrap();
    for case in fixture["cases"].as_array().unwrap() {
        let path =
            std::env::temp_dir().join(format!("kida-contract-{}.toml", uuid::Uuid::new_v4()));
        let mut service = ScheduleService::load(&path, now).unwrap();
        let input = serde_json::from_value(case["input"].clone()).unwrap();
        let added = service.add(input, now).unwrap();
        let id = added["id"].as_str().unwrap();
        let generated = uuid::Uuid::parse_str(id).unwrap();
        assert_eq!(generated.get_version_num(), 4);
        let listed = service.list();
        let deleted = service.delete(id).unwrap();
        for (mut data, expected) in [
            (added.clone(), &case["added"]),
            (listed, &case["listed"]),
            (deleted, &case["deleted"]),
        ] {
            let entry = if data.is_array() {
                &mut data[0]
            } else {
                &mut data
            };
            assert_eq!(entry["id"], id);
            entry["id"] = case["added"]["data"]["id"].clone();
            let response = CommandResponse {
                id: "request".into(),
                status: CommandStatus::Ok,
                data: Some(data),
                error: None,
            };
            assert_eq!(
                serde_json::to_value(response).unwrap(),
                *expected,
                "{}",
                case["name"]
            );
        }
        assert_eq!(service.list(), fixture["empty"]["data"]);
        // Reopen the real persisted document to check that deletion was saved.
        assert_eq!(
            ScheduleService::load(&path, now).unwrap().list(),
            fixture["empty"]["data"]
        );
        for input in fixture["semantic_inputs"].as_array().unwrap() {
            assert!(
                service
                    .add(serde_json::from_value(input.clone()).unwrap(), now)
                    .is_err()
            );
        }
        std::fs::remove_file(path).unwrap();
    }
}
