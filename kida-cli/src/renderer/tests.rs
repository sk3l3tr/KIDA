// Must implement module tests here! Do not implement tests inside source files!
#[cfg(test)]
mod scheduler_tests {
    use crate::{
        protocol::{CommandResponse, CommandStatus},
        renderer::scheduler::{add, delete, list},
    };
    use serde_json::{Value, json};

    fn response(data: Value) -> CommandResponse {
        CommandResponse {
            id: "request".into(),
            status: CommandStatus::Ok,
            data: Some(data),
            error: None,
        }
    }

    fn entry(id: &str, schedule: Value) -> Value {
        json!({"id":id,"command":"backup.run","params":null,"schedule":schedule,"next_enqueue_at":"2030-01-01T12:00:00Z"})
    }

    #[test]
    fn renders_empty_multiple_schedules_and_confirmations() {
        assert_eq!(
            super::super::render("scheduler.list", &response(json!([]))).unwrap(),
            "No schedules found."
        );
        let once = entry("first", json!({"type":"once","at":"2030-01-01T12:00:00Z"}));
        let interval = entry("second", json!({"type":"interval","seconds":60}));
        let mut cron = entry(
            "third",
            json!({"type":"cron","expression":"30 2 * * *","timezone":"Europe/Madrid"}),
        );
        cron["params"] = json!({"name":"daily","items":[null,true,3]});
        let output = list(&response(json!([once, interval, cron]))).unwrap();
        assert!(output.find("ID: first").unwrap() < output.find("ID: second").unwrap());
        assert!(output.find("ID: second").unwrap() < output.find("ID: third").unwrap());
        for text in [
            "Command: backup.run",
            "Parameters: null",
            "once at 2030",
            "every 60 seconds",
            "cron 30 2 * * * (Europe/Madrid)",
            "Next enqueue attempt: 2030",
            "[null,true,3]",
        ] {
            assert!(output.contains(text), "{output}");
        }
        assert_eq!(
            add(&response(once.clone())).unwrap(),
            "Schedule added (ID: first)."
        );
        assert_eq!(
            delete(&response(once)).unwrap(),
            "Schedule deleted (ID: first)."
        );
    }

    #[test]
    fn malformed_responses_return_render_errors_without_fallback() {
        for value in [Value::Null, json!({}), json!([null]), json!([{}])] {
            assert!(super::super::render("scheduler.list", &response(value)).is_err());
        }
        let base = entry("id", json!({"type":"interval","seconds":60}));
        for key in ["id", "command", "params", "schedule", "next_enqueue_at"] {
            let mut value = base.clone();
            value.as_object_mut().unwrap().remove(key);
            assert!(list(&response(json!([value]))).is_err(), "{key}");
        }
        for (key, bad) in [
            ("id", json!(1)),
            ("command", json!([])),
            ("next_enqueue_at", Value::Null),
            ("schedule", json!({"type":"interval","seconds":-1})),
            ("schedule", json!({"type":"once","at":"future","seconds":1})),
            ("schedule", json!({"type":"cron","expression":"* * * * *"})),
            ("schedule", json!({"type":"other"})),
        ] {
            let mut value = base.clone();
            value[key] = bad;
            assert!(list(&response(json!([value]))).is_err());
        }
        for command in ["scheduler.add", "scheduler.delete"] {
            assert!(super::super::render(command, &response(json!({"id":"id"}))).is_err());
        }
    }
}
